// 縣市穿越偵測 — 判定路線取樣點落在哪些縣市，供 Fare V2 跨縣市補貼計算。
//
// 縣市邊界資料源 shared/geo/taiwan-counties.json 由 scripts/build-county-geojson.mjs 產出。
// 首次查詢時建立各縣市 bbox 與環，之後常駐重用。point-in-polygon 採射線法（ray casting），
// 免外部依賴。
//
// Fare V2 — Phase 1.4。

import countiesRaw from '~shared/geo/taiwan-counties.json';
import type { CountyCode } from '~shared/geo/county-codes';
import { isCountyCode } from '~shared/geo/county-codes';

type Ring = ReadonlyArray<readonly [number, number]>; // [lng, lat]

interface CountyPolygon {
  outer: Ring;
  holes: Ring[];
}

interface CountyShape {
  code: CountyCode;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  polygons: CountyPolygon[];
}

interface CountiesGeoJson {
  type: string;
  features: {
    properties: { code: string; name?: string };
    geometry:
      | { type: 'Polygon'; coordinates: number[][][] }
      | { type: 'MultiPolygon'; coordinates: number[][][][] };
  }[];
}

let shapes: CountyShape[] | null = null;

function ringBounds(ring: Ring, b: { minLng: number; minLat: number; maxLng: number; maxLat: number }): void {
  for (const [lng, lat] of ring) {
    if (lng < b.minLng) b.minLng = lng;
    if (lat < b.minLat) b.minLat = lat;
    if (lng > b.maxLng) b.maxLng = lng;
    if (lat > b.maxLat) b.maxLat = lat;
  }
}

function buildShapes(): CountyShape[] {
  if (shapes) return shapes;
  const geo = countiesRaw as unknown as CountiesGeoJson;
  const result: CountyShape[] = [];
  for (const f of geo.features) {
    const code = f.properties.code;
    if (!isCountyCode(code)) throw new Error(`縣市 GeoJSON 含未知 code：${code}`);

    const polygons: CountyPolygon[] = [];
    if (f.geometry.type === 'Polygon') {
      const rings = f.geometry.coordinates as unknown as Ring[];
      if (rings.length > 0) polygons.push({ outer: rings[0]!, holes: rings.slice(1) });
    } else {
      for (const poly of f.geometry.coordinates as unknown as Ring[][]) {
        if (poly.length > 0) polygons.push({ outer: poly[0]!, holes: poly.slice(1) });
      }
    }

    const b = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
    for (const p of polygons) ringBounds(p.outer, b);
    result.push({ code, ...b, polygons });
  }
  shapes = result;
  return result;
}

// 射線法：點是否在單一環內（座標皆 [lng, lat]）
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, poly: CountyPolygon): boolean {
  if (!pointInRing(lng, lat, poly.outer)) return false;
  for (const hole of poly.holes) {
    if (pointInRing(lng, lat, hole)) return false;
  }
  return true;
}

/** 判定座標點落在哪個縣市；不在任何縣市（外海等）回 null。 */
export function pointInCounty(point: { lat: number; lng: number }): CountyCode | null {
  const all = buildShapes();
  const { lat, lng } = point;
  for (const shape of all) {
    if (lng < shape.minLng || lng > shape.maxLng || lat < shape.minLat || lat > shape.maxLat) {
      continue;
    }
    for (const poly of shape.polygons) {
      if (pointInPolygon(lng, lat, poly)) return shape.code;
    }
  }
  return null;
}

/**
 * 偵測路線取樣點穿越的縣市，依首次出現順序去重回傳。
 * @param points 路線取樣點（建議為解碼後的 polyline 點，密度足以涵蓋每個經過縣市）
 */
export function detectCounties(points: ReadonlyArray<{ lat: number; lng: number }>): CountyCode[] {
  const visited: CountyCode[] = [];
  const seen = new Set<CountyCode>();
  for (const p of points) {
    const code = pointInCounty(p);
    if (code && !seen.has(code)) {
      seen.add(code);
      visited.push(code);
    }
  }
  return visited;
}

/** 索引中介資訊 — 供 route-metrics 回報 apiSourcesOk.counties。 */
export function getCountyIndexMeta(): { countyCount: number; loaded: boolean } {
  const all = buildShapes();
  return { countyCount: all.length, loaded: all.length > 0 };
}
