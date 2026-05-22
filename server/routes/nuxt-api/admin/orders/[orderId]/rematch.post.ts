/**
 * POST /nuxt-api/admin/orders/:orderId/rematch — Phase 1F
 *
 * Admin 在 confirmed 訂單觸發「強制重新配對」：
 *   - body: { reason?: string }（admin 填的原因，存進 audit + bidHistory.endedBy meta）
 *   - transaction 守 status='confirmed' && assignedDriverId 存在
 *   - 把當下 bids snapshot 到 bidHistory；清掉 driverId / assignedAt / assignedBy / bids / passengerConfirmationStatus
 *   - dispatchAt = serverTimestamp、reMatchRound++、status='pending'
 *   - 觸發三個推播（fire-and-forget）：
 *       1. 原中選 driver — deselect 通知（繁中文字）
 *       2. 所有 active driver — 新需求單 multicast Flex（重新喊單）
 *       3. passenger — 「正在重新為您配對」三語 Flex
 *   - audit log: action='order.rematch' + payload.reason
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { rematchOrder } from '@@/utils/order-soft-match';
import { DispatchGuardError, loadActiveDrivers } from '@@/utils/order-dispatch';
import {
  pushOrderDispatchToDrivers,
  getDispatchPushEnv,
} from '@@/utils/line-dispatch-push';
import { pushDriverDeselected, pushPassengerRematch } from '@@/utils/line-soft-match-push';
import { buildTagIndex } from '@@/utils/vehicle-profile';
import { getUserLang } from '@@/utils/i18n-message';

interface PostBody {
  reason?: string;
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

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文IDが必要です' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  const reason = typeof body?.reason === 'string' ? body!.reason.trim() : '';

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    let prevDriverLineUid: string;
    let reMatchRound: number;
    try {
      const r = await rematchOrder(db, orderId, 'rematched_by_admin', auth.lineUid);
      prevDriverLineUid = r.prevDriverLineUid;
      reMatchRound = r.reMatchRound;
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'order_not_found') {
          return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
        }
        if (err.code === 'invalid_status') {
          return badRequestError({
            zh_tw: '訂單狀態不可重新配對（僅 confirmed 且已指派的訂單可用）',
            en: 'Order not eligible for re-matching (must be confirmed + assigned)',
            ja: '再マッチングできません（confirmed + 割当済みのみ可）',
          });
        }
      }
      throw err;
    }

    // 撈最新 order + 原 driver user 資料
    const [orderSnap, prevDriverSnap] = await Promise.all([
      db.collection('orders').doc(orderId).get(),
      db.collection('users').doc(prevDriverLineUid).get(),
    ]);
    const orderData = orderSnap.data() ?? {};
    const prevDriverData = prevDriverSnap.exists ? (prevDriverSnap.data() ?? {}) : {};
    const prevDriverLineUserId = (prevDriverData.lineUserId as string | undefined) ?? prevDriverLineUid;

    const env = getDispatchPushEnv();
    const passengerLineUid = (orderData.lineUserId as string | undefined) || (orderData.userId as string | undefined) || '';
    const pickupDateTime = (orderData.pickupDateTime as string) ?? '';
    const pickupAddress = (orderData.pickupLocation?.displayName as string) || (orderData.pickupLocation?.address as string) || '';
    const dropoffAddress = (orderData.dropoffLocation?.displayName as string) || (orderData.dropoffLocation?.address as string) || '';
    const passengerCount = (orderData.passengerCount as number) ?? 1;
    // Booking v2 批次 2：fallback 舊單無 adult/child
    const adultCount = (orderData.adultCount as number | undefined) ?? passengerCount;
    const childCount = (orderData.childCount as number | undefined) ?? 0;
    const estimatedFare = (orderData.estimatedFare as number) ?? 0;

    // 偏好標籤中文名（dispatch Flex 顯示用）
    const tagIdx = await buildTagIndex(db);
    const preferences = orderData.preferences as { tagIds?: unknown } | undefined;
    const preferenceTagIds: string[] = Array.isArray(preferences?.tagIds) ? (preferences!.tagIds as string[]) : [];
    const preferenceChips = preferenceTagIds
      .map((id) => tagIdx.get(id)?.nameZh ?? '')
      .filter((s) => s.length > 0);

    // 1. fire-and-forget：deselect 通知原中選 driver
    void (async () => {
      try {
        await pushDriverDeselected(prevDriverLineUserId, { orderId, pickupDateTime });
      } catch (err) {
        console.error('[admin/orders/rematch] driver deselect push failed:', err);
      }
    })();

    // 2. fire-and-forget：重新派發（multicast 給所有 active driver）
    void (async () => {
      try {
        const drivers = await loadActiveDrivers(db);
        const lineUserIds = drivers.map((d) => d.lineUserId);
        await pushOrderDispatchToDrivers({
          orderId,
          pickupDateTime,
          pickupAddress,
          dropoffAddress,
          passengerCount,
          adultCount,
          childCount,
          estimatedFare,
          preferenceChips,
        }, env, lineUserIds);
      } catch (err) {
        console.error('[admin/orders/rematch] dispatch multicast failed:', err);
      }
    })();

    // 3. fire-and-forget：通知 passenger 「正在重新配對」
    void (async () => {
      try {
        if (!passengerLineUid) return;
        const lang = await getUserLang(db, passengerLineUid);
        await pushPassengerRematch(passengerLineUid, { orderId, pickupDateTime }, lang);
      } catch (err) {
        console.error('[admin/orders/rematch] passenger rematch push failed:', err);
      }
    })();

    await writeAuditLog({
      event,
      auth,
      action: 'order.rematch',
      targetType: 'order',
      targetId: orderId,
      payload: {
        triggeredBy: 'admin',
        reason,
        reMatchRound,
        prevDriverId: prevDriverLineUid,
      },
    });

    return successResponse({
      orderId,
      rematched: true,
      reMatchRound,
      prevDriverId: prevDriverLineUid,
    });
  } catch (err) {
    console.error('[admin/orders/rematch] failed:', err);
    return serverError();
  }
});
