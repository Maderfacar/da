// Route Metrics V2 — 取 Fare V2 所需 5 個路線訊號。
//
//   Routes API v2  → distanceKm / staticDuration / duration / polyline
//   Elevation API  → 海拔起伏（沿 polyline 每 1km 取樣）
//   OSM 索引       → 國道里程 freewayKm / hasTrunk
//   縣市 GeoJSON   → 穿越縣市 countiesVisited
//   server 端      → 曲折度 sinuosity = routeDistanceKm / haversine(origin,dest)
//
// Routes API 失敗 → throw RouteMetricsError（呼叫方降級 v1）。
// Elevation / OSM / 縣市 任一失敗 → 該訊號歸 0 並標記 apiSourcesOk 對應 false，
// v2 仍可算（缺訊號只會少加成，不會錯收）。
//
// Fare V2 — Phase 2.2。

import type { RouteMetrics } from '~shared/pricing';
import { decodePolyline, haversineKm, samplePointsByDistanceKm, type LatLng } from '@@/utils/polyline';
import { nearestRoadClass } from '@@/utils/osm-roads-index';
import { detectCounties } from '@@/utils/county-detect';

export class RouteMetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteMetricsError';
  }
}

export interface RouteMetricsInput {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
  /** 預約上車時間；未來時間才送 Routes API departureTime（過去時間 API 會拒絕） */
  departureTime?: Date;
  apiKey: string;
}

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ELEVATION_ENDPOINT = 'https://maps.googleapis.com/maps/api/elevation/json';
const DIRECTIONS_ENDPOINT = 'https://maps.googleapis.com/maps/api/directions/json';

// 寬限的 timeout：太短會造成非必要的 v1 降級（user 看到「簡化計費」比多等 2 秒差）。
// design.md 建議 3s，此處放寬至 Routes 8s / Elevation 5s。
const ROUTES_TIMEOUT_MS = 8000;
const ELEVATION_TIMEOUT_MS = 5000;

// Elevation 取樣：每 1km 一點，單請求上限 100 點（控制 URL 長度與成本）
const ELEVATION_SAMPLE_INTERVAL_KM = 1;
const ELEVATION_MAX_POINTS = 100;

// OSM 道路層級判定容差
const OSM_TOLERANCE_M = 20;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface RoutesV2Response {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    staticDuration?: string;
    polyline?: { encodedPolyline?: string };
  }>;
}

function toWaypoint(p: LatLng) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

async function callRoutesV2(input: RouteMetricsInput): Promise<{
  distanceKm: number;
  staticDurationSec: number;
  durationSec: number;
  polylineEncoded: string;
}> {
  const body: Record<string, unknown> = {
    origin: toWaypoint(input.origin),
    destination: toWaypoint(input.destination),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    regionCode: 'TW',
    languageCode: 'zh-TW',
  };
  if (input.waypoints && input.waypoints.length > 0) {
    body.intermediates = input.waypoints.map(toWaypoint);
  }
  // departureTime 必須是現在或未來；過去時間 API 會 400
  if (input.departureTime && input.departureTime.getTime() > Date.now()) {
    body.departureTime = input.departureTime.toISOString();
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      ROUTES_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': input.apiKey,
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify(body),
      },
      ROUTES_TIMEOUT_MS,
    );
  } catch (err) {
    throw new RouteMetricsError(`Routes API 連線失敗：${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new RouteMetricsError(`Routes API HTTP ${res.status}`);
  }

  const json = (await res.json()) as RoutesV2Response;
  const route = json.routes?.[0];
  if (!route || typeof route.distanceMeters !== 'number' || !route.polyline?.encodedPolyline) {
    throw new RouteMetricsError('Routes API 回應缺少必要欄位');
  }

  return {
    distanceKm: route.distanceMeters / 1000,
    staticDurationSec: parseFloat(route.staticDuration ?? route.duration ?? '0'),
    durationSec: parseFloat(route.duration ?? route.staticDuration ?? '0'),
    polylineEncoded: route.polyline.encodedPolyline,
  };
}

interface ElevationResponse {
  status?: string;
  results?: Array<{ elevation?: number }>;
}

/** 沿 polyline 取海拔起伏（max − min）。失敗回 null。 */
async function fetchElevationDiff(points: ReadonlyArray<LatLng>, apiKey: string): Promise<number | null> {
  const sampled = samplePointsByDistanceKm(points, ELEVATION_SAMPLE_INTERVAL_KM, ELEVATION_MAX_POINTS);
  if (sampled.length < 2) return null;
  const locations = sampled.map((p) => `${p.lat},${p.lng}`).join('|');
  const url = `${ELEVATION_ENDPOINT}?locations=${encodeURIComponent(locations)}&key=${apiKey}`;
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, ELEVATION_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = (await res.json()) as ElevationResponse;
    if (json.status !== 'OK' || !Array.isArray(json.results) || json.results.length === 0) return null;
    const elevations = json.results
      .map((r) => r.elevation)
      .filter((e): e is number => typeof e === 'number');
    if (elevations.length < 2) return null;
    return Math.max(...elevations) - Math.min(...elevations);
  } catch {
    return null;
  }
}

/** 用 OSM 索引判定 polyline 上的國道里程與是否走快速道路。 */
function classifyRoute(points: ReadonlyArray<LatLng>): { freewayKm: number; hasTrunk: boolean } {
  let freewayKm = 0;
  let hasTrunk = false;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i]!;
    const cls = nearestRoadClass(curr, OSM_TOLERANCE_M);
    if (cls === 'motorway') {
      freewayKm += haversineKm(curr, points[i + 1]!);
    } else if (cls === 'trunk') {
      hasTrunk = true;
    }
  }
  return { freewayKm, hasTrunk };
}

/**
 * 取得完整 RouteMetrics。Routes API 失敗即 throw RouteMetricsError；
 * Elevation / OSM / 縣市 失敗則該訊號降級（apiSourcesOk 對應 false）。
 */
export async function getRouteMetricsV2(input: RouteMetricsInput): Promise<RouteMetrics> {
  // 1. Routes API v2（關鍵路徑，失敗即 throw）
  const route = await callRoutesV2(input);
  const points = decodePolyline(route.polylineEncoded);

  // 2. 並行 / 容錯：Elevation（網路）+ OSM + 縣市（in-memory）
  const elevationPromise = fetchElevationDiff(points, input.apiKey);

  let freewayKm = 0;
  let hasTrunk = false;
  let osmOk = true;
  try {
    const cls = classifyRoute(points);
    freewayKm = cls.freewayKm;
    hasTrunk = cls.hasTrunk;
  } catch (err) {
    osmOk = false;
    console.error('[route-metrics] OSM classify failed:', err);
  }

  let countiesVisited: string[] = [];
  let countiesOk = true;
  try {
    countiesVisited = detectCounties(points);
  } catch (err) {
    countiesOk = false;
    console.error('[route-metrics] county detect failed:', err);
  }

  const elevationDiff = await elevationPromise;
  const elevationOk = elevationDiff !== null;

  // 3. server 端計算：曲折度
  const straightLineKm = haversineKm(input.origin, input.destination);
  const sinuosity = straightLineKm > 0.1 ? route.distanceKm / straightLineKm : 1;

  // 4. 塞車訊號
  const pureJamMinutes = Math.max(0, (route.durationSec - route.staticDurationSec) / 60);
  const freeFlowKmh =
    route.staticDurationSec > 0 ? route.distanceKm / (route.staticDurationSec / 3600) : 0;

  return {
    distanceKm: route.distanceKm,
    staticDurationSec: route.staticDurationSec,
    durationSec: route.durationSec,
    pureJamMinutes,
    freeFlowKmh,
    polylineEncoded: route.polylineEncoded,
    elevationDiffM: elevationDiff ?? 0,
    freewayKm,
    hasTrunk,
    countiesVisited,
    straightLineKm,
    sinuosity,
    computedAt: Date.now(),
    apiSourcesOk: { routes: true, elevation: elevationOk, osm: osmOk, counties: countiesOk },
  };
}

interface DirectionsBounds {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
}

interface DirectionsResponse {
  status?: string;
  routes?: Array<{
    overview_polyline?: { points?: string };
    bounds?: DirectionsBounds;
    legs?: Array<{ distance?: { value?: number }; duration?: { value?: number } }>;
  }>;
}

export interface SimpleRoute {
  distanceKm: number;
  durationMinutes: number;
  polylineEncoded: string;
  bounds: DirectionsBounds | null;
}

/**
 * 以 legacy Directions API 取基本路線（距離 / 車程 / polyline / bounds）。
 * 用於：（1）/api/maps/route 純幾何模式；（2）getRouteMetricsV2 失敗時的 v1 降級。
 * 失敗即 throw RouteMetricsError。
 */
export async function getSimpleRoute(input: {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
  apiKey: string;
}): Promise<SimpleRoute> {
  const params = new URLSearchParams({
    origin: `${input.origin.lat},${input.origin.lng}`,
    destination: `${input.destination.lat},${input.destination.lng}`,
    key: input.apiKey,
    region: 'TW',
    language: 'zh-TW',
  });
  if (input.waypoints && input.waypoints.length > 0) {
    params.append('waypoints', input.waypoints.map((w) => `via:${w.lat},${w.lng}`).join('|'));
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${DIRECTIONS_ENDPOINT}?${params}`, { method: 'GET' }, ROUTES_TIMEOUT_MS);
  } catch (err) {
    throw new RouteMetricsError(`Directions API 連線失敗：${(err as Error).message}`);
  }
  if (!res.ok) throw new RouteMetricsError(`Directions API HTTP ${res.status}`);

  const json = (await res.json()) as DirectionsResponse;
  const route = json.routes?.[0];
  const legs = route?.legs;
  if (json.status !== 'OK' || !route || !Array.isArray(legs) || legs.length === 0) {
    throw new RouteMetricsError(`Directions API 回應無路線（status=${json.status}）`);
  }
  const totalMeters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
  const totalSeconds = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
  return {
    distanceKm: Math.round(totalMeters / 100) / 10,
    durationMinutes: Math.round(totalSeconds / 60),
    polylineEncoded: route.overview_polyline?.points ?? '',
    bounds: route.bounds ?? null,
  };
}
