/**
 * 路線距離計算 helper（含 stopovers waypoints）。
 *
 * 前端 BookingStepRoute 透過 `/api/maps/route` 顯示距離與車程；server orders POST 也須用
 * 同一份來源算費用，否則「乘客確認頁顯示金額」與「實際下單金額」會不一致（直接 origin→
 * destination 的 Distance Matrix 不會繞中途停靠站，距離較短）。
 *
 * 失敗時回 null，呼叫端自行決定 fallback。
 */

export interface RoutePoint { lat: number; lng: number }
export interface RouteResult { distanceKm: number; durationMinutes: number }

export const calcRouteDistance = async (
  apiKey: string,
  origin: RoutePoint,
  destination: RoutePoint,
  stopovers: ReadonlyArray<RoutePoint> = [],
): Promise<RouteResult | null> => {
  if (!apiKey) return null;

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    key: apiKey,
    region: 'TW',
    language: 'zh-TW',
  });

  // stopovers 走 via: prefix，避免被當成「必停且繞回主路線」(default 行為)；
  // 與前端 /api/maps/route 的處理一致
  if (stopovers.length > 0) {
    const wps = stopovers.map((p) => `via:${p.lat},${p.lng}`).join('|');
    params.append('waypoints', wps);
  }

  const res = await $fetch<{
    status: string;
    routes?: Array<{ legs: Array<{ distance: { value: number }; duration: { value: number } }> }>;
  }>(`https://maps.googleapis.com/maps/api/directions/json?${params}`).catch(() => null);

  if (!res || res.status !== 'OK' || !res.routes?.[0]) return null;

  let totalDistanceM = 0;
  let totalDurationS = 0;
  for (const leg of res.routes[0].legs) {
    totalDistanceM += leg.distance.value;
    totalDurationS += leg.duration.value;
  }

  return {
    distanceKm: Math.round(totalDistanceM / 100) / 10,
    durationMinutes: Math.round(totalDurationS / 60),
  };
};
