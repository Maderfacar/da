/**
 * POST /nuxt-api/admin/2fa/disable
 * Super admin 清除 target admin 的 TOTP enrollment（忘失機重置流程）。
 *
 * Body: { targetUid: string }
 *
 * 規則：
 *   - caller 必須是 super（canManageAdmins + auth.level === 'super'）
 *   - caller 經 getAuthFromEvent 正常 TOTP gate（super 自己也需有效 session）
 *
 * 清欄位：totpSecret / totpEnrolledAt / totpSecretPending 全 delete；target 下次登入會被導去 /admin/2fa/setup
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

interface DisableBody { targetUid?: string }

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!hasPermission(auth, 'canManageAdmins') || auth.level !== 'super') {
    return forbiddenError({
      zh_tw: '僅限最高管理員操作',
      en: 'Super admin required',
      ja: 'スーパー管理者のみ',
    });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const body = await readBody<DisableBody>(event).catch(() => null);
  const rawUid = (body?.targetUid ?? '').trim();
  if (!rawUid) {
    return badRequestError({ zh_tw: 'targetUid 缺失', en: 'targetUid required', ja: 'targetUidが必要です' });
  }
  const targetUid = rawUid.startsWith('line:') ? rawUid.slice(5) : rawUid;

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('admins').doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '管理員不存在', en: 'Admin not found', ja: '管理者が見つかりません' });
    }

    await ref.update({
      totpSecret: FieldValue.delete(),
      totpEnrolledAt: FieldValue.delete(),
      totpSecretPending: FieldValue.delete(),
    });

    await writeAuditLog({
      event,
      auth,
      action: 'admin.2fa_disable',
      targetType: 'admin',
      targetId: targetUid,
      payload: { targetUid },
    });

    return successResponse({ targetUid });
  } catch (err) {
    console.error('[admin/2fa/disable] failed:', err);
    return serverError();
  }
});
