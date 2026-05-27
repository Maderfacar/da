import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import {
  successResponse,
  badRequestError,
  notFoundError,
  forbiddenError,
  serverError,
} from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { serializeOrderPreferences as _serializeOrderPreferences } from '@@/utils/order-preferences';

// P36：訂單詳情 endpoint
// - 權限：owner（caller.lineUid === order.userId）or admin or assigned driver
// - 司機資訊：orderStatus ∈ {confirmed,en_route,arrived_pickup,in_transit,completed} 才回（pending/cancelled 不回司機資料）
// - P36 選項 A：driver.phone 回真實號碼（drivers.application.phone），前端 tel: 直接撥
// - Timestamp 統一序列化為 ISO string

// P19 hotfix：assignedDriverId 可能無 prefix 或帶 'line:' prefix；與 driver auth.uid 比對前統一 normalize
const _normalizeDriverId = (id: string | undefined | null): string => {
  if (!id) return '';
  return id.startsWith('line:') ? id : `line:${id}`;
};
const _stripLinePrefix = (id: string): string => (id.startsWith('line:') ? id.slice(5) : id);

const _serializeTimestamp = (ts: unknown): string | null => {
  if (!ts) return null;
  const t = ts as { toDate?: () => Date; toMillis?: () => number };
  if (typeof t.toDate === 'function') {
    try { return t.toDate().toISOString(); } catch { return null; }
  }
  if (typeof t.toMillis === 'function') {
    try { return new Date(t.toMillis()).toISOString(); } catch { return null; }
  }
  return null;
};

// 司機資料對乘客可見的狀態（confirmed 後 + completed 結束都仍顯示）
const DRIVER_VISIBLE_STATUSES = new Set(['confirmed', 'en_route', 'arrived_pickup', 'in_transit', 'completed']);

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文 ID が不足しています' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({
      zh_tw: '伺服器設定不完整',
      en: 'Server configuration incomplete',
      ja: 'サーバー設定が不完全です',
    });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }

    const orderData = snap.data() ?? {};
    const orderUserId = (orderData.userId as string) ?? '';
    const orderAssignedDriver = (orderData.assignedDriverId as string | undefined) ?? '';

    const isAdmin = auth.roles.includes('admin');
    const isOwner = orderUserId === auth.lineUid;
    // 兼容雙格式：auth.uid 永遠帶 'line:' prefix；orderAssignedDriver 可能無 prefix（舊資料）
    const orderAssignedNormalized = _normalizeDriverId(orderAssignedDriver);
    const isAssignedDriver = auth.roles.includes('driver') && orderAssignedNormalized === auth.uid;

    if (!isAdmin && !isOwner && !isAssignedDriver) {
      return forbiddenError({
        zh_tw: '無權檢視此訂單',
        en: 'Not authorized to view this order',
        ja: 'この注文を閲覧する権限がありません',
      });
    }

    const orderStatus = (orderData.orderStatus as string) ?? 'pending';

    // 司機資訊（限 confirmed 後）
    let driver: {
      displayName: string;
      pictureUrl: string;
      plateNumber: string;
      vehicleType: string;
      vehicleModel: string;
      phone: string | null;
    } | null = null;

    if (DRIVER_VISIBLE_STATUSES.has(orderStatus) && orderAssignedDriver) {
      const driverLineUid = _stripLinePrefix(orderAssignedDriver);
      try {
        const driverSnap = await db.collection('drivers').doc(driverLineUid).get();
        if (driverSnap.exists) {
          const dd = driverSnap.data() ?? {};
          const app = (dd.application as Record<string, unknown> | undefined) ?? {};
          driver = {
            displayName: (dd.displayName as string) ?? (app.driverName as string) ?? '',
            pictureUrl: (dd.pictureUrl as string) ?? '',
            plateNumber: (app.plateNumber as string) ?? '',
            vehicleType: (dd.vehicleType as string) ?? '',
            vehicleModel: (app.vehicleModel as string) ?? (dd.vehicleModel as string) ?? '',
            phone: (app.phone as string) ?? null,
          };
        }
      } catch (err) {
        console.error('[orders/get-one] driver fetch failed:', err);
        // 不阻斷主流程；driver 留 null
      }
    }

    // statusHistory 序列化
    const rawHistory = (orderData.statusHistory as Record<string, unknown> | undefined) ?? {};
    const statusHistory = {
      confirmedAt: _serializeTimestamp(rawHistory.confirmedAt),
      enRouteAt: _serializeTimestamp(rawHistory.enRouteAt),
      arrivedPickupAt: _serializeTimestamp(rawHistory.arrivedPickupAt),
      inTransitAt: _serializeTimestamp(rawHistory.inTransitAt),
      completedAt: _serializeTimestamp(rawHistory.completedAt),
      cancelledAt: _serializeTimestamp(rawHistory.cancelledAt),
    };

    return successResponse({
      orderId: (orderData.orderId as string) ?? orderId,
      userId: orderUserId,
      orderType: (orderData.orderType as string) ?? '',
      orderStatus,
      pickupDateTime: (orderData.pickupDateTime as string) ?? '',
      pickupLocation: orderData.pickupLocation ?? null,
      dropoffLocation: orderData.dropoffLocation ?? null,
      stopovers: (orderData.stopovers as unknown[] | undefined) ?? [],
      vehicleType: (orderData.vehicleType as string) ?? '',
      passengerCount: (orderData.passengerCount as number) ?? 1,
      // Booking v2 批次 2：舊單無 adultCount → fallback adult=passengerCount, child=0
      adultCount: (orderData.adultCount as number | undefined) ?? ((orderData.passengerCount as number | undefined) ?? 1),
      childCount: (orderData.childCount as number | undefined) ?? 0,
      luggageItems: (orderData.luggageItems as unknown[] | undefined) ?? [],
      extraServices: (orderData.extraServices as string[] | undefined) ?? [],
      estimatedFare: (orderData.estimatedFare as number) ?? 0,
      estimatedTime: (orderData.estimatedTime as number) ?? 0,
      distanceKm: (orderData.distanceKm as number) ?? 0,
      contactPhone: (orderData.contactPhone as string | null) ?? null,
      // Booking v2 批次 1：舊單為 null fallback；對齊 OrderDetail type
      contactName: (orderData.contactName as string | null) ?? null,
      passengerName: (orderData.passengerName as string | null) ?? null,
      flightNumber: (orderData.flightNumber as string | null) ?? null,
      terminal: (orderData.terminal as string | null) ?? null,
      notes: (orderData.notes as string | null) ?? null,
      cancelReason: (orderData.cancelReason as string | null) ?? null,
      createdAt: _serializeTimestamp(orderData.createdAt),
      statusHistory,
      driver,
      // Phase 1D：偏好標籤 snapshot（null = 乘客建單時未勾選）
      preferences: _serializeOrderPreferences(orderData.preferences),
    });
  } catch (err) {
    console.error('[orders/get-one] Firestore read failed:', err);
    return serverError();
  }
});
