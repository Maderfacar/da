/**
 * POST /nuxt-api/admin/orders/:orderId/redispatch
 *
 * 對「已派發但未指派」的訂單**重發需求單** — 重新 LINE multicast 給所有 active driver，
 * 訂單本體保留：dispatchAt 不變動（仍是首發時間）、bids 陣列保留（已喊單司機不受影響）。
 *
 * 與 dispatch.post.ts 差異：
 *   - dispatch.post.ts：首次發單；守則 `!order.dispatchAt`（已派發則拒絕）
 *   - redispatch.post.ts：重發；守則 `order.dispatchAt` 已存在（首次未派發則拒絕）
 *
 * 寫入欄位：
 *   - dispatchAt        — **不動**（保留首發時間，audit / SLA 用）
 *   - lastDispatchAt    — 本次重發 serverTimestamp
 *   - dispatchCount     — increment(1)（首發後第一次重發 = 2）
 *   - bids[]            — **不動**（撤回的仍撤回、有效的仍有效）
 *
 * 守則：
 *   - orderStatus === 'pending'      （未完成 / 未取消）
 *   - dispatchAt 存在                （必須先發過）
 *   - !assignedDriverId              （未指派；指派後走 Phase 1F rematch 流程）
 *
 * 推播：與 dispatch.post.ts 同邏輯，重發給**所有 active driver**（不過濾已喊單者）。
 * audit log: `order.redispatch`
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { loadActiveDrivers } from '@@/utils/order-dispatch';
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
    const ref = db.collection('orders').doc(orderId);

    // transaction 守 status / dispatchAt / assignedDriverId + 寫 lastDispatchAt / dispatchCount
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { code: 'not_found' as const };
      const d = snap.data() ?? {};
      if (d.orderStatus !== 'pending') return { code: 'invalid_status' as const };
      if (!d.dispatchAt) return { code: 'never_dispatched' as const };
      if (d.assignedDriverId) return { code: 'already_assigned' as const };

      tx.update(ref, {
        lastDispatchAt: FieldValue.serverTimestamp(),
        dispatchCount: FieldValue.increment(1),
        lastDispatchedBy: auth.lineUid,
      });
      return { code: 'ok' as const, data: d };
    });

    if (result.code === 'not_found') {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }
    if (result.code === 'invalid_status') {
      return badRequestError({ zh_tw: '訂單狀態非 pending', en: 'Order status is not pending', ja: '注文ステータスが pending ではありません' });
    }
    if (result.code === 'never_dispatched') {
      return badRequestError({ zh_tw: '訂單尚未派發，請改點「發出需求單」', en: 'Order has not been dispatched yet', ja: '注文はまだ派遣されていません' });
    }
    if (result.code === 'already_assigned') {
      return badRequestError({ zh_tw: '訂單已指派司機，無法重發', en: 'Order already assigned', ja: '注文は既に割り当て済み' });
    }

    const d = result.data;
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
      // Booking v2 批次 2：fallback 舊單無 adult/child
      adultCount: (d.adultCount as number | undefined) ?? ((d.passengerCount as number | undefined) ?? 1),
      childCount: (d.childCount as number | undefined) ?? 0,
      estimatedFare: (d.estimatedFare as number) ?? 0,
      preferenceChips,
    };

    // fire-and-forget 推播 + audit
    void (async () => {
      try {
        const drivers = await loadActiveDrivers(db);
        const lineUserIds = drivers.map((dv) => dv.lineUserId).filter(Boolean);
        await pushOrderDispatchToDrivers(db, payload, getDispatchPushEnv(), lineUserIds);
      } catch (err) {
        console.error('[admin/orders/redispatch] multicast failed:', err);
      }
    })();

    await writeAuditLog({
      event,
      auth,
      action: 'order.redispatch',
      targetType: 'order',
      targetId: orderId,
      payload: {
        preferenceCount: preferenceChips.length,
      },
    });

    return successResponse({ orderId, redispatched: true });
  } catch (err) {
    console.error('[admin/orders/redispatch] failed:', err);
    return serverError();
  }
});
