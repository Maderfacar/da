/**
 * POST /nuxt-api/admin/pin/setup
 * 設定 / 變更 admin 敏感操作 PIN。
 *
 * Body: { newPin: string, oldPin?: string }
 *
 * 規則：
 *   - caller 必須是 admin（roles 含 admin）+ TOTP session valid（由 getAuthFromEvent 強制）
 *   - admins/{uid}.sensitivePinHash 已存在 → oldPin 必填且 bcrypt compare 通過
 *   - newPin regex /^\d{4,8}$/
 *   - 寫 sensitivePinHash + pinSetAt: serverTimestamp merge
 *   - audit log action='admin.pin_set'
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { validatePinFormat, hashPin, comparePin } from '@@/utils/admin-pin';
import { writeAuditLog } from '@@/utils/audit-log';

interface SetupBody { newPin?: string; oldPin?: string }

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

  const body = await readBody<SetupBody>(event).catch(() => null);
  const newPin = (body?.newPin ?? '').trim();
  if (!validatePinFormat(newPin)) {
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
    const data = snap.data() ?? {};
    const existingHash = data.sensitivePinHash as string | undefined;

    if (existingHash) {
      const oldPin = (body?.oldPin ?? '').trim();
      if (!validatePinFormat(oldPin)) {
        return badRequestError({
          zh_tw: '請輸入原 PIN',
          en: 'oldPin required',
          ja: '元のPINが必要です',
        });
      }
      const ok = await comparePin(oldPin, existingHash);
      if (!ok) {
        return badRequestError({
          zh_tw: '原 PIN 錯誤',
          en: 'INVALID_OLD_PIN',
          ja: '元のPINが正しくありません',
        });
      }
    }

    const newHash = await hashPin(newPin);
    await ref.set(
      { sensitivePinHash: newHash, pinSetAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    await writeAuditLog({
      event,
      auth,
      action: 'admin.pin_set',
      targetType: 'admin',
      targetId: auth.lineUid,
      payload: { wasUpdate: !!existingHash },
    });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[admin/pin/setup] failed:', err);
    return serverError();
  }
});
