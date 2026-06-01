// Admin fare-rules API methods（Fare V2 車資進階規則）
//
// 對齊 server/routes/nuxt-api/admin/fare-rules/index.{get,patch}.ts 的 FareRulesRes。
// FareRules 型別直接取自 ~shared/pricing（前後端共用，單一來源）。

import methods from '@/protocol/fetch-api/methods';
import type { FareRules, CharterPlanKey, OrderType, FareBreakdownV2, CharterFareBreakdownV2, RouteMetrics } from '~shared/pricing';

export type { FareRules } from '~shared/pricing';

export interface FareRulesDto {
  rules: FareRules;
  updatedBy: string | null;
  updatedAt: string | null;
  /** true = 顯示的是預設值（尚未存過 fare_rules/v1） */
  isDefault: boolean;
}

/** 取得目前車資進階規則（super only） */
export const GetAdminFareRules = () =>
  methods.get<FareRulesDto>('/nuxt-api/admin/fare-rules');

/** 全量更新車資進階規則（super only） */
export const PatchAdminFareRules = (rules: FareRules) =>
  methods.patch<FareRulesDto>(
    '/nuxt-api/admin/fare-rules',
    rules as unknown as Record<string, unknown>,
  );

// ── 計費沙盒 simulate（airport-calibration wave C） ───────────────────

export interface AdminFareSimulateBody {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  waypoints?: Array<{ lat: number; lng: number }>;
  vehicleId: string;
  pickupTime: string;
  orderType: OrderType;
  extraIds?: string[];
  /** charter 模式才用 */
  charterDays?: number;
  charterPlanKeys?: CharterPlanKey[];
  charterEstimatedEndTime?: string;
}

export interface AdminFareSimulateRes {
  strategy: 'fare-v2' | 'fare-v1' | 'charter';
  breakdown: FareBreakdownV2 | CharterFareBreakdownV2 | { final: number; distanceKm: number };
  metrics?: RouteMetrics;
  isRoundTrip?: boolean;
  hits: {
    mountain: { score: number; multiplier: number };
    crossCounty: { visited: string[]; crossings: number; fee: number };
    peak: { active: boolean; jamFee: number };
    promo: { active: boolean; discount: number };
    surcharge: { active: boolean; amount: number };
  };
}

/** 計費沙盒試算（canManageFleet only）— 走 prod fare-v2 編排 + 命中規則明細 */
export const PostAdminFareSimulate = (body: AdminFareSimulateBody) =>
  methods.post<AdminFareSimulateRes>(
    '/nuxt-api/admin/fare/simulate',
    body as unknown as Record<string, unknown>,
  );
