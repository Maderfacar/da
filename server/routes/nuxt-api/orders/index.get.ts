import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

export default defineEventHandler(async (event) => {
  // P14：必須登入。passenger 強制只能讀自己；admin / driver 可帶 query.userId 查指定人
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const query = getQuery(event);
  const { userId: queryUserId, from, to } = query as { userId?: string; from?: string; to?: string };

  const isPrivileged = auth.roles.includes('admin') || auth.roles.includes('driver');
  // 純 passenger 帶的 userId 一律忽略，強制使用自己的 lineUid
  const targetUserId = isPrivileged && queryUserId ? queryUserId : auth.lineUid;

  // Wave 1 P3：from / to ISO 範圍過濾 pickupDateTime（server 內存過濾，避免動 Firestore index）
  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;
  const hasFrom = Number.isFinite(fromMs);
  const hasTo = Number.isFinite(toMs);

  const { firebaseServiceAccountJson } = useRuntimeConfig();

  if (!firebaseServiceAccountJson) {
    // P15：Firebase 未設不再 silent 回 200，避免 UI 顯示假成功
    return {
      data: [],
      status: { code: 500, message: { zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' } },
    };
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db.collection('orders').where('userId', '==', targetUserId).get();

    const orders = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          orderId: d.orderId as string,
          orderType: d.orderType as string,
          pickupDateTime: d.pickupDateTime as string,
          pickupLocation: d.pickupLocation as { address: string; lat: number; lng: number; placeId?: string; displayName?: string },
          dropoffLocation: d.dropoffLocation as { address: string; lat: number; lng: number; placeId?: string; displayName?: string },
          vehicleType: d.vehicleType as string,
          passengerCount: (d.passengerCount as number) ?? 1,
          // Booking v2 批次 2：fallback 舊單無 adult/child
          adultCount: (d.adultCount as number | undefined) ?? ((d.passengerCount as number | undefined) ?? 1),
          childCount: (d.childCount as number | undefined) ?? 0,
          estimatedFare: (d.estimatedFare as number) ?? 0,
          orderStatus: (d.orderStatus as string) ?? 'pending',
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
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      data: orders,
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch (err) {
    console.error('[orders/get] Firestore query failed:', err);
    return {
      data: [],
      status: { code: 500, message: { zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' } },
    };
  }
});
