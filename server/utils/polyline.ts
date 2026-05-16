// Polyline 解碼與地理距離工具 — Fare V2 route-metrics / county-detect 共用。
//
// Google encoded polyline algorithm（precision 5），Routes API v2 的
// polyline.encodedPolyline 與舊 Directions overview_polyline 同編碼。

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** 解碼 Google encoded polyline 字串為座標點陣列。 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 兩點 haversine 大圓距離（公里）。 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

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
