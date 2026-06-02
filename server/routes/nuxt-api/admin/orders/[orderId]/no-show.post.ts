/**
 * POST /nuxt-api/admin/orders/:orderId/no-show — A2 醜點系統 Phase 1
 *
 * Admin 手動標記訂單為「乘客未到」：
 *   - 守則：訂單需處於 confirmed / en_route / arrived_pickup / in_transit（已分配司機後乘客缺席）
 *   - 寫入：orderStatus='cancelled' + cancellationCategory='no_show' + cancelReason
 *           + statusHistory.cancelledAt
 *   - 累計：對乘客（orderUserId）+2 醜（透過 applyUglyPoint helper；含 lazy 6m 歸零 + LINE 推播）
 *   - audit log：order.mark_no_show
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { applyUglyPoint } from '@@/utils/penalty';

interface PostBody {
  reason?: string;
}

const NO_SHOW_VALID_FROM_STATUSES = new Set([
  'confirmed',
  'en_route',
  'arrived_pickup',
  'in_transit',
]);

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({
      zh_tw: '需要管理員權限',
      en: 'Admin role required',
      ja: '管理者権限が必要です',
    });
  }
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({
      zh_tw: '需要訂單管理權限',
      en: 'canManageOrders required',
      ja: '注文管理権限が必要です',
    });
  }

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({
      zh_tw: '缺少訂單 ID',
      en: 'Missing orderId',
      ja: '注文ID が必要です',
    });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({
      zh_tw: 'Firebase 未設定',
      en: 'Firebase not configured',
      ja: 'Firebase未設定',
    });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({
        zh_tw: '訂單不存在',
        en: 'Order not found',
        ja: '注文が見つかりません',
      });
    }
    const orderData = snap.data() ?? {};
    const prevStatus = (orderData.orderStatus as string | undefined) ?? 'pending';
    const orderUserId = (orderData.userId as string | undefined) ?? '';

    if (!NO_SHOW_VALID_FROM_STATUSES.has(prevStatus)) {
      return badRequestError({
        zh_tw: `訂單狀態 ${prevStatus} 不可標記為 no-show（需為司機已派發後的狀態）`,
        en: `Order status ${prevStatus} cannot be marked no-show`,
        ja: `注文ステータス ${prevStatus} はno-showにできません`,
      });
    }
    if (!orderUserId) {
      return badRequestError({
        zh_tw: '訂單缺少乘客識別，無法累計醜點',
        en: 'Order missing userId, cannot apply penalty',
        ja: '注文に乗客IDがありません',
      });
    }

    await ref.update({
      orderStatus: 'cancelled',
      cancellationCategory: 'no_show',
      cancelReason: reason || '乘客未到場（no-show）',
      'statusHistory.cancelledAt': FieldValue.serverTimestamp(),
    });

    // 累計醜點（+2）— 內含 lazy 6m 歸零、audit log、LINE 推播判定
    let penaltyResult: Awaited<ReturnType<typeof applyUglyPoint>> | null = null;
    try {
      penaltyResult = await applyUglyPoint(db, {
        ownerUid: orderUserId,
        type: 'no_show',
        orderId,
        event,
        auth,
      });
    } catch (err) {
      console.error('[admin/orders/no-show] applyUglyPoint failed:', err);
    }

    await writeAuditLog({
      event,
      auth,
      action: 'order.mark_no_show',
      targetType: 'order',
      targetId: orderId,
      payload: {
        before: prevStatus,
        ownerUid: orderUserId,
        reason: reason || null,
        newUglyCount: penaltyResult?.newCount ?? null,
        uglyAdded: penaltyResult?.added ?? null,
        push: penaltyResult?.push ?? null,
      },
    });

    return successResponse({
      orderId,
      cancellationCategory: 'no_show',
      uglyCount: penaltyResult?.newCount ?? null,
      pushed: penaltyResult?.push ?? null,
    });
  } catch (err) {
    console.error('[admin/orders/no-show] failed:', err);
    return serverError();
  }
});
