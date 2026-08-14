// 認證根治 Phase 0：清除 session cookie（登出）。
// 只清本裝置 cookie，不 revokeRefreshTokens（避免連帶登出其他裝置）。
// 「登出所有裝置」如有需要可另做端點呼叫 auth.revokeRefreshTokens(uid)。
import { clearSessionCookie } from '@@/utils/session-cookie';

export default defineEventHandler((event) => {
  clearSessionCookie(event);
  return successResponse({ ok: true });
});
