/**
 * POST /nuxt-api/admin/pin/verify
 * 驗證 PIN → mint 5min PIN session token。
 *
 * Body: { pin: string }
 *
 * 規則：
 *   - caller 必須 admin + TOTP session valid
 *   - admins/{uid}.sensitivePinHash 必須存在（未設過 PIN → 400，引導使用者去 /admin/settings/pin 設定）
 *   - bcrypt compare 失敗 → 400 INVALID_PIN + audit log 'admin.pin_verify_fail'
 *   - 成功 mintPinSession + audit 'admin.pin_verify_ok'，回 { sessionToken }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { validatePinFormat, comparePin } from '@@/utils/admin-pin';
import { mintPinSession } from '@@/utils/admin-pin-session';
import { writeAuditLog } from '@@/utils/audit-log';

interface VerifyBody { pin?: string }

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
  const pin = (body?.pin ?? '').trim();
  if (!validatePinFormat(pin)) {
    return badRequestError({
      zh_tw: 'PIN 必須為 4-8 位純數字',
      en: 'PIN must be 4-8 digits',
      ja: 'PINは4〜8桁の数字のみ',
    });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('admins').doc(auth.lineUid);
    const snap = await ref.get();
    if (!snap.exists) {
      return forbiddenError({ zh_tw: '管理員資料不存在', en: 'Admin doc missing', ja: '管理者データが存在しません' });
    }
    const hash = snap.data()?.sensitivePinHash as string | undefined;
    if (!hash) {
      return badRequestError({
        zh_tw: '尚未設定 PIN，請先至「敏感操作 PIN」頁面設定',
        en: 'PIN not set; go to PIN settings first',
        ja: 'PIN未設定。先に設定してください',
      });
    }

    const ok = await comparePin(pin, hash);
    if (!ok) {
      await writeAuditLog({
        event,
        auth,
        action: 'admin.pin_verify_fail',
        targetType: 'admin',
        targetId: auth.lineUid,
      });
      return badRequestError({
        zh_tw: 'PIN 錯誤',
        en: 'INVALID_PIN',
        ja: 'PINが正しくありません',
      });
    }

    const sessionToken = await mintPinSession(db, auth.lineUid);
    await writeAuditLog({
      event,
      auth,
      action: 'admin.pin_verify_ok',
      targetType: 'admin',
      targetId: auth.lineUid,
    });

    return successResponse({ sessionToken });
  } catch (err) {
    console.error('[admin/pin/verify] failed:', err);
    return serverError();
  }
});
