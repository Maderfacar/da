import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const { userId } = query as { userId?: string };

  if (!userId) {
    return {
      data: [],
      status: { code: 400, message: { zh_tw: '缺少使用者 ID', en: 'Missing userId', ja: 'ユーザー ID が不足しています' } },
    };
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();

  if (!firebaseServiceAccountJson) {
    return {
      data: [],
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db.collection('orders').where('userId', '==', userId).get();

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
          estimatedFare: (d.estimatedFare as number) ?? 0,
          orderStatus: (d.orderStatus as string) ?? 'pending',
          createdAt: d.createdAt?.toMillis?.() ?? 0,
        };
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
