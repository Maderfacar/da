// 包車「來回」判定演算法 — Charter Fare V1 W2。
//
// 條件 1：D 到 (X→A polyline) 最短距離 ≤ charter.roundTripBufferKm
//   → 客人「順路下車」情境
// 條件 2：D 到 A 直線距離 ≤ charter.roundTripOverShootMaxKm
//   → 客人「過頭下車」情境
//
// isRoundTrip = 條件 1 OR 條件 2；無 stopover 或無 returnLegPolyline → false。

import { decodePolyline, haversineKm, type LatLng } from './polyline';

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 點到單條 segment（兩端 a / b）最短距離（km）。
 *
 * 以投影法：先把點投影到 a→b 線段，t 限制在 [0,1]，再算 haversine。
 * 短距離（< 數十公里）下用 equirectangular 投影誤差可忽略；台灣境內路線完全沒問題。
 */
function shortestKmFromPointToSegment(point: LatLng, a: LatLng, b: LatLng): number {
  // equirectangular 投影到 (x, y) — 單位「km」近似
  const meanLatRad = toRad((a.lat + b.lat) / 2);
  const toXY = (p: LatLng) => ({
    x: toRad(p.lng) * Math.cos(meanLatRad) * EARTH_RADIUS_KM,
    y: toRad(p.lat) * EARTH_RADIUS_KM,
  });
  const A = toXY(a);
  const B = toXY(b);
  const P = toXY(point);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    // a 與 b 幾乎重合 → 退回 haversine(point, a)
    return haversineKm(point, a);
  }
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj: LatLng = {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
  return haversineKm(point, proj);
}

/**
 * 點到 encoded polyline 最短距離（km）。對每個 segment 取 point-to-segment 距離，取最小值。
 * polyline 空 / 不足兩點 → Number.POSITIVE_INFINITY（呼叫端視為「無走廊」，條件 1 失敗）。
 */
export function shortestDistanceKmFromPointToPolyline(
  point: LatLng,
  encodedPolyline: string,
): number {
  if (!encodedPolyline) return Number.POSITIVE_INFINITY;
  const pts = decodePolyline(encodedPolyline);
  if (pts.length < 2) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = shortestKmFromPointToSegment(point, a, b);
    if (d < min) min = d;
  }
  return min;
}

export interface RoundTripCharterRule {
  roundTripBufferKm: number;
  roundTripOverShootMaxKm: number;
}

/**
 * 包車來回判定。
 *
 * - hasStopover === false（X / returnLegPolyline 為 null）→ 直接 false
 * - 條件 1 OR 條件 2 命中 → true
 */
export function detectRoundTrip(
  A: LatLng,
  X: LatLng | null,
  D: LatLng,
  returnLegPolyline: string | null,
  charter: RoundTripCharterRule,
): boolean {
  if (X === null || returnLegPolyline === null) return false;
  const cond1Km = shortestDistanceKmFromPointToPolyline(D, returnLegPolyline);
  if (cond1Km <= charter.roundTripBufferKm) return true;
  const cond2Km = haversineKm(D, A);
  if (cond2Km <= charter.roundTripOverShootMaxKm) return true;
  return false;
}
