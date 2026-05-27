import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

// Wave 2 P4：取乘客自己「下一趟」訂單 — pickupDateTime 最近一筆 active order
// active 定義：pending / confirmed / en_route / arrived_pickup / in_transit
// 排除：completed / cancelled
// 不存在則回 data: null
//
// Home redesign：卡片需要 stopovers / flightNumber / driver（confirmed 後才顯示司機區），
// 擴充本 endpoint 一次拿齊，避免首頁 30s polling 多打一支 /orders/[id] endpoint。
const ACTIVE_STATUSES = ['pending', 'confirmed', 'en_route', 'arrived_pickup', 'in_transit'];
const DRIVER_VISIBLE_STATUSES = new Set(['confirmed', 'en_route', 'arrived_pickup', 'in_transit']);

const _stripLinePrefix = (id: string): string => (id.startsWith('line:') ? id.slice(5) : id);

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
          stopovers: (d.stopovers as GooglePlaceLite[] | undefined) ?? [],
          vehicleType: d.vehicleType as string,
          passengerCount: (d.passengerCount as number) ?? 1,
          // Booking v2 批次 2：fallback 舊單無 adult/child
          adultCount: (d.adultCount as number | undefined) ?? ((d.passengerCount as number | undefined) ?? 1),
          childCount: (d.childCount as number | undefined) ?? 0,
          estimatedFare: (d.estimatedFare as number) ?? 0,
          orderStatus: (d.orderStatus as string) ?? 'pending',
          flightNumber: (d.flightNumber as string | null) ?? null,
          assignedDriverId: (d.assignedDriverId as string | undefined) ?? '',
        };
      })
      .filter((o) => Number.isFinite(Date.parse(o.pickupDateTime)))
      .sort((a, b) => Date.parse(a.pickupDateTime) - Date.parse(b.pickupDateTime));

    const next = orders[0];
    if (!next) return successResponse(null);

    // 司機資訊（confirmed 後才查）— 與 /orders/[orderId].get.ts 邏輯一致
    let driver: {
      displayName: string;
      plateNumber: string;
      vehicleType: string;
      vehicleModel: string;
      phone: string | null;
    } | null = null;

    if (DRIVER_VISIBLE_STATUSES.has(next.orderStatus) && next.assignedDriverId) {
      try {
        const driverLineUid = _stripLinePrefix(next.assignedDriverId);
        const driverSnap = await db.collection('drivers').doc(driverLineUid).get();
        if (driverSnap.exists) {
          const dd = driverSnap.data() ?? {};
          const app = (dd.application as Record<string, unknown> | undefined) ?? {};
          driver = {
            displayName: (dd.displayName as string) ?? (app.driverName as string) ?? '',
            plateNumber: (app.plateNumber as string) ?? '',
            vehicleType: (dd.vehicleType as string) ?? '',
            vehicleModel: (app.vehicleModel as string) ?? (dd.vehicleModel as string) ?? '',
            phone: (app.phone as string) ?? null,
          };
        }
      } catch (err) {
        console.error('[orders/upcoming] driver fetch failed:', err);
      }
    }

    // 排除 assignedDriverId 不外洩到 client
    const { assignedDriverId: _omit, ...publicNext } = next;
    return successResponse({ ...publicNext, driver });
  } catch (err) {
    console.error('[orders/upcoming] Firestore query failed:', err);
    return serverError();
  }
});
