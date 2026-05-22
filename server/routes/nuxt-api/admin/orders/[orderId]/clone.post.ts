/**
 * POST /nuxt-api/admin/orders/:orderId/clone
 *
 * Admin 以既有訂單為樣板，**複製成一張新訂單**（乘客為 guest），預設立即派發。
 *
 * 動機：admin 驗證 driver 端 LINE Flex CTA / 喊單流程時，重發既有訂單會被
 *   `already_dispatched` 擋；走前端 booking 又太繞。clone 直接拿同一組路線/車型/
 *   偏好標籤產出新訂單 + dispatch，省到只剩一個點擊。
 *
 * 複製的欄位（會帶到新訂單）：
 *   - orderType / pickupDateTime / pickupLocation / dropoffLocation / stopovers
 *   - vehicleType / passengerCount / luggageItems / extraServices
 *   - estimatedFare / estimatedTime / distanceKm
 *   - flightNumber / terminal / notes
 *   - preferences（重要：driver match 用這個算分數）
 *   - passengerName / contactPhone（admin 也可在 modal 修；這裡先沿用）
 *
 * **不會**複製的欄位（刻意丟掉）：
 *   - userId / lineUserId（一律覆為 guest:<uuid>，避免推到真實乘客）
 *   - orderStatus / dispatchAt / bids / assignedDriverId / 任何歷程
 *   - bidHistory / reMatchRound / statusHistory / passengerConfirmationStatus
 *   - fareBreakdown / fareVersion（沿用既有 v1 預設，避免帶 v2 結構不一致）
 *
 * Body:
 *   - autoDispatch?: boolean（預設 true）
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { dispatchOrder, loadActiveDrivers, DispatchGuardError } from '@@/utils/order-dispatch';
import { pushOrderDispatchToDrivers, getDispatchPushEnv, type DispatchedOrderSummary } from '@@/utils/line-dispatch-push';

interface CloneOrderBody {
  /** 預設 true；false 則只 clone 為 pending 狀態，不自動發單 */
  autoDispatch?: boolean;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const sourceOrderId = getRouterParam(event, 'orderId');
  if (!sourceOrderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文IDが必要です' });
  }

  const body = await readBody<CloneOrderBody>(event).catch(() => ({} as CloneOrderBody));
  const autoDispatch = body.autoDispatch !== false; // 預設 true

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

  // 讀來源訂單
  const snap = await db.collection('orders').doc(sourceOrderId).get();
  if (!snap.exists) {
    return notFoundError({ zh_tw: '來源訂單不存在', en: 'Source order not found', ja: '元の注文が見つかりません' });
  }
  const src = snap.data() ?? {};

  const newOrderId = crypto.randomUUID();
  const guestUserId = `guest:${crypto.randomUUID()}`;

  // 組新訂單 doc — 只挑可安全複製的欄位
  const newOrder: Record<string, unknown> = {
    orderId: newOrderId,
    userId: guestUserId,
    lineUserId: guestUserId,
    orderType: src.orderType ?? 'transfer',
    pickupDateTime: src.pickupDateTime ?? '',
    pickupLocation: src.pickupLocation ?? null,
    dropoffLocation: src.dropoffLocation ?? null,
    stopovers: Array.isArray(src.stopovers) ? src.stopovers : [],
    passengerCount: typeof src.passengerCount === 'number' ? src.passengerCount : 1,
    luggageItems: Array.isArray(src.luggageItems) ? src.luggageItems : [],
    vehicleType: src.vehicleType ?? '',
    extraServices: Array.isArray(src.extraServices) ? src.extraServices : [],
    estimatedFare: typeof src.estimatedFare === 'number' ? src.estimatedFare : 0,
    estimatedTime: typeof src.estimatedTime === 'number' ? src.estimatedTime : 0,
    distanceKm: typeof src.distanceKm === 'number' ? src.distanceKm : 0,
    fareVersion: 'v1',
    fareBreakdown: null,
    passengerName: typeof src.passengerName === 'string' ? src.passengerName : '',
    contactPhone: typeof src.contactPhone === 'string' ? src.contactPhone : '',
    flightNumber: typeof src.flightNumber === 'string' ? src.flightNumber : null,
    terminal: typeof src.terminal === 'string' ? src.terminal : null,
    notes: typeof src.notes === 'string' ? src.notes : null,
    orderStatus: 'pending',
    isManualOrder: true,
    clonedFrom: sourceOrderId, // audit trail：方便 admin 排查訂單來源
    createdBy: auth.lineUid,
    createdAt: FieldValue.serverTimestamp(),
  };

  // 偏好標籤（Phase 1D）— driver match 用，務必帶
  if (src.preferences && typeof src.preferences === 'object') {
    newOrder.preferences = src.preferences;
  }

  try {
    await db.collection('orders').doc(newOrderId).set(newOrder);
  } catch (err) {
    console.error('[admin/orders/clone] Firestore write failed:', err);
    return serverError({ zh_tw: '訂單複製失敗', en: 'Failed to clone order', ja: '注文の複製に失敗しました' });
  }

  await writeAuditLog({
    event,
    auth,
    action: 'order.create',
    targetType: 'order',
    targetId: newOrderId,
    payload: { clonedFrom: sourceOrderId, autoDispatch },
  });

  // 立即派發（預設）
  let dispatched = false;
  if (autoDispatch) {
    try {
      await dispatchOrder(db, newOrderId, auth.lineUid);
      dispatched = true;

      const pref = newOrder.preferences as { tagSnapshot?: Array<{ name?: { zh_tw?: string } }> } | undefined;
      const preferenceChips = Array.isArray(pref?.tagSnapshot)
        ? pref!.tagSnapshot!.map((t) => t?.name?.zh_tw ?? '').filter(Boolean)
        : [];

      const pickupLoc = newOrder.pickupLocation as { displayName?: string; address?: string } | null;
      const dropoffLoc = newOrder.dropoffLocation as { displayName?: string; address?: string } | null;
      const payload: DispatchedOrderSummary = {
        orderId: newOrderId,
        pickupDateTime: (newOrder.pickupDateTime as string) ?? '',
        pickupAddress: pickupLoc?.displayName || pickupLoc?.address || '',
        dropoffAddress: dropoffLoc?.displayName || dropoffLoc?.address || '',
        passengerCount: (newOrder.passengerCount as number) ?? 1,
        estimatedFare: (newOrder.estimatedFare as number) ?? 0,
        preferenceChips,
      };

      void (async () => {
        try {
          const drivers = await loadActiveDrivers(db);
          const lineUserIds = drivers.map((dv) => dv.lineUserId).filter(Boolean);
          await pushOrderDispatchToDrivers(payload, getDispatchPushEnv(), lineUserIds);
        } catch (err) {
          console.error('[admin/orders/clone] multicast failed:', err);
        }
      })();

      await writeAuditLog({
        event,
        auth,
        action: 'order.dispatch',
        targetType: 'order',
        targetId: newOrderId,
        payload: { dispatchAt: 'server', viaClone: true, clonedFrom: sourceOrderId },
      });
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        console.warn('[admin/orders/clone] auto-dispatch guard failed:', err.code);
      } else {
        console.error('[admin/orders/clone] auto-dispatch failed:', err);
      }
    }
  }

  return successResponse({
    orderId: newOrderId,
    orderStatus: 'pending',
    dispatched,
    clonedFrom: sourceOrderId,
  });
});
