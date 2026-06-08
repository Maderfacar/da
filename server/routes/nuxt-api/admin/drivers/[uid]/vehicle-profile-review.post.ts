/**
 * POST /nuxt-api/admin/drivers/:uid/vehicle-profile-review
 * 管理員核准 / 退回司機 pending 車輛 profile — Phase 1B
 *
 * 流程：
 *   approve：
 *     - vehicleProfile = { photos, tags, updatedAt: serverTimestamp }
 *     - vehicleProfilePending = null
 *     - verifiedAt = serverTimestamp、verifiedBy = admin uid
 *   reject：
 *     - vehicleProfilePending.status = 'rejected'
 *     - rejectedAt + rejectReason + reviewedBy
 *     - 保留 photos/tags 內容（議題 #7：driver 可基於退回內容續編）
 *   audit log driver.vehicle_profile_review（payload: { decision, before, after, reason? }）
 *   LINE push 通知該 driver
 *
 * 認證：require admin + canManageDrivers
 *
 * Body: { decision: 'approve' | 'reject', reason?: string }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { sendLinePush } from '@@/utils/line-push';
import { buildTemplate, resolveTemplate, type TemplateContentText } from '@@/utils/template-registry';
import { buildDriverParams, type DriverDataLike } from '@@/utils/template-params';
import { buildTagIndex, tagIdsToNames } from '@@/utils/vehicle-profile';

interface PostBody {
  decision?: 'approve' | 'reject';
  reason?: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }
  if (!hasPermission(auth, 'canManageDrivers')) {
    return forbiddenError({ zh_tw: '需要司機管理權限', en: 'canManageDrivers required', ja: 'ドライバー管理権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  if (!body || (body.decision !== 'approve' && body.decision !== 'reject')) {
    return badRequestError({ zh_tw: 'decision 需為 approve 或 reject', en: 'decision must be approve or reject', ja: 'decision は approve または reject' });
  }
  if (body.decision === 'reject' && (!body.reason || body.reason.trim().length === 0)) {
    return badRequestError({ zh_tw: '退回需提供原因', en: 'reason required for reject', ja: '却下には理由が必要です' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(uid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const data = driverSnap.data() ?? {};
    const pending = data.vehicleProfilePending as
      | { status?: string; photos?: string[]; tags?: string[] }
      | null
      | undefined;
    const current = data.vehicleProfile as
      | { photos?: string[]; tags?: string[] }
      | null
      | undefined;

    if (!pending || pending.status !== 'pending_review') {
      return badRequestError({
        zh_tw: '無待審內容',
        en: 'No pending review',
        ja: '審査待ちのコンテンツがありません',
      });
    }

    const index = await buildTagIndex(db);
    const beforeSnapshot = {
      photos: current?.photos ?? [],
      tags: current?.tags ?? [],
      tagNames: tagIdsToNames(current?.tags ?? [], index),
    };
    const pendingSnapshot = {
      photos: pending.photos ?? [],
      tags: pending.tags ?? [],
      tagNames: tagIdsToNames(pending.tags ?? [], index),
    };

    // W4：核准 / 駁回共用 driver.vehicle-profile-review 模板，approved / rejected 各組 reason
    const vehicleTpl = (await resolveTemplate(db, 'driver.vehicle-profile-review')) as TemplateContentText;
    // 2026-06-08 Phase 2：driver context 帶 buildDriverParams（template 目前只用 result/reason，
    // 中心化讓 admin 未來可加 {driverName}/{vehicleModel} 等 placeholder 而不需動 trigger code）
    const driverParams = buildDriverParams(data as DriverDataLike);

    if (body.decision === 'approve') {
      await driverRef.update({
        vehicleProfile: {
          photos: pending.photos ?? [],
          tags: pending.tags ?? [],
          updatedAt: FieldValue.serverTimestamp(),
        },
        vehicleProfilePending: FieldValue.delete(),
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: auth.lineUid,
      });

      await writeAuditLog({
        event,
        auth,
        action: 'driver.vehicle_profile_review',
        targetType: 'driver',
        targetId: uid,
        payload: {
          decision: 'approve',
          before: beforeSnapshot,
          after: pendingSnapshot,
        },
      });

      const approvedMsg = buildTemplate(vehicleTpl, {
        ...driverParams,
        result: '通過',
        reason: '您提交的標籤與照片已通過審核並上線。',
      }, 'text');
      if (approvedMsg) await sendLinePush('driver', uid, [approvedMsg]);
    } else {
      const reason = body.reason!.trim();
      await driverRef.update({
        'vehicleProfilePending.status': 'rejected',
        'vehicleProfilePending.rejectedAt': FieldValue.serverTimestamp(),
        'vehicleProfilePending.rejectReason': reason,
        'vehicleProfilePending.reviewedBy': auth.lineUid,
      });

      await writeAuditLog({
        event,
        auth,
        action: 'driver.vehicle_profile_review',
        targetType: 'driver',
        targetId: uid,
        payload: {
          decision: 'reject',
          reason,
          before: beforeSnapshot,
          after: pendingSnapshot,
        },
      });

      const rejectedMsg = buildTemplate(vehicleTpl, {
        ...driverParams,
        result: '未通過',
        reason: `退回原因：${reason}\n您可至 /driver/profile 修改後重新送審。`,
      }, 'text');
      if (rejectedMsg) await sendLinePush('driver', uid, [rejectedMsg]);
    }

    return successResponse({ uid, decision: body.decision });
  } catch (err) {
    console.error('[admin/drivers/[uid]/vehicle-profile-review] failed:', err);
    return serverError();
  }
});
