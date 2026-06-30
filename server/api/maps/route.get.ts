// GET /api/maps/route — 路線規劃 BFF（使用 Server Key）
//
// 兩種模式：
//   純幾何（未帶 vehicleType / pickupTime）：legacy Directions API，回 polyline / 距離 / 車程。
//     — booking step 2 路線規劃用，行為與 Fare V1 完全相同，零風險。
//   車資模式（帶 vehicleType + pickupTime）：Routes API v2 + 5 訊號 → Fare V2 明細。
//     — booking step 3 預估車資用。Routes API 失敗自動降級 v1（fareVersion='v1'）。
//
// in-memory LRU 快取：key 含 15 分鐘時間桶 + fare rules epoch，5 分鐘 TTL。
//
// Fare V2 — Phase 2.1 + 2.6。

import { LRUCache } from 'lru-cache';
import { boundsFromPolyline, type LatLng, type LatLngBounds } from '@@/utils/polyline';
import { getSimpleRoute, getRouteMetricsV2 } from '@@/utils/route-metrics';
import { getRouteWithFare } from '@@/utils/fare-calculator-v2';
import { getFareRules, getFareRulesEpoch } from '@@/utils/fare-rules-cache';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getFleetConfig } from '@@/utils/fleet-config';
import { detectRoundTrip } from '~shared/geo/round-trip';
import type { FareBreakdownV2, OrderType, RouteMetrics } from '~shared/pricing';

const VALID_ORDER_TYPES: ReadonlySet<string> = new Set([
  'airport-pickup',
  'airport-dropoff',
  'charter',
  'transfer',
]);

interface RouteRes {
  // 幾何（地圖繪製；向後相容舊欄位）
  polyline: string;
  bounds: LatLngBounds | null;
  distance_km: number;
  duration_minutes: number;
  // 車資（純幾何模式為 null）
  fareVersion: 'v1' | 'v2' | null;
  fareTotal: number | null;
  fareBreakdown: FareBreakdownV2 | null;
  routeMetrics: RouteMetrics | null;
  // 塞車（車資模式 v2）
  static_duration_minutes: number | null;
  pure_jam_minutes: number | null;
  // Charter Fare V1：orderType=charter + 有 stopover 時才有值；其他情況皆 null
  isRoundTrip: boolean | null;
  returnLegPolyline: string | null;
}

// TTL 30s 跟 fare-rules-cache 對齊 — 否則 admin 改規則後 estimator/booking 端的
// LRU cache 最多殘留 5 min 才失效，造成「sandbox 算新規則 / estimator 拿舊 cache」的差異。
// 視窗 3 hotfix（2026-06-07）：原 5 min 過長。
const routeCache = new LRUCache<string, RouteRes>({
  max: 500,
  ttl: 30 * 1000,
});

function parseLatLng(raw: string | undefined): LatLng | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parseWaypoints(raw: string | undefined): LatLng[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((w) => parseLatLng(w))
    .filter((p): p is LatLng => p !== null);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, string | undefined>;
  const origin = parseLatLng(query.origin);
  const destination = parseLatLng(query.destination);

  if (!origin || !destination) {
    return {
      data: null,
      status: { code: 400, message: { zh_tw: '缺少起點或終點', en: 'Missing origin/destination', ja: '出発地または目的地が不足' } },
    };
  }

  const waypoints = parseWaypoints(query.waypoints);
  const { googleMapsApiKey, firebaseServiceAccountJson } = useRuntimeConfig();

  // 車資模式判定：需同時帶 vehicleType + 有效 pickupTime
  const vehicleType = query.vehicleType?.trim() || '';
  const pickupTimeRaw = query.pickupTime?.trim() || '';
  const pickupTime = pickupTimeRaw ? new Date(pickupTimeRaw) : null;
  const fareMode = Boolean(vehicleType) && pickupTime !== null && !Number.isNaN(pickupTime.getTime());
  const extraIds = (query.extras?.trim() || '').split(',').map((s) => s.trim()).filter(Boolean);
  // 行程類型 — 用於時段規則的行程過濾；無效 / 未帶 → null
  const orderTypeRaw = query.orderType?.trim() || '';
  const orderType: OrderType | null = VALID_ORDER_TYPES.has(orderTypeRaw)
    ? (orderTypeRaw as OrderType)
    : null;

  // LRU 快取 key
  const minuteBucket = pickupTime ? Math.floor(pickupTime.getTime() / (15 * 60 * 1000)) : 0;
  const cacheKey = [
    fareMode ? 'fare' : 'geo',
    query.origin,
    query.destination,
    query.waypoints ?? '',
    vehicleType,
    extraIds.join(','),
    orderType ?? '',
    minuteBucket,
    getFareRulesEpoch(),
  ].join('|');

  const cached = routeCache.get(cacheKey);
  if (cached) return { data: cached, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };

  // ── 純幾何模式 ─────────────────────────────────────────────────────────────
  if (!fareMode) {
    // Charter Fare V1（2026-06-30 修）：orderType=charter 走完整 RouteMetrics（含 elevation/OSM/counties），
    // 讓 client 端 calculateCharterFareV2 拿到真實山區訊號 — 與接送機 fareMode 一致，
    // 修掉「booking 預估山區=1.0、扣款時 server 重算 ×1.4~1.6 跳價」的 UX 地雷。
    if (orderType === 'charter') {
      try {
        const rules = await getFareRules();
        const m = await getRouteMetricsV2({
          origin,
          destination,
          waypoints,
          apiKey: googleMapsApiKey,
          fetchReturnLeg: waypoints.length > 0,
          highwayPatterns: rules.surfaceSurcharge.highwayPatterns,
        });
        const returnLegPolyline = m.returnLegPolyline ?? null;
        const X = waypoints.length > 0 ? waypoints[waypoints.length - 1]! : null;
        const isRoundTrip = X
          ? detectRoundTrip(origin, X, destination, returnLegPolyline, rules.charter)
          : null;
        const data: RouteRes = {
          polyline: m.polylineEncoded,
          bounds: boundsFromPolyline(m.polylineEncoded),
          distance_km: round1(m.distanceKm),
          duration_minutes: Math.round(m.durationSec / 60),
          fareVersion: null,
          fareTotal: null,
          fareBreakdown: null,
          routeMetrics: m,
          static_duration_minutes: Math.round(m.staticDurationSec / 60),
          pure_jam_minutes: Math.round(m.pureJamMinutes),
          isRoundTrip,
          returnLegPolyline,
        };
        routeCache.set(cacheKey, data);
        return { data, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
      } catch (err) {
        console.error('[maps/route] charter metrics mode failed, falling back to simple route:', err);
        // 降級到 simple route：山區訊號退回缺省（client 仍會算出基本價，較舊行為無差）
      }
    }

    try {
      const route = await getSimpleRoute({ origin, destination, waypoints, apiKey: googleMapsApiKey });

      // 非 charter / charter 完整 metrics 失敗降級：保留舊純幾何邏輯。
      let isRoundTrip: boolean | null = null;
      let returnLegPolyline: string | null = null;
      if (orderType === 'charter' && waypoints.length > 0) {
        try {
          const X = waypoints[waypoints.length - 1]!;
          const back = await getSimpleRoute({ origin: X, destination: origin, apiKey: googleMapsApiKey });
          returnLegPolyline = back.polylineEncoded || null;
          const rules = await getFareRules();
          isRoundTrip = detectRoundTrip(origin, X, destination, returnLegPolyline, rules.charter);
        } catch (err) {
          console.error('[maps/route] charter return-leg fetch failed:', err);
          isRoundTrip = false;
        }
      }

      const data: RouteRes = {
        polyline: route.polylineEncoded,
        bounds: route.bounds,
        distance_km: route.distanceKm,
        duration_minutes: route.durationMinutes,
        fareVersion: null,
        fareTotal: null,
        fareBreakdown: null,
        routeMetrics: null,
        static_duration_minutes: null,
        pure_jam_minutes: null,
        isRoundTrip,
        returnLegPolyline,
      };
      routeCache.set(cacheKey, data);
      return { data, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
    } catch (err) {
      console.error('[maps/route] geometry mode failed:', err);
      return {
        data: null,
        status: { code: 422, message: { zh_tw: '路線計算失敗', en: 'Route calculation failed', ja: 'ルート計算に失敗しました' } },
      };
    }
  }

  // ── 車資模式 ───────────────────────────────────────────────────────────────
  if (!firebaseServiceAccountJson) {
    return { data: null, status: { code: 500, message: { zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' } } };
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const fleet = await getFleetConfig(db);
    const vehicle = fleet.vehicles.find((v) => v.id === vehicleType);
    if (!vehicle) {
      return { data: null, status: { code: 400, message: { zh_tw: '車型不存在', en: 'Unknown vehicle type', ja: '車種が存在しません' } } };
    }
    const extras = extraIds
      .map((id) => fleet.extras.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map((e) => ({ price: e.price }));

    const result = await getRouteWithFare({
      origin,
      destination,
      waypoints,
      // 視窗 3 hotfix（2026-06-07）：原 inline pick { baseFare, perKmRate } 漏 forward
      // vehicle.surfaceRatePerKm；若某車型在 firestore 設了 surfaceRatePerKm override
      // estimator/booking 端會用全域 default rate，sandbox 用 vehicle override → 兩端不一致。
      vehicle: {
        baseFare: vehicle.baseFare,
        perKmRate: vehicle.perKmRate,
        surfaceRatePerKm: vehicle.surfaceRatePerKm,
      },
      extras,
      pickupTime: pickupTime as Date,
      orderType,
      apiKey: googleMapsApiKey,
    });

    let data: RouteRes;
    if (result.version === 'v2') {
      const m = result.metrics;
      data = {
        polyline: m.polylineEncoded,
        bounds: boundsFromPolyline(m.polylineEncoded),
        distance_km: round1(m.distanceKm),
        duration_minutes: Math.round(m.durationSec / 60),
        fareVersion: 'v2',
        fareTotal: result.breakdown.final,
        fareBreakdown: result.breakdown,
        routeMetrics: m,
        static_duration_minutes: Math.round(m.staticDurationSec / 60),
        pure_jam_minutes: Math.round(m.pureJamMinutes),
        isRoundTrip: null,
        returnLegPolyline: null,
      };
    } else {
      // v1 降級：只有基本路線 + 簡化車資
      data = {
        polyline: result.route.polylineEncoded,
        bounds: result.route.bounds,
        distance_km: result.route.distanceKm,
        duration_minutes: result.route.durationMinutes,
        fareVersion: 'v1',
        fareTotal: result.final,
        fareBreakdown: null,
        routeMetrics: null,
        static_duration_minutes: null,
        pure_jam_minutes: null,
        isRoundTrip: null,
        returnLegPolyline: null,
      };
    }

    routeCache.set(cacheKey, data);
    return { data, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
  } catch (err) {
    console.error('[maps/route] fare mode failed:', err);
    return {
      data: null,
      status: { code: 422, message: { zh_tw: '路線計算失敗', en: 'Route calculation failed', ja: 'ルート計算に失敗しました' } },
    };
  }
});
