import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { successResponse, badRequestError, notFoundError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

interface PatchOrderBody {
  orderStatus?: string;
  assignedDriverId?: string;
}

// P19：訂單狀態擴充為 7 個值
const VALID_STATUSES = ['pending', 'confirmed', 'en_route', 'arrived_pickup', 'in_transit', 'completed', 'cancelled'] as const;
type OrderStatus = typeof VALID_STATUSES[number];

// P19 driver 嚴格狀態機：driver 推進 status 必須照 confirmed → en_route → arrived_pickup → in_transit → completed
const DRIVER_NEXT_STATUS: Record<string, OrderStatus> = {
  confirmed: 'en_route',
  en_route: 'arrived_pickup',
  arrived_pickup: 'in_transit',
  in_transit: 'completed',
};

// P19：哪些 status 視為司機「執行中」（決定 drivers.status='busy'）
const EXECUTING_STATUSES: OrderStatus[] = ['en_route', 'arrived_pickup', 'in_transit'];

// statusHistory 欄位對應
const STATUS_HISTORY_FIELD: Record<OrderStatus, string | null> = {
  pending: null,
  confirmed: 'statusHistory.confirmedAt',
  en_route: 'statusHistory.enRouteAt',
  arrived_pickup: 'statusHistory.arrivedPickupAt',
  in_transit: 'statusHistory.inTransitAt',
  completed: 'statusHistory.completedAt',
  cancelled: 'statusHistory.cancelledAt',
};

export default defineEventHandler(async (event) => {
  // P14：必須登入；P19：訂單 owner 只能取消，admin 任意更新，driver 自己的訂單按嚴格狀態機推進
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文 ID が不足しています' });
  }

  const body = await readBody<PatchOrderBody>(event);

  // P19：status 必須是合法值
  if (body.orderStatus !== undefined && !VALID_STATUSES.includes(body.orderStatus as OrderStatus)) {
    return badRequestError({
      zh_tw: '無效的訂單狀態',
      en: 'Invalid order status',
      ja: '無効な注文ステータス',
    });
  }

  if (body.orderStatus === undefined && body.assignedDriverId === undefined) {
    return badRequestError({ zh_tw: '沒有可更新的欄位', en: 'No fields to update', ja: '更新するフィールドがありません' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError();
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }

    // 權限分流
    const orderData = snap.data() ?? {};
    const orderUserId = (orderData.userId as string) ?? '';
    const orderAssignedDriver = (orderData.assignedDriverId as string | undefined) ?? '';
    const prevStatus = (orderData.orderStatus as OrderStatus | undefined) ?? 'pending';

    const isAdmin = auth.roles.includes('admin');
    const isDriver = auth.roles.includes('driver');
    const isOwner = orderUserId === auth.lineUid;
    // assignedDriverId 在 orders 是 'line:Uxxx' 格式；auth.uid 同格式（Firebase UID）
    const isAssignedDriver = isDriver && orderAssignedDriver === auth.uid;

    if (!isAdmin && !isDriver && !isOwner) {
      return forbiddenError({ zh_tw: '無權變更此訂單', en: 'Not authorized to modify this order', ja: 'この注文を変更する権限がありません' });
    }

    // owner-only 限制（純 passenger）
    if (isOwner && !isAdmin && !isDriver) {
      if (body.assignedDriverId !== undefined) {
        return forbiddenError({ zh_tw: '無權指派司機', en: 'Cannot assign driver', ja: 'ドライバーを指定する権限がありません' });
      }
      if (body.orderStatus && body.orderStatus !== 'cancelled') {
        return forbiddenError({ zh_tw: '乘客僅能取消訂單', en: 'Passenger can only cancel order', ja: 'お客様はキャンセルのみ可能です' });
      }
    }

    // P19 driver 限制（非 admin 的 driver）：
    //   - 只能改自己被指派的訂單
    //   - status 必須照狀態機推進（不可跳階段）
    //   - 不可改 assignedDriverId（避免 driver 互相搶單 / 搶他人訂單）
    if (isDriver && !isAdmin) {
      if (!isAssignedDriver && body.orderStatus !== 'confirmed') {
        // 例外：driver/pending 搶單時走 confirmed + assignedDriverId（driver 把自己指派為司機）
        if (body.assignedDriverId !== auth.uid) {
          return forbiddenError({
            zh_tw: '無權變更此訂單',
            en: 'Not authorized to modify this order',
            ja: 'この注文を変更する権限がありません',
          });
        }
      }
      if (body.assignedDriverId !== undefined && body.assignedDriverId !== auth.uid) {
        return forbiddenError({
          zh_tw: '司機僅能指派自己',
          en: 'Driver can only assign self',
          ja: 'ドライバーは自分のみ指定可能です',
        });
      }
      if (body.orderStatus && body.orderStatus !== 'cancelled' && body.orderStatus !== 'confirmed') {
        // 嚴格狀態機驗證：driver 推進 status 必須符合 confirmed → en_route → arrived_pickup → in_transit → completed
        const expected = DRIVER_NEXT_STATUS[prevStatus];
        if (expected !== body.orderStatus) {
          return badRequestError({
            zh_tw: `狀態轉換錯誤：${prevStatus} 不可改為 ${body.orderStatus}`,
            en: `Invalid status transition: ${prevStatus} cannot become ${body.orderStatus}`,
            ja: `状態遷移エラー: ${prevStatus} は ${body.orderStatus} に変更できません`,
          });
        }
      }
    }

    // 組裝 update payload
    const updates: Record<string, unknown> = {};
    if (body.orderStatus !== undefined) updates.orderStatus = body.orderStatus;
    if (body.assignedDriverId !== undefined) updates.assignedDriverId = body.assignedDriverId;

    // P19：status 變更時寫入 statusHistory.{state}At
    if (body.orderStatus && body.orderStatus !== prevStatus) {
      const historyField = STATUS_HISTORY_FIELD[body.orderStatus as OrderStatus];
      if (historyField) {
        updates[historyField] = FieldValue.serverTimestamp();
      }
    }

    await ref.update(updates);

    // P19：訂單 status 切 en_route 時，driver doc 自動切 busy（不是 confirmed）
    // - assignedDriverId 在 orders 是 'line:Uxxx'，drivers doc key 是 lineUid（去 prefix）
    if (body.orderStatus === 'en_route' && prevStatus !== 'en_route') {
      const rawDriverId = orderAssignedDriver || (body.assignedDriverId as string | undefined);
      if (rawDriverId) {
        const driverLineUid = rawDriverId.startsWith('line:') ? rawDriverId.slice(5) : rawDriverId;
        try {
          await db.collection('drivers').doc(driverLineUid).set({
            status: 'busy',
            lastActiveAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (err) {
          console.error('[orders/patch] driver busy switch failed:', err);
        }
      }
    }

    // P18：當訂單狀態剛切換為 'completed'（前一狀態非 completed），對司機 drivers doc 累加統計
    // P19：同時 query 該 driver 是否仍有「執行中」訂單；無則 status 切回 'online'
    const wasCompleted = prevStatus === 'completed';
    if (body.orderStatus === 'completed' && !wasCompleted) {
      const rawDriverId = orderAssignedDriver;
      if (rawDriverId) {
        const driverLineUid = rawDriverId.startsWith('line:') ? rawDriverId.slice(5) : rawDriverId;
        const fare = (orderData.estimatedFare as number) ?? 0;
        const distance = (orderData.distanceKm as number) ?? 0;

        // 累加統計
        try {
          await db.collection('drivers').doc(driverLineUid).set({
            totalTrips: FieldValue.increment(1),
            totalEarnings: FieldValue.increment(fare),
            totalDistanceKm: FieldValue.increment(distance),
            todayTrips: FieldValue.increment(1),
            todayEarnings: FieldValue.increment(fare),
            lastTripAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (err) {
          console.error('[orders/patch] driver stats increment failed:', err);
        }

        // P19：query 該 driver 是否仍有其他「執行中」訂單（en_route / arrived_pickup / in_transit）
        // 注意排除剛 update 完的這張（剛改成 completed，但 Firestore 一致性可能需要 query 確認）
        try {
          const remaining = await db.collection('orders')
            .where('assignedDriverId', '==', rawDriverId)
            .where('orderStatus', 'in', EXECUTING_STATUSES)
            .limit(1)
            .get();
          if (remaining.empty) {
            await db.collection('drivers').doc(driverLineUid).set({
              status: 'online',
              lastActiveAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        } catch (err) {
          console.error('[orders/patch] driver online switch query failed:', err);
        }
      }
    }

    return successResponse({ orderId, ...body });
  } catch (err) {
    console.error('[orders/patch] Firestore update failed:', err);
    return serverError();
  }
});
