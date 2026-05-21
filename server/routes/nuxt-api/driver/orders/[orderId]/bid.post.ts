/**
 * POST /nuxt-api/driver/orders/:orderId/bid — Phase 1E
 *
 * Driver 對某筆 dispatched 訂單喊單：
 *   - transaction 守 status='pending' && dispatchAt != null && !assignedDriverId && 自己沒未撤回 bid
 *   - append { driverId, driverDisplayName, bidAt } 到 bids[]
 *   - audit log: action='order.bid'
 *
 * 認證：driver + approved
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { appendBid, loadDriverDisplayName, DispatchGuardError } from '@@/utils/order-dispatch';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }
  if (!auth.approved) {
    return forbiddenError({ zh_tw: '司機尚未通過審核', en: 'Driver not approved', ja: 'ドライバー審査未完了' });
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
    const displayName = await loadDriverDisplayName(db, auth.lineUid);

    try {
      await appendBid(db, orderId, auth.lineUid, displayName);
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'order_not_found') {
          return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
        }
        if (err.code === 'invalid_status') {
          return badRequestError({ zh_tw: '訂單未派發或狀態異常', en: 'Order not dispatchable', ja: '注文は派遣可能な状態ではありません' });
        }
        if (err.code === 'already_assigned') {
          return badRequestError({ zh_tw: '訂單已指派其他司機', en: 'Order already assigned', ja: '注文は既に他のドライバーに割り当て済み' });
        }
        if (err.code === 'driver_already_bid') {
          return badRequestError({ zh_tw: '您已喊單，請先撤回再重新喊單', en: 'You have already bid; withdraw first', ja: '既に入札済みです' });
        }
      }
      throw err;
    }

    await writeAuditLog({
      event,
      auth,
      action: 'order.bid',
      targetType: 'order',
      targetId: orderId,
      payload: { driverId: auth.lineUid },
    });

    return successResponse({ orderId, bid: true });
  } catch (err) {
    console.error('[driver/orders/bid.post] failed:', err);
    return serverError();
  }
});
