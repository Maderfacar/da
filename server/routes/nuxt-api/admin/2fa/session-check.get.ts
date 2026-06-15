/**
 * GET /nuxt-api/admin/2fa/session-check
 * 驗證 X-Admin-2FA-Session header 對應的 session token 是否仍有效且屬於 caller。
 *
 * Header: Authorization: Bearer {idToken} + X-Admin-2FA-Session: {token}
 *
 * 用途：store-auth InitAuthFlow 完成後呼叫；若回 200 則 admin2faSessionVerified=true。
 * 失敗（token 無效 / 過期 / 不屬於 caller）→ 401，前端清掉 localStorage 並導去 challenge。
 *
 * 由 getAuthFromEvent 路徑 BYPASS 名單放行（本身就是用來檢查 session）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { verify2faSession } from '@@/utils/admin-2fa-session';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '僅限管理員', en: 'Admin only', ja: '管理者のみ' });
  }

  const token = getHeader(event, 'x-admin-2fa-session') ?? '';
  if (!token) {
    return unauthorizedError({
      zh_tw: '缺少 2FA session',
      en: 'Missing 2FA session',
      ja: '2FAセッションがありません',
    });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
  const session = await verify2faSession(db, token);
  if (!session || session.adminUid !== auth.lineUid) {
    return unauthorizedError({
      zh_tw: '2FA session 無效',
      en: 'Invalid 2FA session',
      ja: '2FAセッションが無効です',
    });
  }

  return successResponse({ ok: true });
});
