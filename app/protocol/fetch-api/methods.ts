// 401 自動登出守衛 — 平行 request 同時 401 時，只會觸發一次 SignOut
let _isSigningOut = false;
const HandleUnauthorized = () => {
  if (_isSigningOut) return;
  _isSigningOut = true;
  // 改用 StoreAuth.SignOut（會清 Firebase session + 重置 store 狀態 + 導回 /）
  // 過去 boilerplate 預設導 '/sign-in' 但本專案登入頁是 '/'（middleware 會依 roles 導入對應端）
  try {
    const authStore = StoreAuth();
    void authStore.SignOut();
  } catch {
    // SSR 或 Pinia 未初始化時 fallback：直接導回根，由 middleware 接手
    void navigateTo('/');
  }
};

// 回傳調整
const FilterRes = (response: any, errCode = 9999, _showErr = true) => {
  const r = response?._data;
  const _res = { data: {}, status: { code: errCode, message: { zh_tw: '', en: '', ja: '' } } };
  if (r?.data) _res.data = r?.data;
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
        // onRequest 為 async：先取最新 ID token（過期會自動 refresh），失敗則不帶 header
        // 公開 endpoint（如 line-exchange）即使收到 token 也不檢查；受保護 endpoint 缺 token 會回 401
        async onRequest({ options }) {
          options.headers = new Headers(options.headers);
          try {
            const authStore = StoreAuth();
            const idToken = await authStore.GetFreshIdToken();
            if (idToken) {
              options.headers.set('Authorization', `Bearer ${idToken}`);
            } else if (storeSelf.apiToken) {
              // fallback 樣板原 apiToken（避免破壞既有測試流程）
              options.headers.set('Authorization', `Bearer ${storeSelf.apiToken}`);
            }
          } catch {
            if (storeSelf.apiToken) {
              options.headers.set('Authorization', `Bearer ${storeSelf.apiToken}`);
            }
          }
        },

        // 響應攔截
        onResponse({ response }) {
          const _res = FilterRes(response, 9997, _showErr);
          return Promise.reject(_res);
        },

        // 錯誤處理
        onResponseError({ response }) {
          // P14 require-auth：401 → 觸發全域 SignOut 流程（清 Firebase + Pinia + 導回 /）
          if (response?.status === 401) HandleUnauthorized();
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
