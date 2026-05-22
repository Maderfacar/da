import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

// Wave 1 D1：driver 取自己「已完成 / 已取消」歷史訂單
//
// 設計：
// - 只允許 driver 角色（admin 也允許 + 可帶 query.driverId 偵錯）
// - 預設回 completed + cancelled（passenger /orders 改用 P3 endpoint，本端點專給 driver/trip 歷史 tab）
// - 支援 from / to 範圍過濾 pickupDateTime（exclusive end，server 內存過濾）
// - 不依賴 Firestore composite index，內存按 pickupDateTime DESC 排序
const HISTORY_STATUSES = ['completed', 'cancelled'];

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const isDriver = auth.roles.includes('driver') && auth.approved;
  const isAdmin = auth.roles.includes('admin');
  if (!isDriver && !isAdmin) {
    return forbiddenError({
      zh_tw: '僅司機可查詢歷史訂單',
      en: 'Only drivers can fetch order history',
      ja: 'ドライバーのみが履歴を取得できます',
    });
  }

  const query = getQuery(event);
  const { from, to, driverId } = query as { from?: string; to?: string; driverId?: string };

  let targetDriverIdWithPrefix = auth.uid;
  if (isAdmin && typeof driverId === 'string' && driverId.length > 0) {
    targetDriverIdWithPrefix = driverId.startsWith('line:') ? driverId : `line:${driverId}`;
  }
  const targetDriverIdNoPrefix = targetDriverIdWithPrefix.startsWith('line:')
    ? targetDriverIdWithPrefix.slice(5)
    : targetDriverIdWithPrefix;

  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;
  const hasFrom = Number.isFinite(fromMs);
  const hasTo = Number.isFinite(toMs);

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db
      .collection('orders')
      .where('assignedDriverId', 'in', [targetDriverIdWithPrefix, targetDriverIdNoPrefix])
      .where('orderStatus', 'in', HISTORY_STATUSES)
      .get();

    type GooglePlaceLite = { address: string; lat: number; lng: number; displayName?: string };

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
          // Booking v2 批次 2：fallback 舊單無 adult/child
          adultCount: (d.adultCount as number | undefined) ?? ((d.passengerCount as number | undefined) ?? 1),
          childCount: (d.childCount as number | undefined) ?? 0,
          estimatedFare: (d.estimatedFare as number) ?? 0,
          distanceKm: (d.distanceKm as number) ?? 0,
          orderStatus: (d.orderStatus as string) ?? 'completed',
          cancelReason: (d.cancelReason as string | undefined) ?? null,
          createdAt: d.createdAt?.toMillis?.() ?? 0,
        };
      })
      .filter((o) => {
        if (!hasFrom && !hasTo) return true;
        const t = Date.parse(o.pickupDateTime);
        if (!Number.isFinite(t)) return false;
        if (hasFrom && t < fromMs) return false;
        if (hasTo && t >= toMs) return false;
        return true;
      })
      // pickupDateTime 降序（最近的歷史在最上面）
      .sort((a, b) => {
        const ta = new Date(a.pickupDateTime).getTime();
        const tb = new Date(b.pickupDateTime).getTime();
        return tb - ta;
      });

    return successResponse(orders);
  } catch (err) {
    console.error('[orders/history] Firestore query failed:', err);
    return serverError();
  }
});
