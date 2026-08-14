/**
 * CSRF 防護 middleware（認證根治 Phase 0）。
 *
 * 只對「帶 session cookie」的 mutating /nuxt-api/* 請求做同源檢查：
 *   - 無 da_session cookie ＝ 無 ambient authority（Bearer 需主動設 header，攻擊者跨站設不了）
 *     → 完全不介入。這讓 Phase 0 在 cookie 尚未簽發前對現有流量「零影響」。
 *   - 帶 cookie 且跨站 mutating → 擋。
 *
 * 註：security guard 用 `throw createError` 是 Nitro middleware 阻擋請求的慣用法，
 *     與 route handler「return 非 throw」的業務慣例刻意不同。
 */
import { isBlockedCrossOrigin } from '@@/utils/csrf-origin';
import { SESSION_COOKIE_NAME } from '@@/utils/session-cookie';

export default defineEventHandler((event) => {
  if (!getCookie(event, SESSION_COOKIE_NAME)) return; // 無 cookie → 免檢查
  if (isBlockedCrossOrigin(event.method, event.path || '', getHeader(event, 'origin'), getHeader(event, 'host'))) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid origin' });
  }
});
