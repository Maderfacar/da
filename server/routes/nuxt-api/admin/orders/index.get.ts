import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

type GooglePlaceLite = { address: string; lat: number; lng: number; placeId?: string; displayName?: string };

export default defineEventHandler(async (event) => {
  // P14：必須登入；P18：套 canManageOrders 權限（admin/assistant 都有此權限）
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const query = getQuery(event);
  const { status } = query as { status?: string };

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    let q = db.collection('orders').orderBy('createdAt', 'desc').limit(200) as FirebaseFirestore.Query;
    if (status) q = q.where('orderStatus', '==', status);

    const snapshot = await q.get();

    // 完整訂單欄位（admin/orders modal 用）
    const baseOrders = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        orderId: d.orderId as string,
        userId: (d.userId as string) ?? '',
        lineUserId: (d.lineUserId as string) ?? '',
        orderType: d.orderType as string,
        pickupDateTime: d.pickupDateTime as string,
        pickupLocation: d.pickupLocation as GooglePlaceLite,
        dropoffLocation: d.dropoffLocation as GooglePlaceLite,
        stopovers: ((d.stopovers as GooglePlaceLite[] | undefined) ?? []),
        vehicleType: d.vehicleType as string,
        passengerCount: (d.passengerCount as number) ?? 1,
        luggageCount: (d.luggageCount as number) ?? 0,
        estimatedFare: (d.estimatedFare as number) ?? 0,
        estimatedTime: (d.estimatedTime as number) ?? 0,
        distanceKm: (d.distanceKm as number) ?? 0,
        extraServices: (d.extraServices as string[] | undefined) ?? [],
        flightNumber: (d.flightNumber as string | undefined) ?? null,
        terminal: (d.terminal as string | undefined) ?? null,
        notes: (d.notes as string | undefined) ?? null,
        orderStatus: (d.orderStatus as string) ?? 'pending',
        assignedDriverId: (d.assignedDriverId as string) ?? '',
        cancelReason: (d.cancelReason as string | undefined) ?? null,
        createdAt: d.createdAt?.toMillis?.() ?? 0,
      };
    });

    // batch read users/{userId} 取乘客顯示名（既有 user 資料無 phone，passengerPhone 暫 null）
    const userIds = Array.from(new Set(baseOrders.map((o) => o.userId).filter(Boolean)));
    const userMap = new Map<string, { displayName: string }>();
    if (userIds.length > 0) {
      try {
        const userRefs = userIds.map((uid) => db.collection('users').doc(uid));
        const userSnaps = await db.getAll(...userRefs);
        userSnaps.forEach((s) => {
          if (s.exists) {
            const data = s.data() ?? {};
            userMap.set(s.id, { displayName: (data.displayName as string) ?? '' });
          }
        });
      } catch (err) {
        console.error('[admin/orders] users batch read failed:', err);
      }
    }

    const orders = baseOrders.map((o) => ({
      ...o,
      passengerName: userMap.get(o.userId)?.displayName ?? '',
      passengerPhone: null as string | null,
    }));

    return successResponse(orders);
  } catch (err) {
    console.error('[admin/orders] Firestore query failed:', err);
    return serverError();
  }
});
