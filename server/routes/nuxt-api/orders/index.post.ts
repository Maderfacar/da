import { calculateFare } from '~shared/pricing';
import type { OrderType, FareBreakdownV2 } from '~shared/pricing';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendLinePush } from '@@/utils/line-push';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { getFleetConfig } from '@@/utils/fleet-config';
import { getRouteWithFare } from '@@/utils/fare-calculator-v2';
import { getUserLang } from '@@/utils/user-lang';
import { buildTemplate, resolveTemplate } from '@@/utils/template-registry';
import { validateDiscountCode, redeemDiscountCode } from '@@/utils/discount-code';
import { notifyAdmins } from '@@/utils/notify-admins';
import {
  validateAndSnapshotPreferences,
  snapshotForFirestore,
} from '@@/utils/order-preferences';

// 將 booking 端的上車時間字串視為台灣時間（無時區資訊時補 +08:00），
// 供 Fare V2 顛峰塞車費判定。
function parseTaiwanTime(raw: string): Date {
  const hasZone = /z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(hasZone ? iso : `${iso}+08:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

interface GooglePlace {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

interface LuggageItemBody {
  typeId: string;
  count: number;
}

interface CreateOrderBody {
  // P17：userId / lineUserId 不再從 client 接收，由 server 從 ID token 取
  userId?: string;
  lineUserId?: string;
  orderType: OrderType;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  /** 向後相容；批次 2 後 server 寫入時 = adultCount + childCount */
  passengerCount: number;
  /** Booking v2 批次 2：大人數（舊 client 不帶時 server 用 passengerCount fallback） */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數（舊 client 不帶時補 0） */
  childCount?: number;
  // P23：行李改 luggageItems 陣列（每項含 typeId + count）；vehicleType / extraServices 改 string id
  luggageItems: LuggageItemBody[];
  vehicleType: string;
  extraServices?: string[];
  // P20：補上 driver/admin 端需要的欄位
  contactPhone: string;
  // Booking v2 批次 1：聯絡人 / 乘車人姓名（optional；舊 client 不帶）
  contactName?: string | null;
  passengerName?: string | null;
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
  // 折扣碼（陽春版）；無折扣則不帶
  discountCode?: string | null;
  // Phase 1D：偏好標籤（vehicle-scope tag ids；無 → 跳過）
  preferences?: {
    tagIds?: string[];
  } | null;
}

const PHONE_REGEX = /^09\d{8}$/;
const NOTES_MAX_LENGTH = 200;
const NAME_MAX_LENGTH = 40;

export default defineEventHandler(async (event) => {
  // P17：必須登入；userId / lineUserId 強制使用 auth.lineUid（去 'line:' prefix）
  // 這同時：(a) 修復 P14 引入的 GET 查詢格式不一致 bug、(b) 補上 P14 漏改的 IDOR
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const body = await readBody<CreateOrderBody>(event);

  if (!body.orderType || !body.pickupDateTime || !body.pickupLocation || !body.dropoffLocation) {
    return badRequestError({ zh_tw: '缺少必要欄位', en: 'Missing required fields', ja: '必須フィールドが不足しています' });
  }

  // P17：強制使用 caller 自己的 lineUid，忽略 client body 中的 userId / lineUserId
  // admin 為他人下單目前不支援（罕見場景，需另外設計）
  const userId = auth.lineUid;
  const lineUserId = auth.lineUid;

  // Booking v2 批次 2：拆 adult/child。舊 client 只帶 passengerCount → adultCount fallback。
  // adult ≥ 1（至少一位大人）、child ≥ 0；vehicle.capacity 校驗於 vehicle 載入後再做。
  const rawAdult = Number.isInteger(body.adultCount) ? (body.adultCount as number) : Number.NaN;
  const rawChild = Number.isInteger(body.childCount) ? (body.childCount as number) : Number.NaN;
  const hasAdultChild = Number.isInteger(rawAdult) || Number.isInteger(rawChild);
  const adultCount = Number.isFinite(rawAdult) ? rawAdult : (body.passengerCount ?? 0);
  const childCount = Number.isFinite(rawChild) ? rawChild : 0;
  if (!Number.isInteger(adultCount) || adultCount < 1) {
    return badRequestError({
      zh_tw: '大人人數需 ≥ 1',
      en: 'Adult count must be ≥ 1',
      ja: '大人人数は1人以上',
    });
  }
  if (!Number.isInteger(childCount) || childCount < 0) {
    return badRequestError({
      zh_tw: '兒童人數需 ≥ 0',
      en: 'Child count must be ≥ 0',
      ja: '子供人数は0人以上',
    });
  }
  const totalPassengers = adultCount + childCount;
  if (totalPassengers < 1 || totalPassengers > 20) {
    return badRequestError({
      zh_tw: '總人數需介於 1–20',
      en: 'Total passengers must be 1–20',
      ja: '合計人数は1〜20',
    });
  }
  // 若 client 只帶 passengerCount（舊行為）但與 adult/child 不一致 → 以 adult+child 為準
  void hasAdultChild;

  // P20：contactPhone 為必填，必須符合台灣手機格式 09xxxxxxxx
  if (!body.contactPhone || !PHONE_REGEX.test(body.contactPhone)) {
    return badRequestError({
      zh_tw: '聯絡電話格式錯誤（須為 09 開頭的 10 碼數字）',
      en: 'Invalid contact phone (must be 10 digits starting with 09)',
      ja: '連絡先電話番号の形式が不正です（09で始まる10桁の数字）',
    });
  }

  // P20：notes 限制 200 字
  if (body.notes && body.notes.length > NOTES_MAX_LENGTH) {
    return badRequestError({
      zh_tw: '備註長度不可超過 200 字',
      en: 'Notes must be 200 characters or fewer',
      ja: '備考は200文字以内で入力してください',
    });
  }

  // Booking v2 批次 1：聯絡人 / 乘車人姓名（optional；長度 ≤ 40）
  const contactNameTrimmed = typeof body.contactName === 'string' ? body.contactName.trim() : '';
  const passengerNameTrimmed = typeof body.passengerName === 'string' ? body.passengerName.trim() : '';
  if (contactNameTrimmed.length > NAME_MAX_LENGTH || passengerNameTrimmed.length > NAME_MAX_LENGTH) {
    return badRequestError({
      zh_tw: `姓名長度不可超過 ${NAME_MAX_LENGTH} 字`,
      en: `Name must be ${NAME_MAX_LENGTH} characters or fewer`,
      ja: `氏名は${NAME_MAX_LENGTH}文字以内で入力してください`,
    });
  }

  const { googleMapsApiKey, firebaseServiceAccountJson } = useRuntimeConfig();

  // P23：fleet config 撈 + Firestore 寫入皆需 firebaseServiceAccountJson；提前到 distance 計算前
  if (!firebaseServiceAccountJson) {
    console.error('[orders/post] firebaseServiceAccountJson is empty/missing');
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

  // P25：訂單上限檢查 — 同一使用者最多 4 筆未完成且未取消的訂單，避免單帳號亂訂
  // 用單欄位 where + client filter（不需 composite index）；測試階段每位 user 訂單 < 10 可接受
  const ACTIVE_ORDER_LIMIT = 4;
  const FINISHED_STATUSES = new Set(['completed', 'cancelled']);
  const userOrdersSnap = await db.collection('orders')
    .where('userId', '==', auth.lineUid)
    .get();
  const activeCount = userOrdersSnap.docs.filter(
    (d) => !FINISHED_STATUSES.has(d.data().orderStatus),
  ).length;
  if (activeCount >= ACTIVE_ORDER_LIMIT) {
    return badRequestError({
      zh_tw: `同一帳號最多 ${ACTIVE_ORDER_LIMIT} 筆未完成訂單，請先取消或等待現有訂單完成後再下單`,
      en: `Max ${ACTIVE_ORDER_LIMIT} active orders per account. Cancel or wait for existing orders to complete.`,
      ja: `1アカウントにつき未完了の予約は最大${ACTIVE_ORDER_LIMIT}件です。既存予約のキャンセルまたは完了をお待ちください。`,
    });
  }

  const validStopovers = (body.stopovers ?? []).filter((s) => s && s.lat !== 0);

  // P23：從 Firestore fleet config 撈 vehicle / extras 算費用（不再用 hardcoded VEHICLE_CONFIGS）
  // db 已在 P25 訂單上限檢查時取得
  const fleet = await getFleetConfig(db);
  const vehicle = fleet.vehicles.find((v) => v.id === body.vehicleType);
  if (!vehicle) {
    return badRequestError({
      zh_tw: `無效的車型：${body.vehicleType}`,
      en: `Invalid vehicle type: ${body.vehicleType}`,
      ja: `無効な車種：${body.vehicleType}`,
    });
  }
  // Booking v2 批次 2：大人 + 兒童 ≤ vehicle.capacity（兒童佔 1 座位）
  if (totalPassengers > vehicle.capacity) {
    return badRequestError({
      zh_tw: `所選車型最多 ${vehicle.capacity} 人，目前大人 ${adultCount} + 兒童 ${childCount} 共 ${totalPassengers} 人`,
      en: `Selected vehicle capacity is ${vehicle.capacity}; current total is ${totalPassengers} (${adultCount} adults + ${childCount} children)`,
      ja: `選択車種は最大${vehicle.capacity}人。現在の合計：${totalPassengers}人（大人${adultCount} + 子供${childCount}）`,
    });
  }
  const extraServiceIds = body.extraServices ?? [];
  const selectedExtras = extraServiceIds
    .map((id) => fleet.extras.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  const orderId = crypto.randomUUID();

  // Fare V2：與 booking step 3/4 顯示一致的車資來源。
  // getRouteWithFare 內部：Routes API 失敗自動降級 v1；連 v1 Directions 也失敗才 throw。
  let estimatedFare: number;
  let distanceKm: number;
  let estimatedTime: number;
  let fareBreakdown: FareBreakdownV2 | null = null;
  let fareVersion: 'v1' | 'v2' = 'v1';
  try {
    const fareResult = await getRouteWithFare({
      origin: { lat: body.pickupLocation.lat, lng: body.pickupLocation.lng },
      destination: { lat: body.dropoffLocation.lat, lng: body.dropoffLocation.lng },
      waypoints: validStopovers.map((s) => ({ lat: s.lat, lng: s.lng })),
      vehicle: { baseFare: vehicle.baseFare, perKmRate: vehicle.perKmRate },
      extras: selectedExtras.map((e) => ({ price: e.price })),
      pickupTime: parseTaiwanTime(body.pickupDateTime),
      orderType: body.orderType,
      apiKey: googleMapsApiKey,
      orderId,
    });
    if (fareResult.version === 'v2') {
      estimatedFare = fareResult.breakdown.final;
      distanceKm = fareResult.metrics.distanceKm;
      estimatedTime = Math.round(fareResult.metrics.durationSec / 60);
      fareBreakdown = fareResult.breakdown;
      fareVersion = 'v2';
    } else {
      estimatedFare = fareResult.final;
      distanceKm = fareResult.route.distanceKm;
      estimatedTime = fareResult.route.durationMinutes;
    }
  } catch (err) {
    // 連 v1 Directions 都失敗 → 最終 fallback：距離 25km + v1 公式
    console.error('[orders/post] fare calculation failed, using 25km fallback:', err);
    distanceKm = 25;
    estimatedFare = calculateFare(vehicle, distanceKm, selectedExtras);
    estimatedTime = Math.round(distanceKm * 1.8);
  }

  // P23：行李 SU 校驗（伺服器端最後一道把關，前端 UI 應已 disable 超 1.5 倍車型）
  const luggageItems = Array.isArray(body.luggageItems) ? body.luggageItems : [];
  const totalSU = luggageItems.reduce((sum, item) => {
    const lt = fleet.luggageTypes.find((t) => t.id === item.typeId);
    return sum + (lt?.su ?? 0) * (item.count ?? 0);
  }, 0);
  if (totalSU > vehicle.luggageSU * 1.5) {
    return badRequestError({
      zh_tw: `行李超出車型容量上限（${totalSU} SU > ${Math.floor(vehicle.luggageSU * 1.5)} SU）`,
      en: `Luggage exceeds vehicle capacity (${totalSU} SU > ${Math.floor(vehicle.luggageSU * 1.5)} SU)`,
      ja: `荷物が車種容量を超過（${totalSU} SU > ${Math.floor(vehicle.luggageSU * 1.5)} SU）`,
    });
  }

  // ── 折扣碼處理 ────────────────────────────────────────────────────
  // estimatedFare 此時為「折扣前車資」；套折扣後 estimatedFare 重算為折後最終車資。
  const fareBeforeDiscount = estimatedFare;
  let discountCode: string | null = null;
  let discountAmount = 0;

  const rawDiscountCode = typeof body.discountCode === 'string' ? body.discountCode.trim() : '';
  if (rawDiscountCode) {
    try {
      // (a) 先驗證（傳折扣前車資當 fare）
      const validation = await validateDiscountCode(db, {
        code: rawDiscountCode,
        fare: fareBeforeDiscount,
        orderType: body.orderType,
        userId: auth.lineUid,
      });
      if (!validation.ok) {
        // 前端已預覽過，正常不會走到；防呆回 400
        return badRequestError(validation.reason);
      }
      // (b) transaction 計次（再次檢查 enabled / 時間 / maxRedemptions）
      const redeem = await redeemDiscountCode(db, rawDiscountCode);
      if (!redeem.ok) {
        return badRequestError(redeem.reason);
      }
      // (c) 套用折扣
      discountCode = rawDiscountCode.toUpperCase();
      discountAmount = validation.discountAmount;
      estimatedFare = fareBeforeDiscount - discountAmount;
    } catch (err) {
      // validateDiscountCode / redeemDiscountCode 內部 Firestore 例外不可變成未處理的 500
      console.error('[orders/post] discount code processing failed:', err);
      return serverError({
        zh_tw: '折扣碼處理失敗，請稍後重試',
        en: 'Failed to process discount code, please retry',
        ja: '割引コードの処理に失敗しました。後ほど再試行してください',
      });
    }
  }

  // ── Phase 1D：偏好標籤 snapshot + 加價 ─────────────────────────────
  // 規則：preferences 加在 baseFare 與 discount 之間
  //   折扣前車資 = baseFare（fare V2 計算）+ tagSurcharge
  //   final = (baseFare + tagSurcharge) - discountAmount
  // discount 的 minFare 仍用「baseFare」（不含 tagSurcharge），避免靠標籤拉高過 minFare
  let preferencesSnapshot: ReturnType<typeof snapshotForFirestore> | null = null;
  let tagSurcharge = 0;
  const prefInput = body.preferences && typeof body.preferences === 'object'
    ? { tagIds: Array.isArray(body.preferences.tagIds) ? body.preferences.tagIds : [] }
    : { tagIds: [] };
  if (prefInput.tagIds.length > 0) {
    try {
      const { errors, snapshot } = await validateAndSnapshotPreferences(db, prefInput);
      if (errors.length > 0) {
        const summary = errors.map((e) => `${e.field}:${e.code}`).join(', ');
        return badRequestError({
          zh_tw: `偏好標籤驗證失敗：${summary}`,
          en: `Preferences validation failed: ${summary}`,
          ja: `好み設定のバリデーション失敗：${summary}`,
        });
      }
      if (snapshot) {
        preferencesSnapshot = snapshotForFirestore(snapshot);
        tagSurcharge = snapshot.tagSurcharge;
      }
    } catch (err) {
      console.error('[orders/post] preferences snapshot failed:', err);
      return serverError({
        zh_tw: '偏好標籤處理失敗，請稍後重試',
        en: 'Failed to process preferences, please retry',
        ja: '好み設定の処理に失敗しました。後ほど再試行してください',
      });
    }
  }
  // 把 tagSurcharge 加進 estimatedFare（已扣折扣）；
  // 折扣 minFare 已用 fareBeforeDiscount 判定過，tagSurcharge 加在最後，不影響折扣資格
  if (tagSurcharge > 0) {
    estimatedFare = Math.max(0, estimatedFare + tagSurcharge);
  }

  try {
    await db.collection('orders').doc(orderId).set({
      orderId,
      userId,
      lineUserId,
      orderType: body.orderType,
      pickupDateTime: body.pickupDateTime,
      pickupLocation: body.pickupLocation,
      dropoffLocation: body.dropoffLocation,
      stopovers: body.stopovers ?? [],
      // Booking v2 批次 2：passengerCount 寫入時 = adult + child（保留向後相容）
      passengerCount: totalPassengers,
      adultCount,
      childCount,
      // P23：行李改 luggageItems 陣列（typeId + count）
      luggageItems,
      vehicleType: body.vehicleType,
      extraServices: extraServiceIds,
      estimatedFare,
      estimatedTime,
      distanceKm,
      // Fare V2：訂單成立時的車資版本與明細快照（v1 降級時 fareBreakdown 為 null）
      fareVersion,
      fareBreakdown,
      // P20：driver/admin 端顯示用欄位（contactPhone 必填；其他舊訂單留 null fallback）
      contactPhone: body.contactPhone,
      // Booking v2 批次 1：聯絡人 / 乘車人；同聯絡人時 client 已同步、server 不再做 fallback
      contactName: contactNameTrimmed || null,
      passengerName: passengerNameTrimmed || null,
      flightNumber: body.flightNumber ?? null,
      terminal: body.terminal ?? null,
      notes: body.notes ?? null,
      // 折扣碼（陽春版）；estimatedFare 已為折後最終車資 + tagSurcharge
      discountCode,
      discountAmount,
      fareBeforeDiscount,
      // Phase 1D：偏好標籤 snapshot（null 表示乘客未勾選）；tagSurcharge 已併入 estimatedFare
      preferences: preferencesSnapshot,
      orderStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // 寫入失敗必須回 serverError，不能 silent 吞掉造成使用者誤以為訂單成立
    console.error('[orders/post] Firestore write failed:', err);
    return serverError({ zh_tw: '訂單寫入失敗，請稍後重試', en: 'Failed to save order, please retry', ja: '注文の保存に失敗しました' });
  }

  // ── LINE 訂單建立推播（fire-and-forget，失敗不影響訂單成立）──
  // P29：訂單建立者 = 乘客，用 passenger OA 推播
  // P37 Phase 4：原本走 i18n-message helper（依 users/{lineUid}.lang 選語系）
  // Wave 3-A1：優先讀 admin 編輯的模板 → 組 Flex Bubble；模板缺失 → fallback P37 三語 text
  if (lineUserId) {
    const params = {
      date: body.pickupDateTime.replace('T', ' ').slice(0, 16),
      pickup: body.pickupLocation.address,
      // P23：車型 label 從 fleet config 拿（中文 fallback），admin 改名即時生效
      vehicle: vehicle.label.zh || body.vehicleType,
      fare: estimatedFare.toLocaleString(),
      orderId: orderId.slice(0, 8).toUpperCase(),
    };

    // fire-and-forget：撈模板 + 推播都不 await，避免阻塞回應
    // W4：走 resolveTemplate(lang) + buildTemplate dispatcher，缺值由 resolveTemplate
    // 自動退 registry default（i18n-message fallback 已拔除）。
    void (async () => {
      try {
        const lang = await getUserLang(db, lineUserId);
        const tpl = await resolveTemplate(db, 'order.pending', lang);
        const msg = buildTemplate(tpl, params, 'flex');
        if (msg) await sendLinePush('passenger', lineUserId, [msg]);
      } catch (err) {
        console.error('[orders/post] pending push failed:', err);
      }
    })();
  }

  // ── admin 自動通知（fire-and-forget，失敗不影響訂單成立）──
  void (async () => {
    try {
      await notifyAdmins(db, 'adminNotify.orderCreated', {
        orderId: orderId.slice(0, 8).toUpperCase(),
        date: body.pickupDateTime.replace('T', ' ').slice(0, 16),
        pickup: body.pickupLocation.address,
      });
    } catch (err) {
      console.error('[orders/post] admin notify failed:', err);
    }
  })();

  return successResponse({
    orderId,
    estimatedFare,
    estimatedTime,
    distanceKm,
    orderStatus: 'pending',
  });
});
