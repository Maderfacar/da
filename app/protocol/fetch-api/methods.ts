// 401 處理 —
// L1 + L2 兩層保護（c2011a0 引入 OAuth 迴圈後的修復）：
//   - L1：401 累積 3 次後 SignOut **一律 redirect 到 `/`**（不再 driver-path → /driver/auth）。
//     先前讓 driver path 跳 /driver/auth 的設計會觸發新一輪 _InitLiffFlow → liff.login() →
//     OAuth callback → race → 又 401 → 又 SignOut → 又 /driver/auth → 無限登入迴圈。
//     回到 / 雖然會卡乘客端，但**不迴圈**；配合 L2 從源頭防 401，這個 fallback 幾乎不會觸發。
//   - L2（在 onRequest 內）：所有 client API 都等 WaitForAuthResolved() 才取 token，
//     從根本避免 LIFF init / Firebase signin race 造成的偽 401。
//   - 前兩次 401 仍嘗試 refresh idToken；任何 2xx response 會 reset counter。
let _unauthorizedHits = 0;
let _isSigningOut = false;
const MAX_UNAUTHORIZED_HITS = 3;

const HandleUnauthorized = async () => {
  if (_isSigningOut) return;
  _unauthorizedHits++;

  // 前兩次 401：背景 refresh token，給下次 request 機會帶新 token，不踢出
  if (_unauthorizedHits < MAX_UNAUTHORIZED_HITS) {
    try {
      const authStore = StoreAuth();
      await authStore.GetFreshIdToken();
    } catch {
      // refresh 失敗也不踢出，等下次 retry
    }
    return;
  }

  // 累積到 MAX 才真 SignOut — L1：一律回 /（避免 driver path 自我觸發 OAuth 迴圈）
  _isSigningOut = true;
  try {
    const authStore = StoreAuth();
    await authStore.SignOut('/');
  } catch {
    // SSR 或 Pinia 未初始化時 fallback；replace 避免歷史堆疊
    void navigateTo('/', { replace: true });
  }
};

const ResetUnauthorizedCounter = () => {
  if (_unauthorizedHits > 0) _unauthorizedHits = 0;
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

// 預設請求
const Fetch = <T>(url: string, option: AnyObject, _showErr = true): Promise<ApiRes<T>> => {
  try {
    const storeSelf = StoreSelf();
    // const { apiBase } = useRuntimeConfig();
    // const baseURL = import.meta.server ? apiBase : '';
    return $fetch(
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
          // 成功（HTTP 2xx）reset 401 累積計數，避免歷史 race condition 殘留
          if (response?.status && response.status >= 200 && response.status < 300) {
            ResetUnauthorizedCounter();
          }
          const _res = FilterRes(response, 9997, _showErr);
          return Promise.reject(_res);
        },

        // 錯誤處理
        onResponseError({ response }) {
          // 401 不立即 SignOut，前兩次只 refresh token，累積 3 次才真踢出
          // L1：SignOut 後一律 redirect 到 / （不再分 driver-path，避免 OAuth 迴圈）
          if (response?.status === 401) void HandleUnauthorized();
          const _res = FilterRes(response, 9998, _showErr);
          return Promise.reject(_res);
        }
      }
    );
  } catch (_err) {
    const _res = FilterRes({}, 9999, _showErr);
    return Promise.reject(_res);
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
