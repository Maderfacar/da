import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

// Wave 2 P4：取乘客自己「下一趟」訂單 — pickupDateTime 最近一筆 active order
// active 定義：pending / confirmed / en_route / arrived_pickup / in_transit
// 排除：completed / cancelled
// 不存在則回 data: null
const ACTIVE_STATUSES = ['pending', 'confirmed', 'en_route', 'arrived_pickup', 'in_transit'];

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db
      .collection('orders')
      .where('userId', '==', auth.lineUid)
      .where('orderStatus', 'in', ACTIVE_STATUSES)
      .get();

    if (snapshot.empty) return successResponse(null);

    type GooglePlaceLite = { address: string; lat: number; lng: number; placeId?: string; displayName?: string };

    // Server 內存排序 pickupDateTime ASC（避免 Firestore composite index 需 orderStatus IN + pickupDateTime ORDER BY）
    const orders = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          orderId: d.orderId as string,
          orderType: d.orderType as string,
          pickupDateTime: d.pickupDateTime as string,
          pickupLocation: d.pickupLocation as GooglePlaceLite,
          dropoffLocation: d.dropoffLocation as GooglePlaceLite,
          vehicleType: d.vehicleType as string,
          passengerCount: (d.passengerCount as number) ?? 1,
          estimatedFare: (d.estimatedFare as number) ?? 0,
          orderStatus: (d.orderStatus as string) ?? 'pending',
        };
      })
      .filter((o) => Number.isFinite(Date.parse(o.pickupDateTime)))
      .sort((a, b) => Date.parse(a.pickupDateTime) - Date.parse(b.pickupDateTime));

    return successResponse(orders[0] ?? null);
  } catch (err) {
    console.error('[orders/upcoming] Firestore query failed:', err);
    return serverError();
  }
});
