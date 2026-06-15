/**
 * Admin 敏感操作 PIN session guard。
 *
 * 用法（在 3 個 W2 高敏感 endpoint 內 + auth/權限通過後）：
 *   const pinOk = await requirePinSession(event, auth);
 *   if (pinOk !== true) return authFailResponse(pinOk);
 *
 * 設計：
 *   - 預期 caller 已通過 getAuthFromEvent（即已有 TOTP session）
 *   - 從 Header X-Admin-Pin-Session 讀 token
 *   - verifyPinSession 對 auth.lineUid 一致 → true
 *   - 缺 header / token 無效 / adminUid 不符 / 過期 → AuthFail 403 PIN_REQUIRED
 */
import type { H3Event } from 'h3';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { verifyPinSession } from '@@/utils/admin-pin-session';
import type { AuthOk, AuthFail } from '@@/utils/require-auth';

export async function requirePinSession(
  event: H3Event,
  auth: AuthOk,
): Promise<true | AuthFail> {
  const token = getHeader(event, 'x-admin-pin-session') ?? '';
  if (!token) {
    return {
      ok: false,
      code: 403,
      message: { zh_tw: '需要敏感操作 PIN', en: 'PIN_REQUIRED', ja: '操作PINが必要です' },
    };
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return { ok: false, code: 500, message: { zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' } };
  }

  const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
  const valid = await verifyPinSession(db, token, auth.lineUid).catch(() => false);
  if (!valid) {
    return {
      ok: false,
      code: 403,
      message: { zh_tw: '敏感操作 PIN 無效或已過期', en: 'PIN_REQUIRED', ja: '操作PINが無効か期限切れです' },
    };
  }
  return true;
}
