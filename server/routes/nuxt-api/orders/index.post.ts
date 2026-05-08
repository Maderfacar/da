import { calculateFare } from '~shared/pricing';
import type { VehicleType, OrderType, ExtraService } from '~shared/pricing';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendLinePush } from '@@/utils/line-push';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

interface GooglePlace {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

interface CreateOrderBody {
  // P17：userId / lineUserId 不再從 client 接收，由 server 從 ID token 取
  // body 仍接受這兩個欄位是為了向後相容，但會被忽略並用 auth.lineUid 覆寫
  userId?: string;
  lineUserId?: string;
  orderType: OrderType;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  passengerCount: number;
  luggageCount: number;
  vehicleType: VehicleType;
  extraServices?: ExtraService[];
}

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

  const { googleMapsApiKey, firebaseServiceAccountJson, lineChannelAccessToken } = useRuntimeConfig();
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

  const extraServices: ExtraService[] = body.extraServices ?? [];
  const estimatedFare = calculateFare(body.vehicleType, distanceKm, extraServices);
  const estimatedTime = Math.round(distanceKm * 1.8);

  const orderId = crypto.randomUUID();

  // P11-2：必須有 firebaseServiceAccountJson 才能寫入訂單，否則回 serverError
  // 而非 silent 200，避免使用者以為訂單成立但實際沒寫進資料庫
  if (!firebaseServiceAccountJson) {
    console.error('[orders/post] firebaseServiceAccountJson is empty/missing');
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
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
      luggageCount: body.luggageCount,
      vehicleType: body.vehicleType,
      extraServices: body.extraServices ?? [],
      estimatedFare,
      estimatedTime,
      distanceKm,
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
    const vehicleLabel: Record<string, string> = {
      sedan: '商務轎車', mpv: '商務 MPV', suv: '商務 SUV', van: '廂型車',
    };
    const msg = [
      '✅ 訂單確認',
      `📅 接送時間：${dateStr}`,
      `📍 上車地點：${body.pickupLocation.address}`,
      `🚗 車型：${vehicleLabel[body.vehicleType] ?? body.vehicleType}`,
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
