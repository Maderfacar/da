/**
 * 乘客頁 roles 載入逾時是否要寫 `lifecycle.roles-load.timeout` log —— 純函式
 *
 * 這個事件要抓的是「**已登入**但 roles 載不到」（使用者會看到「載入失敗，請重新登入」）。
 * 訪客的 roles 本來就恆為空：/booking 對訪客開放（送出時才要求登入），訪客在頁面停留
 * 超過 5 秒就必然逾時。2026-10-20、10-22 兩位訪客開 /booking 各觸發一次登入健康告警，
 * 畫面其實完全正常（失敗畫面本身就有 isSignIn 守門）—— 只有 log 漏了同一道門。
 *
 * 放 shared/ 是為了有單元測試覆蓋（client 端沒有測試環境）。
 */
export interface RolesLoadTimeoutInput {
  isSignIn: boolean;
  rolesCount: number;
}

export function shouldReportRolesLoadTimeout(input: RolesLoadTimeoutInput): boolean {
  return input.isSignIn && input.rolesCount === 0;
}
