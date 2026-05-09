import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { successResponse, badRequestError, notFoundError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

interface GooglePlaceLite {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
  displayName?: string;
}

interface PatchOrderBody {
  // 通用欄位（admin / driver / passenger 依角色限制）
  orderStatus?: string;
  assignedDriverId?: string;
  cancelReason?: string;
  // admin-only 編輯欄位
  pickupDateTime?: string;
  pickupLocation?: GooglePlaceLite;
  dropoffLocation?: GooglePlaceLite;
  stopovers?: GooglePlaceLite[];
  vehicleType?: string;
  passengerCount?: number;
  luggageCount?: number;
  estimatedFare?: number;
  extraServices?: string[];
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
}

const VALID_VEHICLE_TYPES = ['sedan', 'suv', 'van', 'premium'] as const;
const VALID_EXTRA_SERVICES = ['baby-seat', 'wheelchair', 'pickup-sign', 'flight-tracking'] as const;
const ADMIN_ONLY_FIELDS = ['pickupDateTime', 'pickupLocation', 'dropoffLocation', 'stopovers', 'vehicleType', 'passengerCount', 'luggageCount', 'estimatedFare', 'extraServices', 'flightNumber', 'terminal', 'notes'] as const;

const _isValidGooglePlace = (v: unknown): v is GooglePlaceLite => {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.address === 'string' && typeof p.lat === 'number' && typeof p.lng === 'number';
};

// P19：訂單狀態擴充為 7 個值
const VALID_STATUSES = ['pending', 'confirmed', 'en_route', 'arrived_pickup', 'in_transit', 'completed', 'cancelled'] as const;
type OrderStatus = typeof VALID_STATUSES[number];

// P19 hotfix：assignedDriverId 強制 line: prefix（與 driver 搶單格式一致；既有 admin/users API
// 回傳 uid 不帶 prefix，導致 admin 指派 orders.assignedDriverId 與 driver 搶單格式不一致，
// 司機 GetAssignedOrders 永遠查不到 admin 指派的訂單）
const _normalizeDriverId = (id: string | undefined | null): string => {
  if (!id) return '';
  return id.startsWith('line:') ? id : `line:${id}`;
};
const _stripLinePrefix = (id: string): string => id.startsWith('line:') ? id.slice(5) : id;

// P19 driver 嚴格狀態機：driver 推進 status 必須照 confirmed → en_route → arrived_pickup → in_transit → completed
const DRIVER_NEXT_STATUS: Record<string, OrderStatus> = {
  confirmed: 'en_route',
  en_route: 'arrived_pickup',
  arrived_pickup: 'in_transit',
  in_transit: 'completed',
};

// P19：哪些 status 視為司機「執行中」（決定 drivers.status='busy'）
const EXECUTING_STATUSES: OrderStatus[] = ['en_route', 'arrived_pickup', 'in_transit'];

// statusHistory 欄位對應
const STATUS_HISTORY_FIELD: Record<OrderStatus, string | null> = {
  pending: null,
  confirmed: 'statusHistory.confirmedAt',
  en_route: 'statusHistory.enRouteAt',
  arrived_pickup: 'statusHistory.arrivedPickupAt',
  in_transit: 'statusHistory.inTransitAt',
  completed: 'statusHistory.completedAt',
  cancelled: 'statusHistory.cancelledAt',
};

export default defineEventHandler(async (event) => {
  // P14：必須登入；P19：訂單 owner 只能取消，admin 任意更新，driver 自己的訂單按嚴格狀態機推進
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文 ID が不足しています' });
  }

  const body = await readBody<PatchOrderBody>(event);

  // P19：status 必須是合法值
  if (body.orderStatus !== undefined && !VALID_STATUSES.includes(body.orderStatus as OrderStatus)) {
    return badRequestError({
      zh_tw: '無效的訂單狀態',
      en: 'Invalid order status',
      ja: '無効な注文ステータス',
    });
  }

  // 至少需有一個可更新欄位
  const hasAnyField = body.orderStatus !== undefined
    || body.assignedDriverId !== undefined
    || body.cancelReason !== undefined
    || ADMIN_ONLY_FIELDS.some((k) => body[k] !== undefined);
  if (!hasAnyField) {
    return badRequestError({ zh_tw: '沒有可更新的欄位', en: 'No fields to update', ja: '更新するフィールドがありません' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError();
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }

    // 權限分流
    const orderData = snap.data() ?? {};
    const orderUserId = (orderData.userId as string) ?? '';
    const orderAssignedDriver = (orderData.assignedDriverId as string | undefined) ?? '';
    const prevStatus = (orderData.orderStatus as OrderStatus | undefined) ?? 'pending';

    const isAdmin = auth.roles.includes('admin');
    const isDriver = auth.roles.includes('driver');
    const isOwner = orderUserId === auth.lineUid;
    // P19 hotfix：兼容雙格式（既有資料可能無 prefix；新資料統一帶 prefix）
    // auth.uid 永遠是 'line:Uxxx'；比對時把 orderAssignedDriver 也 normalize
    const orderAssignedNormalized = _normalizeDriverId(orderAssignedDriver);
    const isAssignedDriver = isDriver && orderAssignedNormalized === auth.uid;

    if (!isAdmin && !isDriver && !isOwner) {
      return forbiddenError({ zh_tw: '無權變更此訂單', en: 'Not authorized to modify this order', ja: 'この注文を変更する権限がありません' });
    }

    // owner-only 限制（純 passenger）
    if (isOwner && !isAdmin && !isDriver) {
      if (body.assignedDriverId !== undefined) {
        return forbiddenError({ zh_tw: '無權指派司機', en: 'Cannot assign driver', ja: 'ドライバーを指定する権限がありません' });
      }
      if (body.orderStatus && body.orderStatus !== 'cancelled') {
        return forbiddenError({ zh_tw: '乘客僅能取消訂單', en: 'Passenger can only cancel order', ja: 'お客様はキャンセルのみ可能です' });
      }
      // 乘客不可改 admin-only 欄位
      const adminFieldUsed = ADMIN_ONLY_FIELDS.some((k) => body[k] !== undefined);
      if (adminFieldUsed) {
        return forbiddenError({ zh_tw: '乘客無權修改此欄位', en: 'Passenger cannot modify this field', ja: 'お客様はこの項目を変更する権限がありません' });
      }
    }

    // P22：driver 不可改 admin-only 欄位（只能改 status / 取消 + cancelReason）
    if (isDriver && !isAdmin) {
      const adminFieldUsed = ADMIN_ONLY_FIELDS.some((k) => body[k] !== undefined);
      if (adminFieldUsed) {
        return forbiddenError({ zh_tw: '司機無權修改此欄位', en: 'Driver cannot modify this field', ja: 'ドライバーはこの項目を変更する権限がありません' });
      }
    }

    // P22：admin-only 欄位驗證（admin 才走到這裡，前面已擋）
    if (isAdmin) {
      if (body.vehicleType !== undefined && !VALID_VEHICLE_TYPES.includes(body.vehicleType as typeof VALID_VEHICLE_TYPES[number])) {
        return badRequestError({ zh_tw: '車型無效', en: 'Invalid vehicle type', ja: '無効な車種' });
      }
      if (body.passengerCount !== undefined && (!Number.isInteger(body.passengerCount) || body.passengerCount < 1 || body.passengerCount > 20)) {
        return badRequestError({ zh_tw: '人數須為 1-20', en: 'passengerCount must be 1-20', ja: '人数は 1-20 の整数' });
      }
      if (body.luggageCount !== undefined && (!Number.isInteger(body.luggageCount) || body.luggageCount < 0 || body.luggageCount > 20)) {
        return badRequestError({ zh_tw: '行李數須為 0-20', en: 'luggageCount must be 0-20', ja: '荷物は 0-20 の整数' });
      }
      if (body.estimatedFare !== undefined && (typeof body.estimatedFare !== 'number' || body.estimatedFare < 0 || !Number.isFinite(body.estimatedFare))) {
        return badRequestError({ zh_tw: '費用須為非負數', en: 'estimatedFare must be non-negative', ja: '料金は非負数' });
      }
      if (body.pickupDateTime !== undefined && (typeof body.pickupDateTime !== 'string' || Number.isNaN(Date.parse(body.pickupDateTime)))) {
        return badRequestError({ zh_tw: '用車時間格式錯誤', en: 'Invalid pickupDateTime', ja: '日時形式が無効' });
      }
      if (body.pickupLocation !== undefined && !_isValidGooglePlace(body.pickupLocation)) {
        return badRequestError({ zh_tw: '上車點格式錯誤', en: 'Invalid pickupLocation', ja: '乗車地形式が無効' });
      }
      if (body.dropoffLocation !== undefined && !_isValidGooglePlace(body.dropoffLocation)) {
        return badRequestError({ zh_tw: '下車點格式錯誤', en: 'Invalid dropoffLocation', ja: '降車地形式が無効' });
      }
      if (body.stopovers !== undefined) {
        if (!Array.isArray(body.stopovers) || !body.stopovers.every(_isValidGooglePlace)) {
          return badRequestError({ zh_tw: '停靠站格式錯誤', en: 'Invalid stopovers', ja: '経由地形式が無効' });
        }
      }
      if (body.extraServices !== undefined) {
        if (!Array.isArray(body.extraServices) || !body.extraServices.every((s) => VALID_EXTRA_SERVICES.includes(s as typeof VALID_EXTRA_SERVICES[number]))) {
          return badRequestError({ zh_tw: '額外服務格式錯誤', en: 'Invalid extraServices', ja: 'オプション形式が無効' });
        }
      }
    }

    // P19 driver 限制（非 admin 的 driver）：
    //   - 只能改自己被指派的訂單
    //   - status 必須照狀態機推進（不可跳階段）
    //   - 不可改 assignedDriverId（避免 driver 互相搶單 / 搶他人訂單）
    if (isDriver && !isAdmin) {
      if (!isAssignedDriver && body.orderStatus !== 'confirmed') {
        // 例外：driver/pending 搶單時走 confirmed + assignedDriverId（driver 把自己指派為司機）
        if (body.assignedDriverId !== auth.uid) {
          return forbiddenError({
            zh_tw: '無權變更此訂單',
            en: 'Not authorized to modify this order',
            ja: 'この注文を変更する権限がありません',
          });
        }
      }
      if (body.assignedDriverId !== undefined && body.assignedDriverId !== auth.uid) {
        return forbiddenError({
          zh_tw: '司機僅能指派自己',
          en: 'Driver can only assign self',
          ja: 'ドライバーは自分のみ指定可能です',
        });
      }
      if (body.orderStatus && body.orderStatus !== 'cancelled' && body.orderStatus !== 'confirmed') {
        // 嚴格狀態機驗證：driver 推進 status 必須符合 confirmed → en_route → arrived_pickup → in_transit → completed
        const expected = DRIVER_NEXT_STATUS[prevStatus];
        if (expected !== body.orderStatus) {
          return badRequestError({
            zh_tw: `狀態轉換錯誤：${prevStatus} 不可改為 ${body.orderStatus}`,
            en: `Invalid status transition: ${prevStatus} cannot become ${body.orderStatus}`,
            ja: `状態遷移エラー: ${prevStatus} は ${body.orderStatus} に変更できません`,
          });
        }
      }
    }

    // 組裝 update payload
    const updates: Record<string, unknown> = {};
    if (body.orderStatus !== undefined) updates.orderStatus = body.orderStatus;
    // P19 hotfix：寫入 assignedDriverId 強制統一 'line:Uxxx' 格式
    if (body.assignedDriverId !== undefined) {
      updates.assignedDriverId = _normalizeDriverId(body.assignedDriverId);
    }
    // 取消原因（任何角色取消時都可帶；server 不限定原因內容）
    if (body.cancelReason !== undefined) {
      updates.cancelReason = body.cancelReason;
    }
    // admin-only 欄位寫入
    if (isAdmin) {
      if (body.pickupDateTime !== undefined) updates.pickupDateTime = body.pickupDateTime;
      if (body.pickupLocation !== undefined) updates.pickupLocation = body.pickupLocation;
      if (body.dropoffLocation !== undefined) updates.dropoffLocation = body.dropoffLocation;
      if (body.stopovers !== undefined) updates.stopovers = body.stopovers;
      if (body.vehicleType !== undefined) updates.vehicleType = body.vehicleType;
      if (body.passengerCount !== undefined) updates.passengerCount = body.passengerCount;
      if (body.luggageCount !== undefined) updates.luggageCount = body.luggageCount;
      if (body.estimatedFare !== undefined) updates.estimatedFare = body.estimatedFare;
      if (body.extraServices !== undefined) updates.extraServices = body.extraServices;
      if (body.flightNumber !== undefined) updates.flightNumber = body.flightNumber;
      if (body.terminal !== undefined) updates.terminal = body.terminal;
      if (body.notes !== undefined) updates.notes = body.notes;
    }

    // P19：status 變更時寫入 statusHistory.{state}At
    if (body.orderStatus && body.orderStatus !== prevStatus) {
      const historyField = STATUS_HISTORY_FIELD[body.orderStatus as OrderStatus];
      if (historyField) {
        updates[historyField] = FieldValue.serverTimestamp();
      }
    }

    await ref.update(updates);

    // P19：訂單 status 切 en_route 時，driver doc 自動切 busy（不是 confirmed）
    // - drivers doc key 是 lineUid（去 prefix）；assignedDriverId 寫入時已 normalize 帶 prefix
    if (body.orderStatus === 'en_route' && prevStatus !== 'en_route') {
      const rawDriverId = orderAssignedDriver || (body.assignedDriverId as string | undefined);
      if (rawDriverId) {
        const driverLineUid = _stripLinePrefix(rawDriverId);
        try {
          await db.collection('drivers').doc(driverLineUid).set({
            status: 'busy',
            lastActiveAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (err) {
          console.error('[orders/patch] driver busy switch failed:', err);
        }
      }
    }

    // P18：當訂單狀態剛切換為 'completed'（前一狀態非 completed），對司機 drivers doc 累加統計
    // P19：同時 query 該 driver 是否仍有「執行中」訂單；無則 status 切回 'online'
    const wasCompleted = prevStatus === 'completed';
    if (body.orderStatus === 'completed' && !wasCompleted) {
      const rawDriverId = orderAssignedDriver;
      if (rawDriverId) {
        const driverLineUid = _stripLinePrefix(rawDriverId);
        const driverIdWithPrefix = _normalizeDriverId(rawDriverId);
        const fare = (orderData.estimatedFare as number) ?? 0;
        const distance = (orderData.distanceKm as number) ?? 0;

        // 累加統計
        try {
          await db.collection('drivers').doc(driverLineUid).set({
            totalTrips: FieldValue.increment(1),
            totalEarnings: FieldValue.increment(fare),
            totalDistanceKm: FieldValue.increment(distance),
            todayTrips: FieldValue.increment(1),
            todayEarnings: FieldValue.increment(fare),
            lastTripAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (err) {
          console.error('[orders/patch] driver stats increment failed:', err);
        }

        // P19：query 該 driver 是否仍有其他「執行中」訂單（en_route / arrived_pickup / in_transit）
        // 兼容雙格式（既有資料可能無 prefix；新資料統一帶 prefix）
        try {
          const driverIdNoPrefix = driverLineUid;
          const remaining = await db.collection('orders')
            .where('assignedDriverId', 'in', [driverIdWithPrefix, driverIdNoPrefix])
            .where('orderStatus', 'in', EXECUTING_STATUSES)
            .limit(1)
            .get();
          if (remaining.empty) {
            await db.collection('drivers').doc(driverLineUid).set({
              status: 'online',
              lastActiveAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        } catch (err) {
          console.error('[orders/patch] driver online switch query failed:', err);
        }
      }
    }

    return successResponse({ orderId, ...body });
  } catch (err) {
    console.error('[orders/patch] Firestore update failed:', err);
    return serverError();
  }
});
