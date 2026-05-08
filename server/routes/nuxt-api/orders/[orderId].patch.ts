import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { successResponse, badRequestError, notFoundError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

interface PatchOrderBody {
  orderStatus?: string;
  assignedDriverId?: string;
}

export default defineEventHandler(async (event) => {
  // P14：必須登入；訂單 owner 只能取消，admin/driver 可任意更新
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文 ID が不足しています' });
  }

  const body = await readBody<PatchOrderBody>(event);
  const updates: Record<string, string> = {};
  if (body.orderStatus) updates.orderStatus = body.orderStatus;
  if (body.assignedDriverId !== undefined) updates.assignedDriverId = body.assignedDriverId;

  if (!Object.keys(updates).length) {
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

    // P14：權限分流
    //   - admin / driver：任意更新
    //   - 訂單 owner（passenger）：只能取消（orderStatus='cancelled'），不能改 assignedDriverId
    const orderData = snap.data() ?? {};
    const orderUserId = (orderData.userId as string) ?? '';
    const isAdmin = auth.roles.includes('admin');
    const isDriver = auth.roles.includes('driver');
    const isOwner = orderUserId === auth.lineUid;

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

    await ref.update(updates);

    // P18：當訂單狀態剛切換為 'completed'（前一狀態非 completed），對司機 drivers doc 累加統計
    // - assignedDriverId 在 orders 內格式為 'line:Uxxx'，須去 prefix 對應 drivers doc key
    // - 用 set({ ...increments }, { merge: true }) 容錯 drivers doc 不存在情境（歷史司機未走 apply）
    // - 失敗只 log，不影響訂單更新成功 response（訂單已成功 update）
    const wasCompleted = (orderData.orderStatus as string | undefined) === 'completed';
    if (body.orderStatus === 'completed' && !wasCompleted) {
      const rawDriverId = orderData.assignedDriverId as string | undefined;
      if (rawDriverId) {
        const driverLineUid = rawDriverId.startsWith('line:') ? rawDriverId.slice(5) : rawDriverId;
        const fare = (orderData.estimatedFare as number) ?? 0;
        const distance = (orderData.distanceKm as number) ?? 0;
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
      }
    }

    return successResponse({ orderId, ...updates });
  } catch (err) {
    console.error('[orders/patch] Firestore update failed:', err);
    return serverError();
  }
});
