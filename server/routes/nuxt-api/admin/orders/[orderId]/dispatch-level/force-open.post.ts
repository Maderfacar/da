/**
 * POST /nuxt-api/admin/orders/:orderId/dispatch-level/force-open — Wave 2D
 *
 * Admin 對 pending 訂單「全開放」：currentLevel 直接設為 '0'（不分等級全車隊都看得到）。
 *
 * 守則：與 downgrade 相同（admin + canManageOrders + pending + dispatched + 未指派 + 非 '0'）。
 *
 * 寫入（共用 downgradeDispatchLevel，mode='force-open'）：
 *  - dispatchVisibility.currentLevel = '0'
 *  - dispatchVisibility.openedAt = serverTimestamp
 *  - levelHistory append { reason: 'force-open-all', openedBy: adminLineUid }
 *
 * 副作用：
 *  - fire-and-forget LINE multicast 推 dispatch.level-down template 給全 approved driver
 *  - audit log action='order.dispatch_level.force_open'
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  successResponse,
  badRequestError,
  forbiddenError,
  notFoundError,
  serverError,
} from '@@/utils/response';
import { downgradeDispatchLevel, DispatchGuardError } from '@@/utils/order-dispatch';
import {
  multicastLevelDown,
  getDispatchPushEnv,
  buildDispatchedOrderSummary,
} from '@@/utils/line-dispatch-push';
import { buildOrderDriverParams, type OrderDataLike } from '@@/utils/template-params';

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

    let result;
    try {
      result = await downgradeDispatchLevel(db, orderId, {
        mode: 'force-open',
        actor: auth.lineUid,
      });
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'order_not_found') {
          return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
        }
        if (err.code === 'invalid_status') {
          return badRequestError({ zh_tw: '訂單狀態非 pending 或尚未派發', en: 'Order not pending or not dispatched', ja: '注文が pending でないか派遣前です' });
        }
        if (err.code === 'already_assigned') {
          return badRequestError({ zh_tw: '訂單已指派司機', en: 'Order already assigned', ja: '注文は既に割り当て済みです' });
        }
        if (err.code === 'already_at_lowest_level') {
          return badRequestError({ zh_tw: '訂單已是最低等級（全車隊）', en: 'Order already at lowest level', ja: '注文は既に最低等級です' });
        }
      }
      throw err;
    }

    // 重讀 order 拿最新 payload 推 LINE 全 approved driver
    const snap = await db.collection('orders').doc(orderId).get();
    if (snap.exists) {
      const orderData = snap.data() ?? {};
      const payload = buildDispatchedOrderSummary(orderId, orderData);
      const env = getDispatchPushEnv();
      // 2026-06-08 Phase 2：placeholder params（dispatch.level-down title / ctaLabel 替換用）
      const dispatchParams = buildOrderDriverParams(orderData as OrderDataLike, null, { orderId });
      void (async () => {
        try {
          await multicastLevelDown(db, payload, env, result.newLevel, dispatchParams);
        } catch (err) {
          console.error('[admin/orders/dispatch-level/force-open] multicast failed:', err);
        }
      })();
    }

    await writeAuditLog({
      event,
      auth,
      action: 'order.dispatch_level.force_open',
      targetType: 'order',
      targetId: orderId,
      payload: {
        previousLevel: result.previousLevel,
        newLevel: result.newLevel,
      },
    });

    return successResponse({
      orderId,
      previousLevel: result.previousLevel,
      newLevel: result.newLevel,
    });
  } catch (err) {
    console.error('[admin/orders/dispatch-level/force-open] failed:', err);
    return serverError();
  }
});
