// POST /nuxt-api/orders — 建立訂單（Stage 4：計價 + 暫存，Firestore 持久化於 Stage 5）
import { calculateFare } from '~shared/pricing';
import type { VehicleType, OrderType, ExtraService } from '~shared/pricing';

interface GooglePlace {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

interface CreateOrderBody {
  userId: string;
  lineUserId: string;
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
  const body = await readBody<CreateOrderBody>(event);

  if (!body.userId || !body.orderType || !body.pickupDateTime || !body.pickupLocation || !body.dropoffLocation) {
    return {
      data: {},
      status: { code: 400, message: { zh_tw: '缺少必要欄位', en: 'Missing required fields', ja: '必須フィールドが不足しています' } },
    };
  }

  if (body.passengerCount < 1 || body.passengerCount > 8) {
    return {
      data: {},
      status: { code: 400, message: { zh_tw: '乘客人數必須在 1–8 之間', en: 'Passenger count must be 1–8', ja: '乗客数は 1〜8 にしてください' } },
    };
  }

  const { googleMapsApiKey } = useRuntimeConfig();
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

  return {
    data: {
      orderId,
      estimatedFare,
      estimatedTime,
      distanceKm,
      orderStatus: 'pending',
    },
    status: { code: 200, message: { zh_tw: '訂單建立成功', en: 'Order created', ja: '注文が作成されました' } },
  };
});
