// Polyline 解碼與地理距離工具 — Fare V2 route-metrics / county-detect / charter round-trip 共用。
//
// 純函式部分（decodePolyline / haversineKm / LatLng）抽到 shared/geo/polyline.ts，
// 以便 shared/pricing.ts 與 shared/geo/round-trip.ts 也能直接呼叫並跑 vitest。
// 本檔保留 server 端取樣 / bounds 工具，並 re-export shared 介面以維持原 import 路徑相容。

import { decodePolyline, haversineKm, type LatLng } from '~shared/geo/polyline';

export { decodePolyline, haversineKm, type LatLng } from '~shared/geo/polyline';

/**
 * 沿 polyline 點序每隔 intervalKm 取一點（含首尾）。供 Elevation API 等距取樣。
 * @param maxPoints 可選；達上限即停（控制 Elevation API 單請求點數）
 */
export function samplePointsByDistanceKm(
  points: ReadonlyArray<LatLng>,
  intervalKm: number,
  maxPoints?: number,
): LatLng[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  if (points.length === 1) return [first];

  const out: LatLng[] = [first];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    acc += haversineKm(prev, curr);
    if (acc >= intervalKm) {
      out.push(curr);
      acc = 0;
      if (maxPoints && out.length >= maxPoints) return out;
    }
  }

  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if ((tail.lat !== last.lat || tail.lng !== last.lng) && (!maxPoints || out.length < maxPoints)) {
    out.push(last);
  }
  return out;
}

export interface LatLngBounds {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
}

/** 從 encoded polyline 算出外接矩形（供地圖 fitBounds）。空字串回 null。 */
export function boundsFromPolyline(encoded: string): LatLngBounds | null {
  const points = decodePolyline(encoded);
  if (points.length === 0) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return {
    northeast: { lat: maxLat, lng: maxLng },
    southwest: { lat: minLat, lng: minLng },
  };
}
