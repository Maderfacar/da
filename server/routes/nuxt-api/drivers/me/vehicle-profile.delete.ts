/**
 * DELETE /nuxt-api/drivers/me/vehicle-profile
 * 司機捨棄 vehicleProfilePending（含撤回送審）— Phase 1B
 *
 * 規則（議題 #6 / #7）：
 *   - status='draft'：可以捨棄（清空 vehicleProfilePending）
 *   - status='rejected'：可以捨棄（不想再依退回內容續編）
 *   - status='pending_review'：可以撤回（admin 還沒審核前 driver 可以拉回）
 *
 * 認證：require driver self
 * Body: 無
 * 無 audit log（無業務影響；vehicleProfile current 不變）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    await driverRef.update({ vehicleProfilePending: FieldValue.delete() });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[drivers/me/vehicle-profile.delete] failed:', err);
    return serverError();
  }
});
