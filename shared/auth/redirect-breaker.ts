// 中介層重導斷路器（W2 — 認證根治 2026-07-28）
//
// 終極保險：無論未來哪條邏輯 bug 導致「短時間內連續 replace 導向」，斷路器都會在超過
// 門檻後中止導向、讓當前頁渲染，避免頁面卡在無限登入迴圈（use-liff-redirect-guard 只擋
// 「使用者按登入按鈕」層級，擋不到 middleware 自動導向造成的迴圈）。
//
// 純函式 evaluateBreaker 可單元測試；noteRedirect / resetBreaker 是 sessionStorage 包裝。

export interface BreakerState {
  count: number;
  windowStart: number;
}

export const BREAKER_WINDOW_MS = 3000;
export const BREAKER_MAX = 8;
const STORAGE_KEY = 'auth_redirect_breaker';

/**
 * 純決策：給定前次狀態與現在時間，算出新狀態與是否允許本次導向。
 * - 無前次狀態，或已超出時間窗 → 重置為 count=1、允許
 * - 時間窗內累加；count 超過 max → 不允許（斷路）
 */
export function evaluateBreaker(
  prev: BreakerState | null,
  now: number,
  windowMs: number = BREAKER_WINDOW_MS,
  max: number = BREAKER_MAX,
): { state: BreakerState; allow: boolean } {
  if (!prev || now - prev.windowStart > windowMs) {
    return { state: { count: 1, windowStart: now }, allow: true };
  }
  const count = prev.count + 1;
  return { state: { count, windowStart: prev.windowStart }, allow: count <= max };
}

const _read = (): BreakerState | null => {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.count === 'number' && typeof parsed?.windowStart === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
};

const _write = (state: BreakerState): void => {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隱私模式 / quota → 靜默；斷路器失效但不影響導向流程
  }
};

/**
 * 記錄一次「即將導向」並回傳是否允許。
 * @returns true = 可導向；false = 斷路（連續導向過多，應中止讓頁面渲染）
 */
export function noteRedirect(now: number = Date.now()): boolean {
  const { state, allow } = evaluateBreaker(_read(), now);
  _write(state);
  return allow;
}

/** 導向已settle（正常放行）時清除計數。 */
export function resetBreaker(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 靜默
  }
}
