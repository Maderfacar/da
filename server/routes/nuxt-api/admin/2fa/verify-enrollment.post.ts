/**
 * POST /nuxt-api/admin/2fa/verify-enrollment
 * 完成 TOTP enrollment：驗證 6 位數 code 後把 totpSecretPending 搬至 totpSecret + 記 totpEnrolledAt。
 *
 * Body: { code: string }（6 位數）
 *
 * 規則：
 *   - caller 是 admin（roles 含 admin）
 *   - admins/{uid}.totpSecretPending 必須存在
 *   - 驗證成功才寫入 totpSecret / totpEnrolledAt；失敗回 400 INVALID_CODE
 *
 * 成功回 { sessionToken }，client 寫 localStorage 'da_admin_2fa_session'。
 * 由 getAuthFromEvent 路徑 BYPASS 名單放行（首次 enrollment 尚未有 session）。
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { decryptSecret, verifyCode } from '@@/utils/totp';
import { mint2faSession } from '@@/utils/admin-2fa-session';
import { writeAuditLog } from '@@/utils/audit-log';

interface VerifyBody { code?: string }

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '僅限管理員', en: 'Admin only', ja: '管理者のみ' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const body = await readBody<VerifyBody>(event).catch(() => null);
  const code = (body?.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return badRequestError({
      zh_tw: '請輸入 6 位數驗證碼',
      en: '6-digit code required',
      ja: '6桁のコードを入力してください',
    });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('admins').doc(auth.lineUid);
    const snap = await ref.get();
    if (!snap.exists) {
      return forbiddenError({
        zh_tw: '管理員資料不存在',
        en: 'Admin doc missing',
        ja: '管理者データが存在しません',
      });
    }
    const data = snap.data() ?? {};
    const pending = data.totpSecretPending as string | undefined;
    if (!pending) {
      return badRequestError({
        zh_tw: '請先呼叫 setup 再驗證',
        en: 'Call setup first',
        ja: '先にsetupを呼び出してください',
      });
    }

    let secret: string;
    try {
      secret = decryptSecret(pending);
    } catch {
      return serverError({
        zh_tw: 'TOTP 設定資料損毀，請重新 setup',
        en: 'TOTP secret corrupted, please re-setup',
        ja: 'TOTP設定が破損しています。再setupしてください',
      });
    }

    if (!verifyCode(secret, code)) {
      return badRequestError({
        zh_tw: '驗證碼錯誤',
        en: 'INVALID_CODE',
        ja: 'コードが正しくありません',
      });
    }

    await ref.update({
      totpSecret: pending,
      totpEnrolledAt: FieldValue.serverTimestamp(),
      totpSecretPending: FieldValue.delete(),
    });

    const sessionToken = await mint2faSession(db, auth.lineUid);

    await writeAuditLog({
      event,
      auth,
      action: 'admin.2fa_enroll',
      targetType: 'admin',
      targetId: auth.lineUid,
    });

    return successResponse({ sessionToken });
  } catch (err) {
    console.error('[admin/2fa/verify-enrollment] failed:', err);
    return serverError();
  }
});
