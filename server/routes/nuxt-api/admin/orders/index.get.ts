import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { serializeOrderPreferences } from '@@/utils/order-preferences';
import { serializeBids } from '@@/utils/order-dispatch';

type GooglePlaceLite = { address: string; lat: number; lng: number; placeId?: string; displayName?: string };

export default defineEventHandler(async (event) => {
  // P14：必須登入；P18：套 canManageOrders 權限（admin/assistant 都有此權限）
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const query = getQuery(event);
  const { status, from, to } = query as { status?: string; from?: string; to?: string };

  // Wave 1 A3：from / to 為 ISO string（exclusive end）；於 server 內存 filter
  // pickupDateTime（避免動 Firestore composite index）。
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

    let q = db.collection('orders').orderBy('createdAt', 'desc').limit(200) as FirebaseFirestore.Query;
    if (status) q = q.where('orderStatus', '==', status);

    const snapshot = await q.get();

    // 完整訂單欄位（admin/orders modal 用）
    // Wave 1 A3：先 map 後依 from/to 過濾 pickupDateTime
    const baseOrdersAll = snapshot.docs.map((doc) => {
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
        luggageItems: ((d.luggageItems as Array<{ typeId: string; count: number }> | undefined) ?? []),
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
        // 訂單 doc 自帶的乘客欄位（admin 手動建立的 guest 訂單會有；乘客自助下單無）
        storedPassengerName: (d.passengerName as string | undefined) ?? '',
        contactPhone: (d.contactPhone as string | undefined) ?? null,
        // Phase 1D：偏好標籤 snapshot（null = 乘客建單時未勾選或為舊單）
        preferences: serializeOrderPreferences(d.preferences),
        // Phase 1E：派發 / 喊單欄位 echo（null/[] = 未派發 / 未喊單）
        dispatchAt: d.dispatchAt?.toDate?.()?.toISOString?.() ?? null,
        dispatchedBy: (d.dispatchedBy as string | undefined) ?? null,
        bids: serializeBids(d.bids),
        assignedAt: d.assignedAt?.toDate?.()?.toISOString?.() ?? null,
        assignedBy: (d.assignedBy as string | undefined) ?? null,
      };
    });

    const baseOrders = (hasFrom || hasTo)
      ? baseOrdersAll.filter((o) => {
        const t = Date.parse(o.pickupDateTime);
        if (!Number.isFinite(t)) return false;
        if (hasFrom && t < fromMs) return false;
        if (hasTo && t >= toMs) return false;
        return true;
      })
      : baseOrdersAll;

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

    // 乘客名：訂單 doc 自帶（手動訂單）優先，否則回退 users/{userId}.displayName
    // 乘客電話：訂單 doc 的 contactPhone（乘客下單 / 手動訂單皆會寫入）
    const orders = baseOrders.map((o) => {
      const { storedPassengerName, contactPhone, ...rest } = o;
      return {
        ...rest,
        passengerName: storedPassengerName || (userMap.get(o.userId)?.displayName ?? ''),
        passengerPhone: contactPhone,
      };
    });

    return successResponse(orders);
  } catch (err) {
    console.error('[admin/orders] Firestore query failed:', err);
    return serverError();
  }
});
