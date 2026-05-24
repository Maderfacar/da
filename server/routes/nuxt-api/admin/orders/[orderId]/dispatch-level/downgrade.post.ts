/**
 * POST /nuxt-api/admin/orders/:orderId/dispatch-level/downgrade — Wave 2D
 *
 * Admin 對 pending 訂單「立即降一級」：currentLevel 2→1 或 1→0。
 *
 * 守則：
 *  - admin role + canManageOrders
 *  - 訂單必須 status='pending'、已 dispatched、未指派
 *  - currentLevel !== '0'（已是最低不允許再降）
 *
 * 寫入（共用 downgradeDispatchLevel）：
 *  - dispatchVisibility.currentLevel = nextLowerLevel(currentLevel)
 *  - dispatchVisibility.openedAt = serverTimestamp
 *  - levelHistory append { reason: 'manual-downgrade', openedBy: adminLineUid }
 *
 * 副作用：
 *  - fire-and-forget LINE multicast 推 dispatch.level-down template 給新加入等級 driver
 *  - audit log action='order.dispatch_level.downgrade'，payload 含 before/after level
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
        mode: 'downgrade',
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
          return badRequestError({ zh_tw: '訂單已是最低等級（全車隊），無法再降', en: 'Order already at lowest level', ja: '注文は既に最低等級です' });
        }
      }
      throw err;
    }

    // 重讀 order 拿最新 payload 推 LINE
    const snap = await db.collection('orders').doc(orderId).get();
    if (snap.exists) {
      const payload = buildDispatchedOrderSummary(orderId, snap.data() ?? {});
      const env = getDispatchPushEnv();
      void (async () => {
        try {
          await multicastLevelDown(db, payload, env, result.newLevel);
        } catch (err) {
          console.error('[admin/orders/dispatch-level/downgrade] multicast failed:', err);
        }
      })();
    }

    await writeAuditLog({
      event,
      auth,
      action: 'order.dispatch_level.downgrade',
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
    console.error('[admin/orders/dispatch-level/downgrade] failed:', err);
    return serverError();
  }
});
