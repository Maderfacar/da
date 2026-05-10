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

  // assignedDriverId 在 orders 應為 'line:Uxxx' 格式（auth.uid 同格式）
  // P19 hotfix：admin 指派時帶的是 user.uid（doc.id，無 prefix），現已強制 normalize 寫入帶 prefix
  // 但既有訂單可能仍是無 prefix 格式 → query 用 'in' 兼容雙格式（過渡期）
  const query = getQuery(event);
  let targetDriverIdWithPrefix = auth.uid; // driver 預設查自己
  if (isAdmin && typeof query.driverId === 'string' && query.driverId.length > 0) {
    targetDriverIdWithPrefix = query.driverId.startsWith('line:') ? query.driverId : `line:${query.driverId}`;
  }
  const targetDriverIdNoPrefix = targetDriverIdWithPrefix.startsWith('line:')
    ? targetDriverIdWithPrefix.slice(5)
    : targetDriverIdWithPrefix;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db
      .collection('orders')
      .where('assignedDriverId', 'in', [targetDriverIdWithPrefix, targetDriverIdNoPrefix])
      .where('orderStatus', 'in', ACTIVE_STATUSES)
      .get();

    // P19：完整訂單詳情（driver/trip modal 用）+ batch read users 取乘客 displayName
    type GooglePlaceLite = { address: string; lat: number; lng: number; displayName?: string };
    type LuggageItemDoc = { typeId: string; count: number };

    const baseOrders = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        orderId: d.orderId as string,
        userId: (d.userId as string) ?? '',
        orderType: d.orderType as string,
        pickupDateTime: d.pickupDateTime as string,
        pickupLocation: d.pickupLocation as GooglePlaceLite,
        dropoffLocation: d.dropoffLocation as GooglePlaceLite,
        stopovers: ((d.stopovers as GooglePlaceLite[] | undefined) ?? []),
        vehicleType: d.vehicleType as string,
        passengerCount: (d.passengerCount as number) ?? 1,
        // P23：行李改 luggageItems 陣列（typeId + count）
        luggageItems: (d.luggageItems as LuggageItemDoc[] | undefined) ?? [],
        estimatedFare: (d.estimatedFare as number) ?? 0,
        estimatedTime: (d.estimatedTime as number) ?? 0,
        distanceKm: (d.distanceKm as number) ?? 0,
        extraServices: (d.extraServices as string[] | undefined) ?? [],
        flightNumber: (d.flightNumber as string | undefined) ?? null,
        terminal: (d.terminal as string | undefined) ?? null,
        notes: (d.notes as string | undefined) ?? null,
        // P20：contactPhone（per-order 聯絡電話，priority 高於 user.phone fallback）
        contactPhone: (d.contactPhone as string | undefined) ?? null,
        orderStatus: d.orderStatus as string,
        createdAt: d.createdAt?.toMillis?.() ?? 0,
      };
    });

    // batch read users/{userId} 取 passenger displayName
    // 既有 user 資料無 phone 欄位（passenger 訂車時只填姓名 via LINE displayName）；
    // passengerPhone 暫回 null，UI 顯示「請透過 LINE 聯絡」
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
        console.error('[orders/assigned] users batch read failed:', err);
      }
    }

    const orders = baseOrders
      .map((o) => ({
        ...o,
        passengerName: userMap.get(o.userId)?.displayName ?? '',
        // P20：優先回 per-order contactPhone（booking 表單收的），未填則 null
        passengerPhone: o.contactPhone,
      }))
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
