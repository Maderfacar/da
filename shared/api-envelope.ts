/**
 * API 錯誤正規化 — 讓 `$api.*()` 的回傳永遠是 envelope 形狀
 *
 * 為什麼需要這支：`app/protocol/fetch-api/methods.ts` 的每個方法都以
 * `.catch((err) => err)` 收尾，也就是**請求失敗時把錯誤物件原封不動回傳**。
 * 而全專案的呼叫慣例（CLAUDE.md 明載）是：
 *
 *     const res = await $api.GetUserList();
 *     if (res.status.code !== $enum.apiStatus.success) return false;
 *
 * API 回錯誤時 `Fetch` throw 的是 envelope，有 `.status.code`，一切正常；
 * 但**傳輸層失敗**（網路斷、逾時、導航中途取消請求、冷啟 timeout）throw 的是原始
 * Error，沒有 `.status` → `res.status.code` 直接爆成 unhandled rejection。
 *
 * 這不是單一頁面的問題，是**每一個 API 呼叫點都中**，只是平常網路好不會觸發。
 * 2026-08-20 prod 實測到 `undefined is not an object (evaluating 'h.status.code')`。
 *
 * 修法：失敗一律正規化為 envelope，`code` 用 0（`apiStatus.networkError`）表示
 * 「請求從未到達 server」——與任何 HTTP 狀態碼都不衝突，且必然 !== success，
 * 因此所有既有的 `!== success` 防呆都會正確地走失敗分支。
 */

/** 傳輸層失敗（請求未到達 server）。與 HTTP 狀態碼不衝突。 */
export const API_NETWORK_ERROR_CODE = 0;

export interface ApiStatusMessage {
  zh_tw: string;
  en: string;
  ja: string;
}

export interface ApiEnvelopeLike {
  data: unknown;
  status: {
    code: number;
    message: ApiStatusMessage;
  };
}

const NETWORK_ERROR_MESSAGE: ApiStatusMessage = {
  zh_tw: '連線失敗，請檢查網路後再試一次',
  en: 'Connection failed, please check your network and try again',
  ja: '接続に失敗しました。ネットワークをご確認のうえ、再度お試しください',
};

/** 是否已經是 envelope 形狀（有可讀的 status.code）。 */
export function isApiEnvelope(value: unknown): value is ApiEnvelopeLike {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  if (!status || typeof status !== 'object') return false;
  return typeof (status as { code?: unknown }).code === 'number';
}

/**
 * 把 catch 到的任何東西轉成 envelope。
 * 已是 envelope（API 回的錯誤）→ 原樣回傳，保留 server 的錯誤碼與三語訊息。
 * 其餘（原始 Error / undefined / 字串）→ 包成 networkError envelope。
 */
export function toApiEnvelope(err: unknown): ApiEnvelopeLike {
  if (isApiEnvelope(err)) return err;
  return {
    data: null,
    status: {
      code: API_NETWORK_ERROR_CODE,
      message: NETWORK_ERROR_MESSAGE,
    },
  };
}
