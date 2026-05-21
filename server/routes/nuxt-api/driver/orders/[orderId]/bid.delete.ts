/**
 * DELETE /nuxt-api/driver/orders/:orderId/bid — Phase 1E
 *
 * Driver 撤回自己對某筆訂單的喊單（在 admin 還沒指派前都可撤）：
 *   - transaction 守 status='pending' && !assignedDriverId && driver 有 active bid
 *   - 把對應 bid 的 withdrawnAt 設為 now（保留歷史；admin 看 bids 時灰掉）
 *   - audit log: action='order.bid_withdraw'
 *
 * 認證：driver
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { withdrawBid, DispatchGuardError } from '@@/utils/order-dispatch';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
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
      await withdrawBid(db, orderId, auth.lineUid);
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'order_not_found') {
          return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
        }
        if (err.code === 'invalid_status') {
          return badRequestError({ zh_tw: '訂單狀態異常', en: 'Order status invalid', ja: '注文ステータス異常' });
        }
        if (err.code === 'already_assigned') {
          return badRequestError({ zh_tw: '訂單已指派，無法撤回喊單', en: 'Order already assigned', ja: '注文は既に割り当て済み' });
        }
        if (err.code === 'bid_not_found') {
          return badRequestError({ zh_tw: '您尚未喊單或已撤回', en: 'No active bid found', ja: 'アクティブな入札がありません' });
        }
      }
      throw err;
    }

    await writeAuditLog({
      event,
      auth,
      action: 'order.bid_withdraw',
      targetType: 'order',
      targetId: orderId,
      payload: { driverId: auth.lineUid },
    });

    return successResponse({ orderId, withdrawn: true });
  } catch (err) {
    console.error('[driver/orders/bid.delete] failed:', err);
    return serverError();
  }
});
