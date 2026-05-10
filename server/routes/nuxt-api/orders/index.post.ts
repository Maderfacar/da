import { calculateFare } from '~shared/pricing';
import type { OrderType } from '~shared/pricing';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendLinePush } from '@@/utils/line-push';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { getFleetConfig } from '@@/utils/fleet-config';

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
  passengerCount: number;
  // P23：行李改 luggageItems 陣列（每項含 typeId + count）；vehicleType / extraServices 改 string id
  luggageItems: LuggageItemBody[];
  vehicleType: string;
  extraServices?: string[];
  // P20：補上 driver/admin 端需要的欄位
  contactPhone: string;
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
}

const PHONE_REGEX = /^09\d{8}$/;
const NOTES_MAX_LENGTH = 200;

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

  if (body.passengerCount < 1 || body.passengerCount > 8) {
    return badRequestError({ zh_tw: '乘客人數必須在 1–8 之間', en: 'Passenger count must be 1–8', ja: '乗客数は 1〜8 にしてください' });
  }

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

  const { googleMapsApiKey, firebaseServiceAccountJson, lineChannelAccessToken } = useRuntimeConfig();

  // P23：fleet config 撈 + Firestore 寫入皆需 firebaseServiceAccountJson；提前到 distance 計算前
  if (!firebaseServiceAccountJson) {
    console.error('[orders/post] firebaseServiceAccountJson is empty/missing');
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  let distanceKm = 25; // mock fallback

  if (googleMapsApiKey) {
    const params = new URLSearchParams({
      origins: `${body.pickupLocation.lat},${body.pickupLocation.lng}`,
      destinations: `${body.dropoffLocation.lat},${body.dropoffLocation.lng}`,
      key: googleMapsApiKey,
      region: 'tw',
    });
    const res = await $fetch<any>(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
    ).catch(() => null);

    const element = res?.rows?.[0]?.elements?.[0];
    if (element?.status === 'OK') {
      distanceKm = Math.round(element.distance.value / 100) / 10;
    }
  }

  // P23：從 Firestore fleet config 撈 vehicle / extras 算費用（不再用 hardcoded VEHICLE_CONFIGS）
  const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
  const fleet = await getFleetConfig(db);
  const vehicle = fleet.vehicles.find((v) => v.id === body.vehicleType);
  if (!vehicle) {
    return badRequestError({
      zh_tw: `無效的車型：${body.vehicleType}`,
      en: `Invalid vehicle type: ${body.vehicleType}`,
      ja: `無効な車種：${body.vehicleType}`,
    });
  }
  const extraServiceIds = body.extraServices ?? [];
  const selectedExtras = extraServiceIds
    .map((id) => fleet.extras.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const estimatedFare = calculateFare(vehicle, distanceKm, selectedExtras);
  const estimatedTime = Math.round(distanceKm * 1.8);

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

  const orderId = crypto.randomUUID();

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
      passengerCount: body.passengerCount,
      // P23：行李改 luggageItems 陣列（typeId + count）
      luggageItems,
      vehicleType: body.vehicleType,
      extraServices: extraServiceIds,
      estimatedFare,
      estimatedTime,
      distanceKm,
      // P20：driver/admin 端顯示用欄位（contactPhone 必填；其他舊訂單留 null fallback）
      contactPhone: body.contactPhone,
      flightNumber: body.flightNumber ?? null,
      terminal: body.terminal ?? null,
      notes: body.notes ?? null,
      orderStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // 寫入失敗必須回 serverError，不能 silent 吞掉造成使用者誤以為訂單成立
    console.error('[orders/post] Firestore write failed:', err);
    return serverError({ zh_tw: '訂單寫入失敗，請稍後重試', en: 'Failed to save order, please retry', ja: '注文の保存に失敗しました' });
  }

  // ── LINE 訂單確認推播（fire-and-forget，失敗不影響訂單成立）──
  if (lineUserId && lineChannelAccessToken) {
    const dateStr = body.pickupDateTime.replace('T', ' ').slice(0, 16);
    const fareStr = estimatedFare.toLocaleString();
    // P23：車型 label 從 fleet config 拿（中文 fallback），admin 改名即時生效
    const vehicleLabel = vehicle.label.zh || body.vehicleType;
    const msg = [
      '✅ 訂單確認',
      `📅 接送時間：${dateStr}`,
      `📍 上車地點：${body.pickupLocation.address}`,
      `🚗 車型：${vehicleLabel}`,
      `💰 預估費用：NT$ ${fareStr}`,
      `🔖 訂單編號：${orderId.slice(0, 8).toUpperCase()}`,
    ].join('\n');
    sendLinePush(lineChannelAccessToken, lineUserId, [{ type: 'text', text: msg }]);
  }

  return successResponse({
    orderId,
    estimatedFare,
    estimatedTime,
    distanceKm,
    orderStatus: 'pending',
  });
});
