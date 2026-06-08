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
import { dispatchOrder, DispatchGuardError } from '@@/utils/order-dispatch';
import { multicastByLevel, getDispatchPushEnv, type DispatchedOrderSummary } from '@@/utils/line-dispatch-push';
import { buildOrderDriverParams, type OrderDataLike } from '@@/utils/template-params';
import { isDispatchLevel, type DispatchLevel } from '~shared/types/dispatch-visibility';

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

  // Wave 2B+2C：startLevel 控制首發可見範圍（'2'/'1'/'0'）；未傳 fallback '0' 全車隊
  const body = await readBody<{ startLevel?: unknown }>(event).catch(() => ({}));
  let startLevel: DispatchLevel = '0';
  if (body?.startLevel !== undefined) {
    if (!isDispatchLevel(body.startLevel)) {
      return badRequestError({
        zh_tw: '首發等級不合法（限 0 / 1 / 2）',
        en: 'Invalid startLevel (allowed: 0 / 1 / 2)',
        ja: 'startLevel が不正です（0 / 1 / 2 のみ）',
      });
    }
    startLevel = body.startLevel;
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    try {
      await dispatchOrder(db, orderId, auth.lineUid, startLevel);
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
      // Booking v2 批次 2：fallback 舊單無 adult/child
      adultCount: (d.adultCount as number | undefined) ?? ((d.passengerCount as number | undefined) ?? 1),
      childCount: (d.childCount as number | undefined) ?? 0,
      estimatedFare: (d.estimatedFare as number) ?? 0,
      preferenceChips,
    };

    // 2026-06-08 Phase 2：placeholder params（dispatch.driver-pending title / ctaLabel 替換用）
    const dispatchParams = buildOrderDriverParams(d as OrderDataLike, null, { orderId });

    // fire-and-forget 推播 + audit（Wave 2B+2C：只推給 driverCategory >= startLevel 的司機）
    void (async () => {
      try {
        await multicastByLevel(db, payload, getDispatchPushEnv(), startLevel, dispatchParams);
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
        startLevel,
      },
    });

    return successResponse({ orderId, dispatched: true, startLevel });
  } catch (err) {
    console.error('[admin/orders/dispatch] failed:', err);
    return serverError();
  }
});
