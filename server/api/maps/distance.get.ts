// GET /api/maps/distance — Distance Matrix BFF（使用 Server Key）

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const { origin, destination } = query as { origin?: string; destination?: string };

  if (!origin || !destination) {
    return {
      data: {},
      status: { code: 400, message: { zh_tw: '缺少起點或終點參數', en: 'Missing origin or destination', ja: '出発地または目的地が不足しています' } },
    };
  }

  const { googleMapsApiKey } = useRuntimeConfig();

  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    key: googleMapsApiKey,
    region: 'TW',
    language: 'zh-TW',
    units: 'metric',
  });

  const res = await $fetch<any>(
    `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
  ).catch(() => null);

  const element = res?.rows?.[0]?.elements?.[0];
  if (!element || element.status !== 'OK') {
    return {
      data: { distance_km: 0, duration_minutes: 0, origin, destination },
      status: { code: 422, message: { zh_tw: '距離計算失敗', en: 'Distance calculation failed', ja: '距離計算失敗' } },
    };
  }

  return {
    data: {
      distance_km: Math.round(element.distance.value / 100) / 10,
      duration_minutes: Math.round(element.duration.value / 60),
      origin,
      destination,
    },
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  };
});
