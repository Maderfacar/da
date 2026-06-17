// W3（2026-06-18）：LIFF redirect circuit breaker
//
// 雖然 plugin（store-auth._InitLiffFlow）2026-06-17 已不再無條件 liff.login（避全新用戶 infinite
// loop），但 user 在 /login 或 /driver/auth 反覆按「LINE 登入」按鈕仍可能 loop——譬如 LINE 登入
// 後又拿不到 customToken（line-exchange fail）、reload 回原頁、user 再按一次。
//
// 策略：sessionStorage 計數 user 按「LINE 登入」按鈕次數；連續達 3 次 → 上 5 分鐘鎖並提示。
// 成功 signInWithCustomToken 後（在 store-auth.ts._ExchangeLiffTokenBackground 內）清計數。
//
// 為何用 sessionStorage：關 LINE WebView 即清，避免「下次開 LIFF」沿用上次 cooldown 變成怪 UX。
const LIFF_REDIRECT_COUNT_KEY = 'liff_redirect_count';
const LIFF_REDIRECT_LOCK_UNTIL_KEY = 'liff_redirect_lock_until';
const MAX_REDIRECT_ATTEMPTS = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

const _hasStorage = (): boolean => typeof sessionStorage !== 'undefined';

const _readNumber = (key: string): number => {
  if (!_hasStorage()) return 0;
  try {
    const raw = sessionStorage.getItem(key) ?? '0';
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

const _writeNumber = (key: string, value: number): void => {
  if (!_hasStorage()) return;
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // 隱私模式 / quota 滿 → 靜默略過；circuit breaker 失效，但至少不影響登入流程
  }
};

const _removeAll = (): void => {
  if (!_hasStorage()) return;
  try {
    sessionStorage.removeItem(LIFF_REDIRECT_COUNT_KEY);
    sessionStorage.removeItem(LIFF_REDIRECT_LOCK_UNTIL_KEY);
  } catch {
    // 同上，靜默略過
  }
};

export const UseLiffRedirectGuard = () => {
  const isLocked = (): boolean => Date.now() < _readNumber(LIFF_REDIRECT_LOCK_UNTIL_KEY);
  const remainingMs = (): number => Math.max(0, _readNumber(LIFF_REDIRECT_LOCK_UNTIL_KEY) - Date.now());

  /**
   * user 按「LINE 登入」按鈕前呼叫。
   * - 'ok'：可繼續 liff.login() redirect（計數已 +1）
   * - 'locked'：已達上限 / 已在冷卻中，請顯示「LINE 登入似乎卡住，請手動關閉視窗重開或聯絡客服」並暫禁按鈕
   */
  const beforeRedirect = (): 'ok' | 'locked' => {
    if (isLocked()) return 'locked';
    const next = _readNumber(LIFF_REDIRECT_COUNT_KEY) + 1;
    _writeNumber(LIFF_REDIRECT_COUNT_KEY, next);
    if (next >= MAX_REDIRECT_ATTEMPTS) {
      _writeNumber(LIFF_REDIRECT_LOCK_UNTIL_KEY, Date.now() + COOLDOWN_MS);
      return 'locked';
    }
    return 'ok';
  };

  /** 成功 signInWithCustomToken 後呼叫；user 手動關視窗重開等場景也可清。 */
  const reset = (): void => _removeAll();

  return { isLocked, remainingMs, beforeRedirect, reset };
};

// 註：store-auth.ts._ExchangeLiffTokenBackground 在 signInWithCustomToken 成功後也會清
// 上述兩個 sessionStorage key（直接 inline 操作，key 須與本檔 const 同步）。
