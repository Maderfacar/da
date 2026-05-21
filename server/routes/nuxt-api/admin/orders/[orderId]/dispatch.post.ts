/**
 * POST /nuxt-api/admin/orders/:orderId/dispatch — Phase 1E
 *
 * Admin 對某筆 pending 訂單發出需求單：
 *   - 守則：order.status === 'pending' && !order.dispatchAt
 *   - 寫 dispatchAt（serverTimestamp）+ dispatchedBy（admin lineUid）
 *   - 觸發 LINE multicast 給所有 approved driver（fire-and-forget；用 driver OA）
 *   - audit log: action='order.dispatch'
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { dispatchOrder, loadActiveDrivers, DispatchGuardError } from '@@/utils/order-dispatch';
import { pushOrderDispatchToDrivers, getDispatchPushEnv, type DispatchedOrderSummary } from '@@/utils/line-dispatch-push';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文IDが必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    try {
      await dispatchOrder(db, orderId, auth.lineUid);
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'order_not_found') {
          return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
        }
        if (err.code === 'invalid_status') {
          return badRequestError({ zh_tw: '訂單狀態非 pending', en: 'Order status is not pending', ja: '注文ステータスが pending ではありません' });
        }
        if (err.code === 'already_dispatched') {
          return badRequestError({ zh_tw: '訂單已派發', en: 'Order already dispatched', ja: '注文は既に派遣済みです' });
        }
      }
      throw err;
    }

    // 讀訂單最新內容 + 推播
    const snap = await db.collection('orders').doc(orderId).get();
    const d = snap.data() ?? {};
    const pref = d.preferences as { tagSnapshot?: Array<{ name?: { zh_tw?: string } }> } | undefined;
    const preferenceChips = Array.isArray(pref?.tagSnapshot)
      ? pref!.tagSnapshot!.map((t) => t?.name?.zh_tw ?? '').filter(Boolean)
      : [];
    const payload: DispatchedOrderSummary = {
      orderId,
      pickupDateTime: (d.pickupDateTime as string) ?? '',
      pickupAddress: (d.pickupLocation?.displayName as string) || (d.pickupLocation?.address as string) || '',
      dropoffAddress: (d.dropoffLocation?.displayName as string) || (d.dropoffLocation?.address as string) || '',
      passengerCount: (d.passengerCount as number) ?? 1,
      estimatedFare: (d.estimatedFare as number) ?? 0,
      preferenceChips,
    };

    // fire-and-forget 推播 + audit
    void (async () => {
      try {
        const drivers = await loadActiveDrivers(db);
        const lineUserIds = drivers.map((dv) => dv.lineUserId).filter(Boolean);
        await pushOrderDispatchToDrivers(payload, getDispatchPushEnv(), lineUserIds);
      } catch (err) {
        console.error('[admin/orders/dispatch] multicast failed:', err);
      }
    })();

    await writeAuditLog({
      event,
      auth,
      action: 'order.dispatch',
      targetType: 'order',
      targetId: orderId,
      payload: {
        dispatchAt: 'server',
        preferenceCount: preferenceChips.length,
      },
    });

    return successResponse({ orderId, dispatched: true });
  } catch (err) {
    console.error('[admin/orders/dispatch] failed:', err);
    return serverError();
  }
});
