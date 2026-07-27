// 深連結參數消費（W2 — 認證根治 2026-07-28）
//
// LIFF `liff.state` / `next` 把目標 path 塞進 URL query。過去這些 query 從不清除，
// 導致每次 middleware/page 重新解析都再度觸發導向 → 無限迴圈燃料。
//
// 策略：login-entry 導向決策做完後，把這些參數從當前 URL 剝掉（history.replaceState），
// 消費一次即失效。純函式 removeDeepLinkParams 可單元測試；stripDeepLinkParams 是 window 包裝。

export const DEEP_LINK_PARAMS = ['liff.state', 'next'] as const;

/**
 * 從 href 移除 liff.state / next，回傳新的 path+search+hash（相對）。
 * 無這些參數時回傳與輸入等價的相對 URL。
 */
export function removeDeepLinkParams(href: string): string {
  const url = new URL(href);
  for (const p of DEEP_LINK_PARAMS) url.searchParams.delete(p);
  const search = url.searchParams.toString();
  return url.pathname + (search ? `?${search}` : '') + url.hash;
}

/** 把當前瀏覽器 URL 的深連結參數剝掉（client only；SSR / 無 window 時 noop）。 */
export function stripDeepLinkParams(): void {
  if (typeof window === 'undefined') return;
  try {
    const next = removeDeepLinkParams(window.location.href);
    window.history.replaceState(window.history.state, '', next);
  } catch {
    // URL 解析 / history API 失敗 → 靜默略過（斷路器仍是最終保險）
  }
}
