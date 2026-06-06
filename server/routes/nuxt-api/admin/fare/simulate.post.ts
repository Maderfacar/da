/**
 * POST /nuxt-api/admin/fare/simulate
 *
 * 計費沙盒 — admin 試算機，直接走 prod fare-v2 編排（getRouteWithFare）+ 額外暴露命中規則明細。
 *
 * Body:
 *   {
 *     origin:        { lat, lng },           // 上車點
 *     destination:   { lat, lng },           // 下車點
 *     waypoints?:    [{ lat, lng }],         // 中停（optional）
 *     vehicleId:     string,                 // fleet_vehicles doc id
 *     pickupTime:    string (ISO),           // 上車時間
 *     orderType:     'airport-pickup' | 'airport-dropoff' | 'transfer' | 'charter',
 *     extraIds?:     string[],               // fleet_extras doc id
 *   }
 *
 * 權限：canManageFleet
 *
 * 回傳：
 *   {
 *     strategy: 'fare-v2' | 'fare-v1' | 'charter',
 *     breakdown: FareBreakdownV2 | CharterFareBreakdownV2 | { final, distanceKm },
 *     metrics?: RouteMetrics,                // v2 / charter 才有
 *     hits: {                                // 命中規則明細
 *       mountain:    { score, multiplier },
 *       crossCounty: { visited, crossings, fee },
 *       surface:     { highwayKm, surfaceKm, surchargeAmount },
 *       promo:       { active, discount },
 *       surcharge:   { active, amount },
 *     },
 *   }
 *
 * 視窗 1 改動：移除 hits.peak（顛峰塞車費砍除），新增 hits.surface（平面道路加成）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  successResponse,
  badRequestError,
  forbiddenError,
  serverError,
} from '@@/utils/response';
import { getRouteWithFare, getCharterRouteWithFare } from '@@/utils/fare-calculator-v2';
import { getFleetConfig } from '@@/utils/fleet-config';
import { getFareRules } from '@@/utils/fare-rules-cache';
import {
  calculateSurfaceSurcharge,
  computeCrossCountyFee,
  computePromoDiscount,
  computeSurcharge,
  computeMountainMul,
  type OrderType,
  type CharterPlanKey,
} from '~shared/pricing';
import type { LatLng } from '@@/utils/polyline';

interface SimulateBody {
  origin?: unknown;
  destination?: unknown;
  waypoints?: unknown;
  vehicleId?: unknown;
  pickupTime?: unknown;
  orderType?: unknown;
  extraIds?: unknown;
  /** charter 模式才用 — 天數 + 每日 plan key */
  charterDays?: unknown;
  charterPlanKeys?: unknown;
  charterEstimatedEndTime?: unknown;
}

const VALID_ORDER_TYPES: ReadonlySet<string> = new Set(['airport-pickup', 'airport-dropoff', 'transfer', 'charter']);

function _parseLatLng(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { lat?: unknown; lng?: unknown };
  if (typeof obj.lat !== 'number' || typeof obj.lng !== 'number') return null;
  if (!Number.isFinite(obj.lat) || !Number.isFinite(obj.lng)) return null;
  return { lat: obj.lat, lng: obj.lng };
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({
      zh_tw: '需要車隊管理權限',
      en: 'canManageFleet required',
      ja: 'フリート管理権限が必要です',
    });
  }

  const { googleMapsApiKey, firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }
  if (!googleMapsApiKey) {
    return serverError({
      zh_tw: 'Google Maps API key 未設定',
      en: 'Google Maps API key not configured',
      ja: 'Google Maps API キー未設定',
    });
  }
  const mapsKey = googleMapsApiKey;

  const body = await readBody<SimulateBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid body', ja: 'リクエスト形式が不正です' });
  }

  const origin = _parseLatLng(body.origin);
  const destination = _parseLatLng(body.destination);
  if (!origin || !destination) {
    return badRequestError({
      zh_tw: 'origin / destination 必須是 { lat, lng } 數值物件',
      en: 'origin / destination must be { lat, lng } number objects',
      ja: 'origin / destination は { lat, lng } の数値オブジェクトが必要です',
    });
  }

  const waypointsRaw = Array.isArray(body.waypoints) ? body.waypoints : [];
  const waypoints: LatLng[] = [];
  for (const w of waypointsRaw) {
    const p = _parseLatLng(w);
    if (!p) {
      return badRequestError({
        zh_tw: 'waypoints 內每個 stopover 必須是 { lat, lng }',
        en: 'Every waypoint must be { lat, lng }',
        ja: 'waypoints 内の各要素は { lat, lng } が必要です',
      });
    }
    waypoints.push(p);
  }

  if (typeof body.vehicleId !== 'string' || !body.vehicleId.trim()) {
    return badRequestError({ zh_tw: 'vehicleId 必填', en: 'vehicleId required', ja: 'vehicleId は必須です' });
  }
  if (typeof body.pickupTime !== 'string') {
    return badRequestError({ zh_tw: 'pickupTime 必填 (ISO 字串)', en: 'pickupTime required', ja: 'pickupTime は必須です' });
  }
  const pickupTime = new Date(body.pickupTime);
  if (Number.isNaN(pickupTime.getTime())) {
    return badRequestError({
      zh_tw: 'pickupTime 必須是合法 ISO 字串',
      en: 'pickupTime must be a valid ISO string',
      ja: 'pickupTime は有効な ISO 文字列が必要です',
    });
  }
  if (typeof body.orderType !== 'string' || !VALID_ORDER_TYPES.has(body.orderType)) {
    return badRequestError({
      zh_tw: 'orderType 必須是 airport-pickup / airport-dropoff / transfer / charter',
      en: 'orderType must be airport-pickup / airport-dropoff / transfer / charter',
      ja: 'orderType は airport-pickup / airport-dropoff / transfer / charter のいずれか',
    });
  }
  const orderType = body.orderType as OrderType;

  const extraIds = Array.isArray(body.extraIds)
    ? body.extraIds.filter((s): s is string => typeof s === 'string')
    : [];

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const [fleet, rules] = await Promise.all([getFleetConfig(db), getFareRules()]);

    const vehicle = fleet.vehicles.find((v) => v.id === body.vehicleId);
    if (!vehicle) {
      return badRequestError({
        zh_tw: `找不到車型 ${String(body.vehicleId)}`,
        en: `Vehicle "${String(body.vehicleId)}" not found`,
        ja: `車種 ${String(body.vehicleId)} が見つかりません`,
      });
    }
    const extras = extraIds
      .map((id) => fleet.extras.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => !!e);

    // ─── Charter 走獨立編排 ───────────────────────────────────────
    if (orderType === 'charter') {
      const charterDays = typeof body.charterDays === 'number' ? body.charterDays : 1;
      const planKeysRaw = Array.isArray(body.charterPlanKeys) ? body.charterPlanKeys : [];
      const planKeys = planKeysRaw.filter((k): k is CharterPlanKey =>
        k === '4h' || k === '8h' || k === '10h',
      );
      if (planKeys.length !== charterDays || planKeys.length === 0) {
        return badRequestError({
          zh_tw: 'charterPlanKeys 長度必須等於 charterDays，且至少 1 個',
          en: 'charterPlanKeys length must match charterDays and be at least 1',
          ja: 'charterPlanKeys は charterDays と同数（1 以上）が必要です',
        });
      }
      const estEnd = typeof body.charterEstimatedEndTime === 'string'
        ? new Date(body.charterEstimatedEndTime)
        : new Date(pickupTime.getTime() + planKeys.length * 4 * 3600 * 1000);

      try {
        const result = await getCharterRouteWithFare({
          origin,
          destination,
          waypoints: waypoints.length ? waypoints : undefined,
          vehicle,
          extras,
          pickupTime,
          planKeys,
          estimatedEndTime: estEnd,
          apiKey: mapsKey,
        });
        return successResponse({
          strategy: 'charter',
          breakdown: result.breakdown,
          metrics: result.metrics,
          isRoundTrip: result.isRoundTrip,
          hits: {
            mountain: {
              score: 0,
              multiplier: result.breakdown.mountainMul,
            },
            crossCounty: { visited: result.metrics.countiesVisited, crossings: 0, fee: 0 },
            surface: {
              highwayKm: result.metrics.highwayKm,
              surfaceKm: result.metrics.surfaceKm,
              surchargeAmount: 0,
              breakdown: result.metrics.segmentsBreakdown ?? [],
            },
            promo: { active: result.breakdown.promoDiscount > 0, discount: result.breakdown.promoDiscount },
            surcharge: { active: result.breakdown.surcharge > 0, amount: result.breakdown.surcharge },
          },
        });
      } catch (err) {
        return serverError({
          zh_tw: `Charter 試算失敗：${err instanceof Error ? err.message : '未知錯誤'}`,
          en: `Charter simulate failed: ${err instanceof Error ? err.message : 'unknown'}`,
          ja: `Charter シミュレーション失敗：${err instanceof Error ? err.message : '不明'}`,
        });
      }
    }

    // ─── Fare V2 / V1 編排 ───────────────────────────────────────
    const result = await getRouteWithFare({
      origin,
      destination,
      waypoints: waypoints.length ? waypoints : undefined,
      vehicle,
      extras,
      pickupTime,
      orderType,
      apiKey: mapsKey,
    });

    if (result.version === 'v1') {
      // Routes API 失敗降級 — 純 distance × perKmRate
      return successResponse({
        strategy: 'fare-v1',
        breakdown: { final: result.final, distanceKm: result.route.distanceKm },
        hits: {
          mountain: { score: 0, multiplier: 1 },
          crossCounty: { visited: [], crossings: 0, fee: 0 },
          surface: { highwayKm: 0, surfaceKm: 0, surchargeAmount: 0 },
          promo: { active: false, discount: 0 },
          surcharge: { active: false, amount: 0 },
        },
      });
    }

    // V2 — 重算各 hits（純函式，輕量）
    const { metrics, breakdown } = result;
    const crossFee = computeCrossCountyFee(metrics.countiesVisited, rules.crossCounty);
    const promo = computePromoDiscount(pickupTime, rules.promo, orderType);
    const surcharge = computeSurcharge(pickupTime, rules.surcharge, orderType);
    const mountainMul = computeMountainMul(metrics, rules.mountain);
    const surfaceAmount = calculateSurfaceSurcharge(
      metrics.highwayKm,
      metrics.surfaceKm,
      metrics.distanceKm,
      rules.surfaceSurcharge,
      vehicle.surfaceRatePerKm,
    );
    // 三訊號分數（重新算一次以便 UI 顯示）
    let mountainScore = 0;
    if (metrics.apiSourcesOk.elevation && metrics.elevationDiffM >= rules.mountain.thresholdElevationDiffM) mountainScore++;
    if (metrics.sinuosity >= rules.mountain.thresholdSinuosity) mountainScore++;
    if (metrics.apiSourcesOk.routes && metrics.freeFlowKmh <= rules.mountain.thresholdFreeFlowKmh) mountainScore++;

    return successResponse({
      strategy: 'fare-v2',
      breakdown,
      metrics,
      hits: {
        mountain: { score: mountainScore, multiplier: mountainMul },
        crossCounty: {
          visited: metrics.countiesVisited,
          crossings: Math.max(0, metrics.countiesVisited.length - 1),
          fee: crossFee,
        },
        surface: {
          highwayKm: metrics.highwayKm,
          surfaceKm: metrics.surfaceKm,
          surchargeAmount: surfaceAmount,
          // 視窗 2：每段 step 明細（route-metrics.ts 直接帶回；舊路徑 / Routes API 失敗時為空陣列）
          breakdown: metrics.segmentsBreakdown ?? [],
        },
        promo: { active: promo > 0, discount: promo },
        surcharge: { active: surcharge > 0, amount: surcharge },
      },
    });
  } catch (err) {
    console.error('[admin/fare/simulate] failed:', err);
    return serverError({
      zh_tw: `試算失敗：${err instanceof Error ? err.message : '未知錯誤'}`,
      en: `Simulate failed: ${err instanceof Error ? err.message : 'unknown'}`,
      ja: `シミュレーション失敗：${err instanceof Error ? err.message : '不明'}`,
    });
  }
});
