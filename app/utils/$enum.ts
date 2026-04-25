/** Enum 庫 */
/** API 狀態 */
const apiStatus = {
  none: '',
  /** 成功 */
  success: 200,
  /** 失敗 */
  fail: 400,
  /** 未授權 */
  unauthorized: 401,
  /** 禁止存取 */
  forbidden: 403,
  /** 找不到 */
  notFound: 404,
  /** 系統錯誤 */
  serverError: 500
} as const;


export default {
  /** API 狀態 */
  apiStatus
};
