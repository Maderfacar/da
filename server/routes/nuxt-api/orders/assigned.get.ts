import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

// P19：driver 取自己被指派的 active orders（confirmed / en_route / arrived_pickup / in_transit）
// completed / cancelled 不回（過去訂單），pending 不回（未被指派）
const ACTIVE_STATUSES = ['confirmed', 'en_route', 'arrived_pickup', 'in_transit'];

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  // 必須是已核准的 driver；admin 也允許（協助偵錯）但須帶 query.driverId
  const isDriver = auth.roles.includes('driver') && auth.approved;
  const isAdmin = auth.roles.includes('admin');
  if (!isDriver && !isAdmin) {
    return forbiddenError({
      zh_tw: '僅司機可查詢任務列表',
      en: 'Only drivers can fetch assigned orders',
      ja: 'ドライバーのみが任務一覧を取得できます',
    });
  }

  // assignedDriverId 在 orders 是 'line:Uxxx' 格式（auth.uid 同格式）
  // admin 可帶 query.driverId（含 prefix 或不含都接受）查指定司機
  const query = getQuery(event);
  let targetDriverId = auth.uid; // driver 預設查自己
  if (isAdmin && typeof query.driverId === 'string' && query.driverId.length > 0) {
    targetDriverId = query.driverId.startsWith('line:') ? query.driverId : `line:${query.driverId}`;
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db
      .collection('orders')
      .where('assignedDriverId', '==', targetDriverId)
      .where('orderStatus', 'in', ACTIVE_STATUSES)
      .get();

    const orders = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          orderId: d.orderId as string,
          orderType: d.orderType as string,
          pickupDateTime: d.pickupDateTime as string,
          pickupLocation: d.pickupLocation as { address: string; lat: number; lng: number; displayName?: string },
          dropoffLocation: d.dropoffLocation as { address: string; lat: number; lng: number; displayName?: string },
          vehicleType: d.vehicleType as string,
          passengerCount: (d.passengerCount as number) ?? 1,
          estimatedFare: (d.estimatedFare as number) ?? 0,
          distanceKm: (d.distanceKm as number) ?? 0,
          orderStatus: d.orderStatus as string,
          createdAt: d.createdAt?.toMillis?.() ?? 0,
        };
      })
      // pickupDateTime 升序（最早要去接的優先顯示）
      .sort((a, b) => {
        const ta = new Date(a.pickupDateTime).getTime();
        const tb = new Date(b.pickupDateTime).getTime();
        return ta - tb;
      });

    return successResponse(orders);
  } catch (err) {
    console.error('[orders/assigned] Firestore query failed:', err);
    return serverError();
  }
});
