/**
 * POST /nuxt-api/admin/2fa/verify-login
 * 既有已綁定 TOTP 的 admin 通過 6 位數 challenge → mint sessionToken。
 *
 * Body: { code: string }
 *
 * 規則：
 *   - caller 是 admin 且 admins/{uid}.totpEnrolledAt 已存在
 *   - 驗證失敗回 400 INVALID_CODE（並 audit log）
 *
 * 成功回 { sessionToken }。
 * 由 getAuthFromEvent 路徑 BYPASS 名單放行（caller 還沒有有效 session）。
 */
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
      return forbiddenError({ zh_tw: '管理員資料不存在', en: 'Admin doc missing', ja: '管理者データが存在しません' });
    }
    const data = snap.data() ?? {};
    const totpSecret = data.totpSecret as string | undefined;
    const enrolledAt = data.totpEnrolledAt;
    if (!totpSecret || !enrolledAt) {
      return badRequestError({
        zh_tw: '尚未綁定驗證器',
        en: 'TOTP not enrolled',
        ja: 'TOTP未設定',
      });
    }

    let secret: string;
    try {
      secret = decryptSecret(totpSecret);
    } catch {
      return serverError({
        zh_tw: 'TOTP 設定資料損毀，請聯絡 super admin 重置',
        en: 'TOTP secret corrupted, contact super admin',
        ja: 'TOTP設定が破損しています。super adminに連絡してください',
      });
    }

    if (!verifyCode(secret, code)) {
      // 失敗也寫 audit log（攻擊偵測線索）；不阻擋回應
      await writeAuditLog({
        event,
        auth,
        action: 'admin.2fa_login_fail',
        targetType: 'admin',
        targetId: auth.lineUid,
      });
      return badRequestError({
        zh_tw: '驗證碼錯誤',
        en: 'INVALID_CODE',
        ja: 'コードが正しくありません',
      });
    }

    const sessionToken = await mint2faSession(db, auth.lineUid);

    await writeAuditLog({
      event,
      auth,
      action: 'admin.2fa_login',
      targetType: 'admin',
      targetId: auth.lineUid,
    });

    return successResponse({ sessionToken });
  } catch (err) {
    console.error('[admin/2fa/verify-login] failed:', err);
    return serverError();
  }
});
