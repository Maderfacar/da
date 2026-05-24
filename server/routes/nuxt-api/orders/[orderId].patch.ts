import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { successResponse, badRequestError, notFoundError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog, type AuditAction } from '@@/utils/audit-log';
import { composeStatusTransitionPatch, maybeResetTodayPatch, type DriverStatsDoc } from '@@/utils/driver-stats';
import { sendLinePush } from '@@/utils/line-push';
import { getUserLang } from '@@/utils/user-lang';
import {
  buildTemplate,
  resolveTemplate,
  type TemplateContentText,
} from '@@/utils/template-registry';
import { notifyAdmins } from '@@/utils/notify-admins';
import { activeBidderLineUids } from '@@/utils/order-dispatch';
import { pushOrderCancelledToBidders } from '@@/utils/line-dispatch-push';
import {
  processReferralQualification,
  getReferralCampaign,
  buildReferralShareFlex,
} from '@@/utils/referral';
import {
  validateAndSnapshotPreferences,
  snapshotForFirestore,
} from '@@/utils/order-preferences';
import { recheckDiscountCode } from '@@/utils/discount-recheck';
import { recalcFinalTotal } from '~shared/fare/recalc';

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
  orderType?: string;
  pickupDateTime?: string;
  pickupLocation?: GooglePlaceLite;
  dropoffLocation?: GooglePlaceLite;
  stopovers?: GooglePlaceLite[];
  vehicleType?: string;
  passengerCount?: number;
  /** Booking v2 批次 2：admin 可改大人 / 兒童；server 會自動 passengerCount = adult + child */
  adultCount?: number;
  childCount?: number;
  luggageItems?: Array<{ typeId: string; count: number }>;
  estimatedFare?: number;
  extraServices?: string[];
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
  passengerName?: string;
  // Booking v2 批次 1：聯絡人姓名（admin-only patch）
  contactName?: string;
  contactPhone?: string;
  // Wave 1 D2：driver 推進 4 階段時附上當下 GPS（lat, lng）
  driverLocation?: { lat: number; lng: number };
  // Wave 1C：admin 後修 tag → 重 snapshot + 重算 fare + 重檢 discount（僅 admin + 未指派狀態）
  preferences?: { tagIds?: string[] } | null;
}

// P23：vehicleType / extraServices 不再硬編碼 union — fleet config 動態化後，
// admin 可任意新增；body 驗證放寬至「字串/字串陣列」，存在性由 GET fleet 端確認
const ADMIN_ONLY_FIELDS = ['orderType', 'pickupDateTime', 'pickupLocation', 'dropoffLocation', 'stopovers', 'vehicleType', 'passengerCount', 'adultCount', 'childCount', 'luggageItems', 'estimatedFare', 'extraServices', 'flightNumber', 'terminal', 'notes', 'passengerName', 'contactName', 'contactPhone'] as const;

const VALID_ORDER_TYPES = new Set(['airport-pickup', 'airport-dropoff', 'charter', 'transfer']);
const PHONE_REGEX = /^09\d{8}$/;

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

// Wave 1 D2：driver 推進的 4 個狀態（其它狀態不寫 statusHistoryLocations）
// schema：orders/{orderId}.statusHistoryLocations.{state} = { lat, lng, address, recordedAt: Timestamp }
const DRIVER_LOCATION_STATUSES = new Set<OrderStatus>(['en_route', 'arrived_pickup', 'in_transit', 'completed']);
const _isValidDriverLocation = (v: unknown): v is { lat: number; lng: number } => {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.lat === 'number' && Number.isFinite(p.lat)
    && typeof p.lng === 'number' && Number.isFinite(p.lng);
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

  // Wave 1C：body.preferences.tagIds 為 admin-only 操作（後修 tag + 重算 fare + 重檢 discount）。
  // 其他角色帶此欄位視同無效（與 Phase 1D 初版相容，避免乘客 / driver 誤觸）。
  const rawPrefs = (body as { preferences?: unknown }).preferences;
  const hasTagPatch =
    rawPrefs !== undefined
    && rawPrefs !== null
    && typeof rawPrefs === 'object'
    && Array.isArray((rawPrefs as { tagIds?: unknown }).tagIds);
  if (!hasTagPatch) {
    // 非 admin tag 後修場景一律忽略，避免 snapshot 被亂改
    delete (body as { preferences?: unknown }).preferences;
  }

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
    || hasTagPatch
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
      // 乘客不可改 admin-only 欄位（含 preferences tag 後修）
      const adminFieldUsed = ADMIN_ONLY_FIELDS.some((k) => body[k] !== undefined) || hasTagPatch;
      if (adminFieldUsed) {
        return forbiddenError({ zh_tw: '乘客無權修改此欄位', en: 'Passenger cannot modify this field', ja: 'お客様はこの項目を変更する権限がありません' });
      }
    }

    // P22：driver 不可改 admin-only 欄位（只能改 status / 取消 + cancelReason）
    if (isDriver && !isAdmin) {
      const adminFieldUsed = ADMIN_ONLY_FIELDS.some((k) => body[k] !== undefined) || hasTagPatch;
      if (adminFieldUsed) {
        return forbiddenError({ zh_tw: '司機無權修改此欄位', en: 'Driver cannot modify this field', ja: 'ドライバーはこの項目を変更する権限がありません' });
      }
    }

    // P22：admin-only 欄位驗證（admin 才走到這裡，前面已擋）
    // P23：vehicleType / extraServices 改為字串驗證（不再 hardcoded enum）
    if (isAdmin) {
      if (body.orderType !== undefined && !VALID_ORDER_TYPES.has(body.orderType)) {
        return badRequestError({ zh_tw: '無效的行程類型', en: 'Invalid orderType', ja: '無効な行程タイプ' });
      }
      if (body.passengerName !== undefined) {
        const name = typeof body.passengerName === 'string' ? body.passengerName.trim() : '';
        if (!name || name.length > 40) {
          return badRequestError({ zh_tw: '乘客姓名必填且 40 字內', en: 'passengerName required (≤40 chars)', ja: '乗客名は必須（40文字以内）' });
        }
      }
      if (body.contactName !== undefined) {
        const name = typeof body.contactName === 'string' ? body.contactName.trim() : '';
        if (name.length > 40) {
          return badRequestError({ zh_tw: '聯絡人姓名 40 字內', en: 'contactName ≤40 chars', ja: '連絡人氏名は40文字以内' });
        }
      }
      if (body.contactPhone !== undefined && !PHONE_REGEX.test(body.contactPhone)) {
        return badRequestError({ zh_tw: '聯絡電話格式錯誤（09 開頭 10 碼）', en: 'Invalid contact phone', ja: '連絡先電話番号の形式が不正です' });
      }
      if (body.vehicleType !== undefined && (typeof body.vehicleType !== 'string' || body.vehicleType.length === 0)) {
        return badRequestError({ zh_tw: '車型必須是字串', en: 'vehicleType must be string', ja: '車種は文字列' });
      }
      if (body.passengerCount !== undefined && (!Number.isInteger(body.passengerCount) || body.passengerCount < 1 || body.passengerCount > 20)) {
        return badRequestError({ zh_tw: '人數須為 1-20', en: 'passengerCount must be 1-20', ja: '人数は 1-20 の整数' });
      }
      // Booking v2 批次 2：adult / child 範圍校驗（admin 改）
      if (body.adultCount !== undefined && (!Number.isInteger(body.adultCount) || body.adultCount < 1 || body.adultCount > 20)) {
        return badRequestError({ zh_tw: '大人數須為 1-20', en: 'adultCount must be 1-20', ja: '大人人数は 1-20' });
      }
      if (body.childCount !== undefined && (!Number.isInteger(body.childCount) || body.childCount < 0 || body.childCount > 20)) {
        return badRequestError({ zh_tw: '兒童數須為 0-20', en: 'childCount must be 0-20', ja: '子供人数は 0-20' });
      }
      if (body.luggageItems !== undefined) {
        if (!Array.isArray(body.luggageItems)
          || !body.luggageItems.every((i) =>
            i && typeof i === 'object'
            && typeof (i as { typeId?: unknown }).typeId === 'string'
            && Number.isInteger((i as { count?: unknown }).count)
            && (i as { count: number }).count >= 0)) {
          return badRequestError({ zh_tw: '行李格式錯誤', en: 'Invalid luggageItems', ja: '荷物形式が無効' });
        }
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
        if (!Array.isArray(body.extraServices) || !body.extraServices.every((s) => typeof s === 'string')) {
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
      if (body.orderType !== undefined) updates.orderType = body.orderType;
      if (body.passengerName !== undefined) updates.passengerName = body.passengerName.trim();
      if (body.contactName !== undefined) {
        const name = body.contactName.trim();
        updates.contactName = name || null;
      }
      if (body.contactPhone !== undefined) updates.contactPhone = body.contactPhone;
      if (body.pickupDateTime !== undefined) updates.pickupDateTime = body.pickupDateTime;
      if (body.pickupLocation !== undefined) updates.pickupLocation = body.pickupLocation;
      if (body.dropoffLocation !== undefined) updates.dropoffLocation = body.dropoffLocation;
      if (body.stopovers !== undefined) updates.stopovers = body.stopovers;
      if (body.vehicleType !== undefined) updates.vehicleType = body.vehicleType;
      // Booking v2 批次 2：admin 帶 adult / child 時、自動同步 passengerCount = adult + child
      const adultPatched = body.adultCount !== undefined ? body.adultCount : undefined;
      const childPatched = body.childCount !== undefined ? body.childCount : undefined;
      if (adultPatched !== undefined) updates.adultCount = adultPatched;
      if (childPatched !== undefined) updates.childCount = childPatched;
      if (adultPatched !== undefined || childPatched !== undefined) {
        // 取 patched 值（沒帶就用 doc 原值，再不行用 passengerCount 推算）
        const prevAdult = (orderData.adultCount as number | undefined)
          ?? (orderData.passengerCount as number | undefined)
          ?? 1;
        const prevChild = (orderData.childCount as number | undefined) ?? 0;
        const nextAdult = adultPatched ?? prevAdult;
        const nextChild = childPatched ?? prevChild;
        updates.passengerCount = nextAdult + nextChild;
      } else if (body.passengerCount !== undefined) {
        updates.passengerCount = body.passengerCount;
      }
      if (body.luggageItems !== undefined) updates.luggageItems = body.luggageItems;
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

    // Wave 1 D2：driver 推進 4 個狀態 + 帶 driverLocation 時，寫入 statusHistoryLocations.{state}
    // 條件：(1) 此次 status 變更 (2) status ∈ DRIVER_LOCATION_STATUSES (3) driverLocation 合法
    // address 暫留空字串（schema 預留欄位，後續可由 reverse geocoding 補）
    if (
      body.orderStatus
      && body.orderStatus !== prevStatus
      && DRIVER_LOCATION_STATUSES.has(body.orderStatus as OrderStatus)
      && _isValidDriverLocation(body.driverLocation)
    ) {
      const loc = body.driverLocation;
      updates[`statusHistoryLocations.${body.orderStatus}`] = {
        lat: loc.lat,
        lng: loc.lng,
        address: '',
        recordedAt: FieldValue.serverTimestamp(),
      };
    }

    // ── Wave 1C：admin 後修 tag → 重 snapshot + 重算 fare + 重檢 discount ──
    // 守則：admin only + 訂單未指派司機 + 仍 pending（dispatched 也是 pending）
    // 留底 prevTagRecalc 供 audit log；非 tag-patch 路徑為 null
    interface TagRecalcAudit {
      tagIdsBefore: string[];
      tagIdsAfter: string[];
      fareBeforeDiscount: number;
      tagSurchargeBefore: number;
      tagSurchargeAfter: number;
      discountAmountBefore: number;
      discountAmountAfter: number;
      finalTotalBefore: number;
      finalTotalAfter: number;
      warning: 'discount_expired_fallback' | null;
    }
    let tagRecalcAudit: TagRecalcAudit | null = null;
    let tagRecalcWarning: 'discount_expired_fallback' | null = null;

    if (hasTagPatch) {
      if (!isAdmin) {
        return forbiddenError({
          zh_tw: '僅 admin 可後修偏好標籤',
          en: 'Only admin can edit order tags',
          ja: '管理者のみ注文タグを編集できます',
        });
      }
      // 狀態守則：未指派司機才可改（assigned 後動價會混淆司機 / 乘客）
      if (orderAssignedDriver) {
        return forbiddenError({
          zh_tw: '訂單已指派司機，無法修改偏好標籤',
          en: 'Order already assigned to driver, cannot edit tags',
          ja: 'ドライバー指定済みの注文はタグを編集できません',
        });
      }
      // 仍 pending 才可改（cancelled / completed 不允許）
      if (prevStatus !== 'pending') {
        return forbiddenError({
          zh_tw: '僅待確認狀態的訂單可修改偏好標籤',
          en: 'Only pending orders can edit tags',
          ja: '保留中の注文のみタグを編集できます',
        });
      }

      const newTagIds = Array.from(
        new Set(((rawPrefs as { tagIds: unknown }).tagIds as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        )),
      );

      // 重 snapshot（validate + index + buildPreferencesSnapshot）
      const { errors, snapshot } = await validateAndSnapshotPreferences(db, { tagIds: newTagIds });
      if (errors.length > 0) {
        const summary = errors.map((e) => `${e.field}:${e.code}`).join(', ');
        return badRequestError({
          zh_tw: `偏好標籤驗證失敗：${summary}`,
          en: `Preferences validation failed: ${summary}`,
          ja: `好み設定のバリデーション失敗：${summary}`,
        });
      }
      const newSnapshot = snapshot ?? {
        tagIds: newTagIds,
        tagSnapshot: [],
        tagSurcharge: 0,
        snapshotAt: new Date().toISOString(),
      };

      // 既有 fare 欄位（建單時寫入；舊單可能無 fareBeforeDiscount → fallback estimatedFare）
      const fareBeforeDiscount = typeof orderData.fareBeforeDiscount === 'number'
        ? orderData.fareBeforeDiscount
        : ((orderData.estimatedFare as number | undefined) ?? 0);
      const tagSurchargeBefore = typeof orderData.preferences === 'object'
        && orderData.preferences !== null
        && typeof (orderData.preferences as { tagSurcharge?: number }).tagSurcharge === 'number'
        ? (orderData.preferences as { tagSurcharge: number }).tagSurcharge
        : 0;
      const discountAmountBefore = typeof orderData.discountAmount === 'number'
        ? orderData.discountAmount
        : 0;
      const tagIdsBefore = typeof orderData.preferences === 'object'
        && orderData.preferences !== null
        && Array.isArray((orderData.preferences as { tagIds?: unknown }).tagIds)
        ? ((orderData.preferences as { tagIds: string[] }).tagIds)
        : [];

      // 重檢折扣碼
      const recheck = await recheckDiscountCode(db, {
        discountCode: (orderData.discountCode as string | null | undefined) ?? null,
        originalDiscountAmount: discountAmountBefore,
        orderType: (orderData.orderType as string | undefined) ?? '',
        fareBeforeDiscount,
      });

      // 重算 finalTotal
      const beforeCalc = recalcFinalTotal({
        fareBeforeDiscount,
        discountAmount: discountAmountBefore,
        tagSurcharge: tagSurchargeBefore,
      });
      const afterCalc = recalcFinalTotal({
        fareBeforeDiscount,
        discountAmount: recheck.discountAmount,
        tagSurcharge: newSnapshot.tagSurcharge,
      });

      // 寫入 updates（snapshot + 新車資 + discount fallback / 更新）
      updates.preferences = snapshotForFirestore(newSnapshot);
      updates.estimatedFare = afterCalc.finalTotal;
      updates.discountAmount = recheck.discountAmount;
      // fareBeforeDiscount 不變（route 未動）；舊單若無此欄位 → 補寫一筆便於日後 audit / 重算
      if (typeof orderData.fareBeforeDiscount !== 'number') {
        updates.fareBeforeDiscount = fareBeforeDiscount;
      }

      tagRecalcWarning = recheck.warning === 'expired_fallback' ? 'discount_expired_fallback' : null;
      tagRecalcAudit = {
        tagIdsBefore,
        tagIdsAfter: newSnapshot.tagIds,
        fareBeforeDiscount,
        tagSurchargeBefore,
        tagSurchargeAfter: newSnapshot.tagSurcharge,
        discountAmountBefore,
        discountAmountAfter: recheck.discountAmount,
        finalTotalBefore: beforeCalc.finalTotal,
        finalTotalAfter: afterCalc.finalTotal,
        warning: tagRecalcWarning,
      };
    }

    await ref.update(updates);

    // 通知司機訂單已取消（pending 無指派司機則不通知；fire-and-forget）
    // W4：改走 driver.order-cancelled-assigned 模板；cancelReason 預組「原因：...\n」或空字串
    if (body.orderStatus === 'cancelled' && prevStatus !== 'cancelled' && orderAssignedDriver) {
      const driverLineUid = _stripLinePrefix(orderAssignedDriver);
      const tpl = (await resolveTemplate(db, 'driver.order-cancelled-assigned')) as TemplateContentText;
      const msg = buildTemplate(tpl, {
        orderId: orderId.slice(0, 8).toUpperCase(),
        cancelReason: body.cancelReason ? `原因：${body.cancelReason}\n` : '',
      }, 'text');
      if (msg) await sendLinePush('driver', driverLineUid, [msg]);
    }

    // Phase 1E：取消「已派發但尚未指派」訂單時，通知所有 active bidders（fire-and-forget）
    if (
      body.orderStatus === 'cancelled'
      && prevStatus !== 'cancelled'
      && orderData.dispatchAt
      && !orderAssignedDriver
    ) {
      const bidderUids = activeBidderLineUids(orderData.bids);
      if (bidderUids.length > 0) {
        void (async () => {
          try {
            await pushOrderCancelledToBidders(db, bidderUids, { orderId });
          } catch (err) {
            console.error('[orders/patch] cancel bidders push failed:', err);
          }
        })();
        if (isAdmin) {
          await writeAuditLog({
            event,
            auth,
            action: 'order.cancel_dispatched',
            targetType: 'order',
            targetId: orderId,
            payload: { bidderCount: bidderUids.length },
          });
        }
      }
    }

    // P19：訂單 status 切 en_route 時，driver doc 自動切 busy（不是 confirmed）
    // - drivers doc key 是 lineUid（去 prefix）；assignedDriverId 寫入時已 normalize 帶 prefix
    // P25-1：busy 切換時必須結算當前 online 段（busy 期間不計入 online hours）
    if (body.orderStatus === 'en_route' && prevStatus !== 'en_route') {
      const rawDriverId = orderAssignedDriver || (body.assignedDriverId as string | undefined);
      if (rawDriverId) {
        const driverLineUid = _stripLinePrefix(rawDriverId);
        try {
          const driverRef = db.collection('drivers').doc(driverLineUid);
          const driverSnap = await driverRef.get();
          const driverData = (driverSnap.exists ? driverSnap.data() : {}) as DriverStatsDoc;
          const patch = composeStatusTransitionPatch(driverData, 'busy');
          patch.lastActiveAt = FieldValue.serverTimestamp();
          await driverRef.set(patch, { merge: true });
        } catch (err) {
          console.error('[orders/patch] driver busy switch failed:', err);
        }
      }
    }

    // P18：當訂單狀態剛切換為 'completed'（前一狀態非 completed），對司機 drivers doc 累加統計
    // P19：同時 query 該 driver 是否仍有「執行中」訂單；無則 status 切回 'online'
    // P25-1：統計累加前先過 maybeResetTodayPatch（跨日歸零）；切回 online 時透過
    //        composeStatusTransitionPatch 重啟 currentOnlineSessionStartAt 以恢復計時
    const wasCompleted = prevStatus === 'completed';
    if (body.orderStatus === 'completed' && !wasCompleted) {
      const rawDriverId = orderAssignedDriver;
      if (rawDriverId) {
        const driverLineUid = _stripLinePrefix(rawDriverId);
        const driverIdWithPrefix = _normalizeDriverId(rawDriverId);
        const fare = (orderData.estimatedFare as number) ?? 0;
        const distance = (orderData.distanceKm as number) ?? 0;

        try {
          const driverRef = db.collection('drivers').doc(driverLineUid);
          const driverSnap = await driverRef.get();
          const driverData = (driverSnap.exists ? driverSnap.data() : {}) as DriverStatsDoc;

          // P25-1：先看是否跨日歸零（今日統計用）— 歸零 patch 含 todayTrips/todayEarnings/todayOnlineSeconds = 0
          const resetPatch = maybeResetTodayPatch(driverData);

          // 累加：若歸零，從 0 累加；若未歸零，FieldValue.increment 累加既有值
          const todayBase = resetPatch ? 0 : (driverData.todayTrips ?? 0);
          const todayEarnBase = resetPatch ? 0 : (driverData.todayEarnings ?? 0);

          const incrementPatch: Record<string, unknown> = {
            totalTrips: FieldValue.increment(1),
            totalEarnings: FieldValue.increment(fare),
            totalDistanceKm: FieldValue.increment(distance),
            todayTrips: todayBase + 1,
            todayEarnings: todayEarnBase + fare,
            lastTripAt: FieldValue.serverTimestamp(),
            ...(resetPatch ?? {}),
            // 歸零 patch 內 todayResetAt 用 Date；保留覆蓋
          };
          await driverRef.set(incrementPatch, { merge: true });

          // P19：query 是否仍有其他「執行中」訂單（兼容雙格式）
          const driverIdNoPrefix = driverLineUid;
          const remaining = await db.collection('orders')
            .where('assignedDriverId', 'in', [driverIdWithPrefix, driverIdNoPrefix])
            .where('orderStatus', 'in', EXECUTING_STATUSES)
            .limit(1)
            .get();
          if (remaining.empty) {
            // P25-1：切回 online 時透過 composeStatusTransitionPatch 重啟 session
            // 用剛剛 increment 後的最新資料（status 仍是 busy，currentOnlineSessionStartAt 應為 null）
            const refreshSnap = await driverRef.get();
            const refreshData = (refreshSnap.exists ? refreshSnap.data() : {}) as DriverStatsDoc;
            const onlinePatch = composeStatusTransitionPatch(refreshData, 'online');
            onlinePatch.lastActiveAt = FieldValue.serverTimestamp();
            await driverRef.set(onlinePatch, { merge: true });
          }
        } catch (err) {
          console.error('[orders/patch] driver completion update failed:', err);
        }

        // 通知司機訂單已完成 + 收入入帳（fire-and-forget）
        // W4：改走 driver.order-completed-earnings 模板；fare 已帶千分位
        const completedTpl = (await resolveTemplate(db, 'driver.order-completed-earnings')) as TemplateContentText;
        const completedMsg = buildTemplate(completedTpl, {
          orderId: orderId.slice(0, 8).toUpperCase(),
          fare: fare.toLocaleString(),
        }, 'text');
        if (completedMsg) await sendLinePush('driver', driverLineUid, [completedMsg]);
      }
    }

    // ── 推薦獎勵機制 Phase 2：被推薦人完成首單 → 推薦人取得獎勵 ──
    // status 剛切 completed 時觸發資格判定；fire-and-forget，錯誤吞掉不影響訂單回應。
    if (body.orderStatus === 'completed' && !wasCompleted && orderUserId) {
      void (async () => {
        try {
          const result = await processReferralQualification(db, orderUserId, orderId);
          if (result.ok) {
            // 推播推薦人：朋友完成首趟、附推薦獎勵碼（passenger OA；依推薦人語系）
            // W4：getReferralPushMessage 已隨 i18n-message 拔除，hardcoded 三語直寫
            const referrerLang = await getUserLang(db, result.referrerUid);
            const rewardText =
              referrerLang === 'en'
                ? `🎉 Your referred friend completed their first trip!\nReferral reward code: ${result.rewardCode}\nApply it on your next booking. Thanks for sharing!`
                : referrerLang === 'ja'
                  ? `🎉 ご紹介のお友達が初回送迎を完了しました！\n紹介報酬コード：${result.rewardCode}\n次回のご予約でご利用いただけます。ご紹介ありがとうございます。`
                  : `🎉 您推薦的好友已完成首趟行程！\n推薦獎勵碼：${result.rewardCode}\n下次訂車輸入即可折抵，感謝您的推薦。`;
            await sendLinePush('passenger', result.referrerUid, [{
              type: 'text',
              text: rewardText,
            }]);
          }
        } catch (err) {
          console.error('[orders/patch] referral qualification failed:', err);
        }
      })();
    }

    // ── 推薦獎勵機制 Phase 5+ FU：完成「首筆」訂單 → 推送活動分享卡（fire-and-forget）──
    // 條件：kill-switch enabled=true + 該乘客首筆 completed 訂單（避免推播疲勞）+
    //       乘客已有自己的 referralCode（CTA 帶入），缺 liffId / referralCode 時略過。
    if (body.orderStatus === 'completed' && !wasCompleted && orderUserId) {
      void (async () => {
        try {
          const campaign = await getReferralCampaign(db);
          if (!campaign.enabled) return;

          // 首筆判定：current 訂單已被 patch 為 completed，排除自身後若無其他 completed → 首筆
          const ordersSnap = await db.collection('orders').where('userId', '==', orderUserId).get();
          const hasOtherCompleted = ordersSnap.docs.some(
            (d) => d.id !== orderId && d.data().orderStatus === 'completed',
          );
          if (hasOtherCompleted) return;

          // 讀乘客自己的 referralCode（line-exchange lazy backfill；理論上必有）
          const userSnap = await db.collection('users').doc(orderUserId).get();
          const referralCode = (userSnap.data()?.referralCode as string | undefined) ?? '';
          if (!referralCode) return;

          const passengerLineUid = (orderData.lineUserId as string | undefined) || orderUserId;
          const lang = await getUserLang(db, passengerLineUid);
          const liffId = (useRuntimeConfig().public as { lineLiffIdPassenger?: string }).lineLiffIdPassenger ?? '';
          const flex = buildReferralShareFlex({
            shareCard: campaign.shareCard,
            referralCode,
            lang,
            liffId,
          });
          if (!flex) return;
          await sendLinePush('passenger', passengerLineUid, [flex]);
        } catch (err) {
          console.error('[orders/patch] referral share push failed:', err);
        }
      })();
    }

    // ── P37 Phase 4：訂單事件推播給乘客（4 個觸發點 + design.md §8.7 移除 arrived_pickup）──
    // fire-and-forget；錯誤吞掉。passenger OA 推播。
    //
    // 2026-05-14 hotfix：admin 指派司機 (pending → confirmed) 不主動推「司機已接單」，
    // 改由 admin 用「通知乘客」按鈕手動推（admin 場景常見：先指派 + 改其他欄位 + 才通知）。
    // driver 自己搶單觸發的 confirmed 仍會推（isAdmin=false / isDriver=true 路徑）。
    if (body.orderStatus && body.orderStatus !== prevStatus) {
      const PUSH_MAP: Partial<Record<OrderStatus, string>> = {
        confirmed: 'order.confirmed',
        en_route:  'order.en_route',
        completed: 'order.completed',
        cancelled: 'order.cancelled',
        // arrived_pickup / in_transit / pending 不推（spec 拍板）
      };
      const isAdminConfirmAssign = isAdmin && body.orderStatus === 'confirmed';
      const messageKey = PUSH_MAP[body.orderStatus as OrderStatus];
      const passengerLineUid = (orderData.lineUserId as string | undefined) || orderUserId;
      if (messageKey && passengerLineUid && !isAdminConfirmAssign) {
        const newStatus = body.orderStatus as OrderStatus;
        const cancelReason = body.cancelReason || undefined;
        void (async () => {
          try {
            const lang = await getUserLang(db, passengerLineUid);
            // W4：4 個 status template 全部 outputType='flex' + i18nMode='multi'；
            // 走 resolveTemplate(lang) + buildTemplate dispatcher，缺值由 resolveTemplate
            // 自動退 registry default（i18n-message fallback 已拔除）。
            const params: Record<string, string> = {
              orderId: orderId.slice(0, 8).toUpperCase(),
            };
            if ((newStatus === 'confirmed' || newStatus === 'en_route') && orderAssignedDriver) {
              try {
                const driverLineUid = _stripLinePrefix(orderAssignedDriver);
                const driverSnap = await db.collection('drivers').doc(driverLineUid).get();
                if (driverSnap.exists) {
                  const dd = driverSnap.data() ?? {};
                  if (typeof dd.driverName === 'string') params.driverName = dd.driverName;
                  if (typeof dd.plateNumber === 'string') params.vehiclePlate = dd.plateNumber;
                }
              } catch (err) {
                console.warn('[orders/patch] driver lookup for push failed:', err);
              }
            }
            if (newStatus === 'completed') {
              const fareNum = (orderData.estimatedFare as number | undefined) ?? 0;
              params.fare = fareNum.toLocaleString();
            }
            if (newStatus === 'cancelled' && cancelReason) {
              params.cancelReason = cancelReason;
            }

            const tpl = await resolveTemplate(db, messageKey, lang);
            const msg = buildTemplate(tpl, params, 'flex');
            if (msg) await sendLinePush('passenger', passengerLineUid, [msg]);
          } catch (err) {
            console.error(`[orders/patch] passenger push (${newStatus}) failed:`, err);
          }
        })();
      }
    }

    // ── admin 自動通知：全部狀態變更都推（含操作者本人；fire-and-forget）──
    if (body.orderStatus && body.orderStatus !== prevStatus) {
      const fromStatus = prevStatus;
      const toStatus = body.orderStatus;
      void (async () => {
        try {
          await notifyAdmins(db, 'adminNotify.orderStatusChanged', {
            orderId: orderId.slice(0, 8).toUpperCase(),
            fromStatus,
            toStatus,
          });
        } catch (err) {
          console.error('[orders/patch] admin notify failed:', err);
        }
      })();
    }

    // P25-2 audit log：僅 admin 操作 log；driver / passenger 動作不入 audit_logs
    if (isAdmin) {
      const auditActions: Array<{ action: AuditAction; payload: Record<string, unknown> }> = [];
      if (body.assignedDriverId !== undefined) {
        auditActions.push({ action: 'order.assign', payload: { driverId: body.assignedDriverId } });
      }
      if (body.orderStatus !== undefined && body.orderStatus !== prevStatus) {
        if (body.orderStatus === 'cancelled') {
          auditActions.push({ action: 'order.cancel_by_admin', payload: { before: prevStatus, reason: body.cancelReason ?? '' } });
        } else {
          auditActions.push({ action: 'order.status_change', payload: { before: prevStatus, after: body.orderStatus } });
        }
      }
      // admin 改 admin-only 欄位（pickupDateTime / locations / vehicle / etc）→ order.edit
      const editedAdminFields = ADMIN_ONLY_FIELDS.filter((k) => body[k] !== undefined);
      if (editedAdminFields.length > 0) {
        auditActions.push({ action: 'order.edit', payload: { fields: editedAdminFields, after: editedAdminFields.reduce((acc, k) => { acc[k] = body[k]; return acc; }, {} as Record<string, unknown>) } });
      }
      // Wave 1C：tag 後修 + 車資重算
      if (tagRecalcAudit) {
        auditActions.push({
          action: 'order.tag-update.price-recalc',
          payload: {
            before: {
              tagIds: tagRecalcAudit.tagIdsBefore,
              tagSurcharge: tagRecalcAudit.tagSurchargeBefore,
              discountAmount: tagRecalcAudit.discountAmountBefore,
              finalTotal: tagRecalcAudit.finalTotalBefore,
            },
            after: {
              tagIds: tagRecalcAudit.tagIdsAfter,
              tagSurcharge: tagRecalcAudit.tagSurchargeAfter,
              discountAmount: tagRecalcAudit.discountAmountAfter,
              finalTotal: tagRecalcAudit.finalTotalAfter,
            },
            fareBeforeDiscount: tagRecalcAudit.fareBeforeDiscount,
            warning: tagRecalcAudit.warning,
          },
        });
      }
      for (const a of auditActions) {
        await writeAuditLog({ event, auth, action: a.action, targetType: 'order', targetId: orderId, payload: a.payload });
      }
    }

    // 回傳：基本欄位 + tag recalc 結果（admin 後修場景才有 finalTotal / warning）
    const responsePayload: Record<string, unknown> = { orderId, ...body };
    if (tagRecalcAudit) {
      responsePayload.recalc = {
        before: {
          tagIds: tagRecalcAudit.tagIdsBefore,
          tagSurcharge: tagRecalcAudit.tagSurchargeBefore,
          discountAmount: tagRecalcAudit.discountAmountBefore,
          finalTotal: tagRecalcAudit.finalTotalBefore,
        },
        after: {
          tagIds: tagRecalcAudit.tagIdsAfter,
          tagSurcharge: tagRecalcAudit.tagSurchargeAfter,
          discountAmount: tagRecalcAudit.discountAmountAfter,
          finalTotal: tagRecalcAudit.finalTotalAfter,
        },
        diff: {
          finalTotal: tagRecalcAudit.finalTotalAfter - tagRecalcAudit.finalTotalBefore,
          tagSurcharge: tagRecalcAudit.tagSurchargeAfter - tagRecalcAudit.tagSurchargeBefore,
          discountAmount: tagRecalcAudit.discountAmountAfter - tagRecalcAudit.discountAmountBefore,
        },
        warnings: tagRecalcWarning ? [tagRecalcWarning] : [],
      };
    }
    return successResponse(responsePayload);
  } catch (err) {
    console.error('[orders/patch] Firestore update failed:', err);
    return serverError();
  }
});
