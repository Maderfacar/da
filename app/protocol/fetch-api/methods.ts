// 401 處理 — W3（2026-06-18）改寫：
//   舊版「累積 3 次 401 才 SignOut」（_unauthorizedHits / MAX_UNAUTHORIZED_HITS = 3）已棄用。
//   舊版問題：多個並行 API fail 會在很短時間內累積到 3 → user 突然被踢到 /login 看不到關聯訊息。
//
//   新版業界標準：401 即試 refresh idToken + retry 原 request 一次；
//   refresh 失敗或 retry 後仍 401 → SignOut → /login（單一收斂點，不分 driver/passenger）。
//
//   核心 state machine 抽到 shared/auth/unauthorized-policy.ts（純函式，獨立可測）。
//   L2（onRequest 前等 WaitForAuthResolved）保留 — 從根本避免 LIFF/Firebase race 造成的偽 401。
import { createUnauthorizedPolicy } from '~shared/auth/unauthorized-policy';

const _policy = createUnauthorizedPolicy({
  refreshToken: async () => {
    try {
      const authStore = StoreAuth();
      return await authStore.GetFreshIdToken();
    } catch {
      return '';
    }
  },
  signOutToLogin: async () => {
    try {
      const authStore = StoreAuth();
      await authStore.SignOut('/login');
    } catch {
      // SSR 或 Pinia 未初始化時 fallback；replace 避免歷史堆疊
      void navigateTo('/login', { replace: true });
    }
  },
});

const _ResetAuthRetryState = () => {
  _policy.reset();
};

// 回傳調整
// 修：null 也是合法的 server 回應（例：GetUpcomingOrder 無單時回 null）。
// 舊邏輯 `if (r?.data)` 把 null/0/""/false 全當「沒給」→ 偷換成 {}，導致 page 收到 truthy 物件、
// 配合 dayjs(undefined) 渲染出當下時間 + orderId undefined（home 「即將到來行程」誤顯示日期時間的根因）。
// 改成「`data` 欄位存在於回應 envelope 就原封傳遞」— 0/null/false/"" 都不再被吃掉。
const FilterRes = (response: any, errCode = 9999, _showErr = true) => {
  const r = response?._data;
  const _res: { data: any; status: { code: number; message: { zh_tw: string; en: string; ja: string } } } = {
    data: {}, status: { code: errCode, message: { zh_tw: '', en: '', ja: '' } },
  };
  if (r && typeof r === 'object' && 'data' in r) _res.data = r.data;
  if (r?.status) _res.status = r?.status;
  if (_showErr /** code !==0 */) {
    // 全域錯誤 toast 由各頁面自行處理（避免雙 toast）
  }
  return _res as ApiRes<any>;
};

// 預設請求 — _DoFetch 內部 wrapper，401 + 尚未 retry → refresh + retry 一次。
// caller 看到的介面是 Fetch<T>(url, option, _showErr)；retry 對 caller 透明。
const Fetch = <T>(url: string, option: AnyObject, _showErr = true): Promise<ApiRes<T>> => {
  return _DoFetch<T>(url, option, _showErr, false);
};

const _DoFetch = async <T>(
  url: string,
  option: AnyObject,
  _showErr: boolean,
  _isRetry: boolean,
): Promise<ApiRes<T>> => {
  let storeSelf: ReturnType<typeof StoreSelf>;
  try {
    storeSelf = StoreSelf();
  } catch {
    const _res = FilterRes({}, 9999, _showErr);
    throw _res;
  }

  try {
    return await $fetch(
      `${url}?t=${Date.now()}`, // 加入 [?t] 避免 api 快取
      {
        // 參數
        ...option,

        // 請求攔截器
        // P14：改為帶 Firebase ID token；舊有 storeSelf.apiToken 沿用為樣板既有欄位
        // L2（2026-05-23）：在取 token 前等 WaitForAuthResolved 完成 — 從根本避免 LIFF init /
        // Firebase signin race 造成的偽 401（layout / page mount 早期觸發的 API 不再帶空 token）。
        // WaitForAuthResolved 內部有 12s timeout fallback（與 InitAuthFlow safetyTimer 對齊），
        // 不會永遠 hang。SSR 時跳過（無 window，且 plugin 不會在 SSR 跑）。
        async onRequest({ options }) {
          options.headers = new Headers(options.headers);
          try {
            const authStore = StoreAuth();
            if (typeof window !== 'undefined') {
              await authStore.WaitForAuthResolved();
            }
            const idToken = await authStore.GetFreshIdToken();
            if (idToken) {
              options.headers.set('Authorization', `Bearer ${idToken}`);
            } else if (storeSelf.apiToken) {
              // fallback 樣板原 apiToken（避免破壞既有測試流程）
              options.headers.set('Authorization', `Bearer ${storeSelf.apiToken}`);
            }
            // Admin 2FA：所有 /nuxt-api/admin/* 帶 X-Admin-2FA-Session header
            // server require-auth 對已綁 totpEnrolledAt 的 admin 一律強制校驗（2fa 自己幾個端點 BYPASS）
            if (url.includes('/nuxt-api/admin/') && typeof localStorage !== 'undefined') {
              const tfa = localStorage.getItem('da_admin_2fa_session') ?? '';
              if (tfa) options.headers.set('X-Admin-2FA-Session', tfa);
              // W2：敏感操作 PIN session（5min；3 高敏感 endpoint 強制校驗）
              if (typeof sessionStorage !== 'undefined') {
                const pin = sessionStorage.getItem('da_admin_pin_session') ?? '';
                if (pin) options.headers.set('X-Admin-Pin-Session', pin);
              }
            }
          } catch {
            if (storeSelf.apiToken) {
              options.headers.set('Authorization', `Bearer ${storeSelf.apiToken}`);
            }
          }
        },

        // 響應攔截
        onResponse({ response }) {
          // 成功（HTTP 2xx）reset 401 retry state，避免歷史 race condition 殘留
          if (response?.status && response.status >= 200 && response.status < 300) {
            _ResetAuthRetryState();
          }
          const _res = FilterRes(response, 9997, _showErr);
          return Promise.reject(_res);
        },

        // 錯誤處理
        onResponseError({ response }) {
          const _res = FilterRes(response, 9998, _showErr);
          // 401 在 envelope 上打標讓外層 wrapper 判斷是否 retry/SignOut
          // 注意：不在這裡直接呼叫 policy，因為 onResponseError 看不到 caller 的 _isRetry context
          if (response?.status === 401) {
            (_res as { _wasUnauthorized?: true })._wasUnauthorized = true;
          }
          return Promise.reject(_res);
        }
      }
    );
  } catch (envelope: any) {
    if (envelope?._wasUnauthorized) {
      if (!_isRetry) {
        // 第一次 401 → 試 refresh
        const decision = await _policy.handle(false);
        if (decision === 'retry') {
          // refresh 成功 → retry 原 request 一次（onRequest 會帶新 token）
          delete envelope._wasUnauthorized;
          return _DoFetch<T>(url, option, _showErr, true);
        }
        // 'signed-out'：policy 已觸發 SignOut→/login
        // 'noop'：另一條 path 已在 SignOut 中
      } else {
        // 已是 retry 仍 401 → SignOut（policy 內判斷）
        await _policy.handle(true);
      }
    }
    throw envelope;
  }
};

// -----------------------------------------------------------------------------------------------
// 自動導出
export default {
  /** 取得  */
  get: <T>(url: string, query: AnyObject = {}, _showErr = true) =>
    Fetch<T>(url, { method: 'get', query }, _showErr).catch((err) => err),

  /** 建立 */
  post: <T>(url: string, body: AnyObject = {}, _showErr = true) =>
    Fetch<T>(url, { method: 'post', body }, _showErr).catch((err) => err),

  /** 局部更新 */
  patch: <T>(url: string, body: AnyObject = {}, _showErr = true) =>
    Fetch<T>(url, { method: 'patch', body }, _showErr).catch((err) => err),

  /** 更新 */
  put: <T>(url: string, body: AnyObject = {}, _showErr = true) =>
    Fetch<T>(url, { method: 'put', body }, _showErr).catch((err) => err),

  /** 刪除 */
  delete: <T>(url: string, query: AnyObject = {}, _showErr = true) =>
    Fetch<T>(url, { method: 'delete', query }, _showErr).catch((err) => err),

  /** 檔案上傳下載 */
  formData: <T>(url: string, body: AnyObject = {}, _showErr = true, method: 'post' | 'patch' | 'put' | 'get' = 'post') =>
    Fetch(url, { method, body: $tool.JsonToFormData(body) }, _showErr).catch((err) => err) as Promise<ApiRes<T>>,

  /** 檔案上傳(進度條) */
  xhrFileUpload: <T>(url: string, body: AnyObject = {}, progressObj: FileProgress, _showErr = true): Promise<ApiRes<T>> => {
    try {
      const storeSelf = StoreSelf();
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && e.total > 0) progressObj['upload'] = Math.floor((e.loaded / e.total) * 100);
        });
        xhr.addEventListener('progress', (e) => {
          if (e.lengthComputable && e.total > 0) progressObj['download'] = Math.floor((e.loaded / e.total) * 100);
        });
        xhr.addEventListener('loadend', (e: any) => {
          let _res: ApiRes<T> = JSON.parse(e?.currentTarget?.responseText || '') || {};
          _res = FilterRes({ _data: _res }, 9996, _showErr);
          resolve(_res);
        });
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Authorization', `Bearer ${storeSelf.apiToken}`);
        xhr.send($tool.JsonToFormData(body));
      });
    } catch (_err) {
      const _res = FilterRes({}, 9999, _showErr);
      return Promise.reject(_res);
    }
  }
};
