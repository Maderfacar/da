/**
 * POST /nuxt-api/drivers/me/vehicle-profile
 * 司機送審 vehicleProfilePending（draft / rejected → pending_review）— Phase 1B
 *
 * 流程：
 *   1. driver 確認 pending 草稿存在且 status ∈ {'draft', 'rejected'}
 *   2. 寫入 vehicleProfilePending.status='pending_review' + submittedAt = serverTimestamp
 *   3. 寫 audit log driver.vehicle_profile_submit（payload = { pending }）
 *   4. LINE push 通知所有具 canManageDrivers 權限的 admin
 *
 * 認證：require driver self
 *
 * Body: 無
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import { sendLinePush } from '@@/utils/line-push';
import { getAdminRecipients } from '@@/utils/admin-recipients';
import { buildTagIndex, tagIdsToNames } from '@@/utils/vehicle-profile';

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

    const data = driverSnap.data() ?? {};
    const pending = data.vehicleProfilePending as
      | { status?: string; photos?: string[]; tags?: string[] }
      | null
      | undefined;

    if (!pending) {
      return badRequestError({ zh_tw: '無待送審草稿', en: 'No pending draft', ja: '送信待ちの下書きがありません' });
    }
    if (pending.status !== 'draft' && pending.status !== 'rejected') {
      return badRequestError({
        zh_tw: '目前狀態無法送審',
        en: 'Cannot submit in current status',
        ja: '現在の状態では送信できません',
      });
    }

    await driverRef.update({
      'vehicleProfilePending.status': 'pending_review',
      'vehicleProfilePending.submittedAt': FieldValue.serverTimestamp(),
      'vehicleProfilePending.rejectedAt': null,
      'vehicleProfilePending.rejectReason': null,
      'vehicleProfilePending.reviewedBy': null,
    });

    const index = await buildTagIndex(db);
    await writeAuditLog({
      event,
      auth,
      action: 'driver.vehicle_profile_submit',
      targetType: 'driver',
      targetId: auth.lineUid,
      payload: {
        photos: pending.photos ?? [],
        tags: pending.tags ?? [],
        tagNames: tagIdsToNames(pending.tags ?? [], index),
      },
    });

    // LINE push：通知所有 canManageDrivers admin
    try {
      const driverApp = data.application as { driverName?: string } | undefined;
      const driverName = driverApp?.driverName ?? auth.lineUid.slice(0, 8);
      const adminUids = await getAdminRecipients(db, 'canManageDrivers');
      const message = `🚗 司機車輛 Profile 待審核\n司機：${driverName}\n請至 admin 後台 /admin/drivers/${auth.lineUid} 處理`;
      await Promise.all(
        adminUids.map((adminUid) =>
          sendLinePush('passenger', adminUid, [{ type: 'text', text: message }]),
        ),
      );
    } catch (err) {
      console.error('[drivers/me/vehicle-profile.post] notify admins failed:', err);
    }

    return successResponse({ ok: true, status: 'pending_review' });
  } catch (err) {
    console.error('[drivers/me/vehicle-profile.post] failed:', err);
    return serverError();
  }
});
