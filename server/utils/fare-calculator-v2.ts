// Fare V2 編排層 — 串接 route-metrics → fare-rules → calculateFareV2，含失敗降級。
//
//   成功：回 { version: 'v2', metrics, breakdown }
//   任一訊號 API 失敗：route-metrics 內部已降級（缺訊號歸 0），仍走 v2
//   Routes API 整個失敗：catch → 寫 line_api_errors → 退 v1 公式 → { version: 'v1', ... }
//   連 v1 的 Directions API 也失敗：throw（呼叫端回 422）
//
// Fare V2 — Phase 2.3 編排。
//
// 註：純計算（4 computers + calculateFareV2）置於 shared/pricing.ts 以便單元測試
// （pricing.spec.ts）；本檔僅負責 server 端 I/O 編排與降級。

import {
  calculateCharterFareV2,
  calculateFare,
  calculateFareV2,
  type CharterFareBreakdownV2,
  type CharterPlanKey,
  type FareBreakdownV2,
  type FleetExtra,
  type FleetVehicle,
  type OrderType,
  type RouteMetrics,
} from '~shared/pricing';
import { detectRoundTrip } from '~shared/geo/round-trip';
import { getRouteMetricsV2, getSimpleRoute, type SimpleRoute } from '@@/utils/route-metrics';
import { getFareRules } from '@@/utils/fare-rules-cache';
import { writeLineApiError } from '@@/utils/line-api-error-log';
import type { LatLng } from '@@/utils/polyline';

export interface GetRouteWithFareInput {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
  vehicle: Pick<FleetVehicle, 'baseFare' | 'perKmRate'>;
  extras: ReadonlyArray<Pick<FleetExtra, 'price'>>;
  /** 預約上車時間 — 用於 Routes API departureTime 與顛峰塞車費判定 */
  pickupTime: Date;
  /** 行程類型 — 用於時段規則的行程過濾；未帶則時段的行程過濾視為不符 */
  orderType?: OrderType | null;
  apiKey: string;
  /** 可選；寫入失敗 log 的 context */
  orderId?: string;
}

export interface FareResultV2 {
  version: 'v2';
  metrics: RouteMetrics;
  breakdown: FareBreakdownV2;
}

export interface FareResultV1 {
  version: 'v1';
  /** v1 降級時的基本路線（距離 / 車程 / polyline / bounds） */
  route: SimpleRoute;
  /** v1 公式車資 */
  final: number;
}

export type FareResult = FareResultV2 | FareResultV1;

export interface GetCharterRouteWithFareInput {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
  /** 完整 vehicle（需含 charterPlans），缺 plan → throw */
  vehicle: FleetVehicle;
  extras: ReadonlyArray<Pick<FleetExtra, 'price'>>;
  pickupTime: Date;
  /** 包車多日各天 plan key；length === days；用第一天 plan 為 includedKm / extraKmRate 基準 */
  planKeys: CharterPlanKey[];
  estimatedEndTime: Date;
  actualEndTime?: Date | null;
  apiKey: string;
  orderId?: string;
}

export interface CharterFareResult {
  version: 'charter';
  metrics: RouteMetrics;
  breakdown: CharterFareBreakdownV2;
  isRoundTrip: boolean;
}

/** 把 Fare V2 失敗寫進 line_api_errors，供 admin Diagnostics 觀察。永不 throw。 */
async function logFareV2Failure(err: unknown, orderId?: string): Promise<void> {
  await writeLineApiError({
    channel: 'unknown',
    api: 'fare-v2/route-metrics',
    method: 'POST',
    statusCode: 0,
    errorMessage: err instanceof Error ? err.message : String(err),
    errorDetails: err instanceof Error ? err.stack : undefined,
    context: { orderId: orderId ?? null },
  });
}

/**
 * 取得路線並計算車資。Routes API 正常 → v2 明細；失敗 → v1 降級；連 v1 也失敗 → throw。
 */
export async function getRouteWithFare(input: GetRouteWithFareInput): Promise<FareResult> {
  try {
    const metrics = await getRouteMetricsV2({
      origin: input.origin,
      destination: input.destination,
      waypoints: input.waypoints,
      departureTime: input.pickupTime,
      apiKey: input.apiKey,
    });
    const rules = await getFareRules();
    const breakdown = calculateFareV2(
      input.vehicle,
      metrics,
      input.pickupTime,
      input.extras,
      rules,
      input.orderType ?? null,
    );
    return { version: 'v2', metrics, breakdown };
  } catch (err) {
    // Routes API 失敗 → 記錄並降級 v1
    await logFareV2Failure(err, input.orderId);

    const route = await getSimpleRoute({
      origin: input.origin,
      destination: input.destination,
      waypoints: input.waypoints,
      apiKey: input.apiKey,
    });
    // v1 fallback 也套用 distanceTier + 起跳費 floor（與 v2 公式同源；rules 可能已在上方載入失敗，重抓一次）
    let v1Rules;
    try {
      v1Rules = await getFareRules();
    } catch {
      v1Rules = undefined; // 連 fare-rules 都載失敗 → calculateFare 內部用 DEFAULT_FARE_RULES
    }
    const final = calculateFare(input.vehicle, route.distanceKm, input.extras, v1Rules);
    return { version: 'v1', route, final };
  }
}

/**
 * Charter Fare V1：取路線（含 returnLeg） + 來回判定 + 包車計費。
 *
 * 任何失敗（charterPlans 缺 / Routes API 失敗 / engine throw）→ throw，
 * 呼叫端負責 fallback fare-v2（與 transfer 同行為）+ 寫 warning log。
 */
export async function getCharterRouteWithFare(
  input: GetCharterRouteWithFareInput,
): Promise<CharterFareResult> {
  if (!input.vehicle.charterPlans) {
    throw new Error('vehicle.charterPlans missing');
  }
  for (const k of input.planKeys) {
    if (!input.vehicle.charterPlans[k]) {
      throw new Error(`vehicle.charterPlans missing plan "${k}"`);
    }
  }

  const metrics = await getRouteMetricsV2({
    origin: input.origin,
    destination: input.destination,
    waypoints: input.waypoints,
    departureTime: input.pickupTime,
    apiKey: input.apiKey,
    fetchReturnLeg: true,
  });

  const rules = await getFareRules();
  const X = input.waypoints && input.waypoints.length > 0
    ? input.waypoints[input.waypoints.length - 1]!
    : null;
  const isRoundTrip = detectRoundTrip(
    input.origin,
    X,
    input.destination,
    metrics.returnLegPolyline ?? null,
    rules.charter,
  );

  const breakdown = calculateCharterFareV2(
    input.vehicle,
    input.planKeys,
    metrics,
    isRoundTrip,
    input.pickupTime,
    input.estimatedEndTime,
    input.actualEndTime ?? null,
    input.extras,
    rules,
  );

  return { version: 'charter', metrics, breakdown, isRoundTrip };
}
