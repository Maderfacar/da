// GET /api/maps/route — 路線規劃 BFF（使用 Server Key，回傳 encoded polyline）
// 前端不直接呼叫 Directions API，避免 Browser Key 需開放 Directions API 授權

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const { origin, destination, waypoints } = query as {
    origin?: string;
    destination?: string;
    waypoints?: string; // pipe-separated "lat,lng|lat,lng"
  };

  if (!origin || !destination) {
    return {
      data: null,
      status: { code: 400, message: { zh_tw: '缺少起點或終點', en: 'Missing origin/destination', ja: '出発地または目的地が不足' } },
    };
  }

  const { googleMapsApiKey } = useRuntimeConfig();

  const params = new URLSearchParams({
    origin,
    destination,
    key: googleMapsApiKey,
    region: 'TW',
    language: 'zh-TW',
  });

  if (waypoints) {
    // pipe-separated → Google format: "via:lat,lng|via:lat,lng"
    const wps = waypoints.split('|').map((w) => `via:${w}`).join('|');
    params.append('waypoints', wps);
  }

  const res = await $fetch<any>(
    `https://maps.googleapis.com/maps/api/directions/json?${params}`,
  ).catch(() => null);

  if (!res || res.status !== 'OK' || !res.routes?.[0]) {
    return {
      data: null,
      status: { code: 422, message: { zh_tw: '路線計算失敗', en: 'Route calculation failed', ja: 'ルート計算に失敗しました' } },
    };
  }

  const route = res.routes[0];
  let totalDistanceM = 0;
  let totalDurationS = 0;
  for (const leg of route.legs) {
    totalDistanceM += leg.distance.value;
    totalDurationS += leg.duration.value;
  }

  return {
    data: {
      polyline: route.overview_polyline.points as string,
      bounds: route.bounds as { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } },
      distance_km: Math.round(totalDistanceM / 100) / 10,
      duration_minutes: Math.round(totalDurationS / 60),
    },
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  };
});
