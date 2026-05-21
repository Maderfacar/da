/**
 * POST /nuxt-api/admin/orders/:orderId/assign — Phase 1E
 *
 * Admin 從某筆 dispatched 訂單的 bids 中挑一個 driver 指派：
 *   - body: { driverId: string }（lineUid 去前綴）
 *   - transaction 守 status='pending' && !assignedDriverId && driverId ∈ active bids
 *   - 寫入 assignedDriverId='line:Uxxx' / orderStatus='confirmed' / assignedAt / assignedBy
 *   - 推 2 個 LINE：乘客（passenger OA + 連 /vehicles/{driverId}）/ 司機（driver OA）
 *   - audit log: action='order.assign'（含 driverId snapshot）
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { assignDriver, DispatchGuardError } from '@@/utils/order-dispatch';
import { getUserLang } from '@@/utils/i18n-message';
import {
  pushOrderAssignedToPassenger,
  pushOrderAssignedToDriver,
  getDispatchPushEnv,
} from '@@/utils/line-dispatch-push';

interface PostBody {
  driverId?: string;
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
  const rawDriverId = typeof body?.driverId === 'string' ? body.driverId.trim() : '';
  if (!rawDriverId) {
    return badRequestError({ zh_tw: '缺少 driverId', en: 'driverId required', ja: 'driverId が必要です' });
  }
  const driverLineUid = rawDriverId.startsWith('line:') ? rawDriverId.slice(5) : rawDriverId;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    try {
      await assignDriver(db, orderId, driverLineUid, auth.lineUid);
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'order_not_found') {
          return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
        }
        if (err.code === 'invalid_status') {
          return badRequestError({ zh_tw: '訂單狀態不可指派', en: 'Order not in dispatchable state', ja: '注文ステータスは派遣不可' });
        }
        if (err.code === 'already_assigned') {
          return badRequestError({ zh_tw: '訂單已指派司機', en: 'Order already assigned', ja: '注文は既に割り当て済み' });
        }
        if (err.code === 'driver_not_in_bids') {
          return badRequestError({ zh_tw: '該司機未在喊單清單', en: 'Driver not in active bids', ja: 'このドライバーは入札していません' });
        }
      }
      throw err;
    }

    // 撈最新 order + driver 資料給推播 / audit 用
    const [orderSnap, driverSnap] = await Promise.all([
      db.collection('orders').doc(orderId).get(),
      db.collection('users').doc(driverLineUid).get(),
    ]);
    const orderData = orderSnap.data() ?? {};
    const driverData = driverSnap.exists ? (driverSnap.data() ?? {}) : {};
    const driverDisplayName = (driverData.displayName as string | undefined) ?? '';
    const driverLineUserId = (driverData.lineUserId as string | undefined) ?? driverLineUid;

    const env = getDispatchPushEnv();
    const passengerLineUid = (orderData.lineUserId as string | undefined) || (orderData.userId as string | undefined) || '';
    const pickupDateTime = (orderData.pickupDateTime as string) ?? '';
    const pickupAddress = (orderData.pickupLocation?.displayName as string) || (orderData.pickupLocation?.address as string) || '';
    const dropoffAddress = (orderData.dropoffLocation?.displayName as string) || (orderData.dropoffLocation?.address as string) || '';
    const passengerCount = (orderData.passengerCount as number) ?? 1;

    // fire-and-forget 雙推播
    void (async () => {
      try {
        if (passengerLineUid) {
          const lang = await getUserLang(db, passengerLineUid);
          await pushOrderAssignedToPassenger(passengerLineUid, {
            orderId,
            pickupDateTime,
            driverDisplayName,
            driverId: driverLineUid,
          }, env, lang);
        }
      } catch (err) {
        console.error('[admin/orders/assign] passenger push failed:', err);
      }
    })();
    void (async () => {
      try {
        await pushOrderAssignedToDriver(driverLineUserId, {
          orderId,
          pickupDateTime,
          pickupAddress,
          dropoffAddress,
          passengerCount,
        }, env);
      } catch (err) {
        console.error('[admin/orders/assign] driver push failed:', err);
      }
    })();

    await writeAuditLog({
      event,
      auth,
      action: 'order.assign',
      targetType: 'order',
      targetId: orderId,
      payload: {
        driverId: driverLineUid,
        driverDisplayName,
        via: 'dispatch_bid',
      },
    });

    return successResponse({ orderId, driverId: driverLineUid, assigned: true });
  } catch (err) {
    console.error('[admin/orders/assign] failed:', err);
    return serverError();
  }
});
