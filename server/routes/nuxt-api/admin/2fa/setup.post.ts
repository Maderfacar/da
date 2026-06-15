/**
 * POST /nuxt-api/admin/2fa/setup
 * 初始化 / 重置 admin TOTP enrollment（gen secret + 暫存 totpSecretPending）。
 *
 * 規則：
 *   - caller 必須是 admin（roles 含 admin）
 *   - 若 admins/{uid}.totpEnrolledAt 已存在且 caller 非 super → 403
 *     （避免一般 admin 偷改自己 secret 繞 2FA；super 重置自己需先手動 Firestore 清）
 *
 * 回傳：{ otpauthUrl, qrcodeDataUrl }
 *   - client 顯示 QR + 手動輸入 secret，使用者 authenticator app 掃描 / 輸入後
 *     呼叫 /nuxt-api/admin/2fa/verify-enrollment 帶 6 位數 code 完成 enrollment
 *
 * 由 getAuthFromEvent 路徑 BYPASS 名單放行（caller 尚未 totp session verified）
 */
import qrcode from 'qrcode';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { generateSecret, encryptSecret, buildOtpauthUrl } from '@@/utils/totp';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({
      zh_tw: '僅限管理員',
      en: 'Admin only',
      ja: '管理者のみ',
    });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('admins').doc(auth.lineUid);
    const snap = await ref.get();
    const data = snap.data() ?? {};

    const alreadyEnrolled = !!data.totpEnrolledAt;
    if (alreadyEnrolled && auth.level !== 'super') {
      return forbiddenError({
        zh_tw: '已綁定驗證器；忘失機請聯絡 super admin 清除設定',
        en: 'TOTP already enrolled; contact super admin to reset',
        ja: '既にTOTPが設定されています。リセットはsuper adminに連絡してください',
      });
    }

    const secret = generateSecret();
    const encrypted = encryptSecret(secret);

    // 取 displayName 拼 otpauth URL（authenticator app 顯示用）
    const displayName = (data.displayName as string | undefined) || auth.lineUid;

    await ref.set({ totpSecretPending: encrypted }, { merge: true });

    const otpauthUrl = buildOtpauthUrl(secret, displayName);
    const qrcodeDataUrl = await qrcode.toDataURL(otpauthUrl, { width: 240, margin: 1 });

    return successResponse({ otpauthUrl, qrcodeDataUrl, secret });
  } catch (err) {
    console.error('[admin/2fa/setup] failed:', err);
    return serverError();
  }
});
