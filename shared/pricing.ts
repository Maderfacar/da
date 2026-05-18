// 車種與計價設定（前後端共用）
//
// P23 後：VEHICLE_CONFIGS / EXTRA_SERVICES / EXTRA_SERVICE_PRICE 全部移到 Firestore
// （fleet_vehicles / fleet_luggage_types / fleet_extras 三個 collection）。
// client 透過 StoreConfig() Pinia store 載入，server 透過 server/utils/fleet-config.ts 載入。
//
// 本檔僅保留：
//   - 型別定義（FleetVehicle / FleetLuggageType / FleetExtra / I18nLabel）
//   - 行程類型固定枚舉（ORDER_TYPES）— 屬產品邏輯非計價設定，沒動到的必要
//   - calculateFare 算法（接 vehicle 物件 + extras 物件陣列）
//   - Fare V2：型別 + 4 運算模組 + calculateFareV2 + DEFAULT_FARE_RULES

import { TPE_METRO_CODES } from './geo/county-codes';

// VehicleType 在 P23 前是 union literal，現改為 string —— admin 可任意新增車型，
// callers（store-order draft、CreateOrderParams、Firestore orders.vehicleType）皆持有 doc id 字串。
export type VehicleType = string;

export type OrderType = 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';

export interface I18nLabel {
  zh: string;
  en: string;
  ja: string;
}

export interface FleetVehicle {
  id: string;
  label: I18nLabel;
  capacity: number;
  luggageSU: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

export interface FleetLuggageType {
  id: string;
  label: I18nLabel;
  su: number;
  sortOrder: number;
}

export interface FleetExtra {
  id: string;
  label: I18nLabel;
  price: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

export const ORDER_TYPES: Array<{ value: OrderType; label: string; labelEn: string; icon: string }> = [
  { value: 'airport-pickup',  label: '接機',   labelEn: 'AIRPORT PICKUP',  icon: 'mdi:airplane-landing' },
  { value: 'airport-dropoff', label: '送機',   labelEn: 'AIRPORT DROPOFF', icon: 'mdi:airplane-takeoff' },
  { value: 'charter',         label: '包車',   labelEn: 'CHARTER',         icon: 'mdi:car-clock' },
  { value: 'transfer',        label: '交通接送', labelEn: 'TRANSFER',       icon: 'mdi:map-marker-path' },
];

/**
 * 計算預估車資（無條件進位至最近 50 元）
 *
 * P23：簽名改為接 vehicle 物件 + extras 物件陣列，前後端皆需先撈 Firestore fleet config
 * 才能呼叫（client 走 StoreConfig，server 走 fleet-config util）。
 */
export const calculateFare = (
  vehicle: Pick<FleetVehicle, 'baseFare' | 'perKmRate'>,
  distanceKm: number,
  extras: ReadonlyArray<Pick<FleetExtra, 'price'>>,
): number => {
  const base = vehicle.baseFare + distanceKm * vehicle.perKmRate;
  const extrasSum = extras.reduce((sum, e) => sum + e.price, 0);
  return Math.ceil((base + extrasSum) / 50) * 50;
};

// =============================================================================
// Fare V2 — 偏遠山區係數 + 跨縣市補貼 + 顛峰塞車 + 國道通行費
//
// 公式骨架（hardcode，不可改）：
//   raw   = baseFare
//         + (distanceKm × perKmRate + jamFee) × mountainMultiplier
//         + crossCountyFee + freewayToll + Σ extras
//   final = ⌈ raw / rounding ⌉ × rounding
//
// 關鍵：起跳費與加值服務「不」被山區係數乘；跨縣市/國道加在最後；進位只執行一次。
// 詳見 openspec/changes/2026-05-16-fare-v2/design.md。
// =============================================================================

// ── 可調規則型別（對應 Firestore fare_rules/v1）─────────────────────────────

export interface MountainTier {
  /** 達此分數即套用 multiplier */
  minScore: number;
  multiplier: number;
}

export interface MountainRule {
  enabled: boolean;
  /** 海拔起伏門檻（m）；達標 +1 分 */
  thresholdElevationDiffM: number;
  /** 曲折度門檻；達標 +1 分 */
  thresholdSinuosity: number;
  /** 無塞車時速門檻（km/h）；低於即達標 +1 分 */
  thresholdFreeFlowKmh: number;
  tiers: MountainTier[];
}

export interface CrossCountyRule {
  enabled: boolean;
  /** 第 1 / 2 / 3+ 跨費率（NTD）；超過陣列長度沿用最後一級 */
  tieredNtd: number[];
  /** 所有訪問縣市皆在北北桃內則不收 */
  excludeTpeNtpeTyn: boolean;
}

export type WeekendJamMode = 'OFF' | 'ALL_DAY' | 'EVENING_ONLY';

export type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

export interface PeakWindow {
  days: Weekday[];
  /** 'HH:MM' 24 小時制（台北時區） */
  start: string;
  end: string;
  /** 該時段專屬費率；未設則用 defaultNtdPerMinute */
  ntdPerMinute?: number;
}

export interface TrafficJamRule {
  enabled: boolean;
  peakWindows: PeakWindow[];
  weekendMode: WeekendJamMode;
  defaultNtdPerMinute: number;
}

export interface PromoWindow {
  days: Weekday[];
  /** 'HH:MM' 24 小時制（台北時區） */
  start: string;
  end: string;
  /** 該時段專屬折扣金額（NTD 固定額）；未設則用 defaultDiscountNtd */
  discountNtd?: number;
}

export interface PromoRule {
  enabled: boolean;
  windows: PromoWindow[];
  weekendMode: WeekendJamMode;
  defaultDiscountNtd: number;
}

export interface SurchargeWindow {
  days: Weekday[];
  /** 'HH:MM' 24 小時制（台北時區） */
  start: string;
  end: string;
  /** 該時段專屬加價金額（NTD 固定額）；未設則用 defaultSurchargeNtd */
  surchargeNtd?: number;
}

export interface SurchargeRule {
  enabled: boolean;
  windows: SurchargeWindow[];
  weekendMode: WeekendJamMode;
  defaultSurchargeNtd: number;
}

export interface FreewayRule {
  enabled: boolean;
  /** 首段免費里程（km） */
  freeKm: number;
  ntdPerKm: number;
  /** 日上限里程（km）；超過後套折扣 */
  dailyCapKm: number;
  /** 上限後折扣（%） */
  dailyCapDiscountPct: number;
}

export interface FareRules {
  version: number;
  currency: string;
  /** 最終進位基數（元） */
  rounding: number;
  mountain: MountainRule;
  crossCounty: CrossCountyRule;
  trafficJam: TrafficJamRule;
  freeway: FreewayRule;
  promo: PromoRule;
  surcharge: SurchargeRule;
}

// ── 路線訊號（route-metrics 產出，calculateFareV2 消費）──────────────────────

export interface RouteMetrics {
  // Routes API v2
  distanceKm: number;
  staticDurationSec: number;
  durationSec: number;
  pureJamMinutes: number;
  freeFlowKmh: number;
  polylineEncoded: string;
  // Elevation API
  elevationDiffM: number;
  elevationSamples?: number[];
  // OSM 道路索引
  freewayKm: number;
  hasTrunk: boolean;
  // 縣市 GeoJSON point-in-polygon
  countiesVisited: string[];
  // 直線距離
  straightLineKm: number;
  sinuosity: number;
  // meta
  computedAt: number;
  apiSourcesOk: { routes: boolean; elevation: boolean; osm: boolean; counties: boolean };
}

// ── 車資明細 ────────────────────────────────────────────────────────────────

export interface FareBreakdownV2 {
  baseFare: number;
  distanceFee: number;
  jamFee: number;
  /** distanceFee + jamFee（套係數前） */
  variableSubtotal: number;
  mountainMul: number;
  /** variableSubtotal × mountainMul */
  variableScaled: number;
  crossCountyFee: number;
  freewayToll: number;
  extrasSum: number;
  /** 時段固定加價金額（平面加成，不被山區係數連乘） */
  surcharge: number;
  /** 優惠時段折抵金額（平面折抵，不被山區係數連乘） */
  promoDiscount: number;
  /** 進位前合計 */
  raw: number;
  /** 進位後最終車資 */
  final: number;
  /** 進位基數（元）— 供 UI 顯示「進位 N 元」 */
  rounding: number;
  rulesVersion: number;
}

// ── 預設規則（design.md schema；admin 後台可即時覆寫）─────────────────────────

export const DEFAULT_FARE_RULES: FareRules = {
  version: 1,
  currency: 'TWD',
  rounding: 50,
  mountain: {
    enabled: true,
    thresholdElevationDiffM: 400,
    thresholdSinuosity: 1.3,
    thresholdFreeFlowKmh: 40,
    tiers: [
      { minScore: 2, multiplier: 1.3 },
      { minScore: 3, multiplier: 1.5 },
    ],
  },
  crossCounty: {
    enabled: true,
    tieredNtd: [200, 350, 500],
    excludeTpeNtpeTyn: true,
  },
  trafficJam: {
    enabled: true,
    peakWindows: [
      { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '07:00', end: '09:30' },
      { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '17:00', end: '19:30' },
    ],
    weekendMode: 'OFF',
    defaultNtdPerMinute: 15,
  },
  freeway: {
    enabled: true,
    freeKm: 20,
    ntdPerKm: 1.2,
    dailyCapKm: 200,
    dailyCapDiscountPct: 25,
  },
  promo: {
    enabled: true,
    windows: [],
    weekendMode: 'OFF',
    defaultDiscountNtd: 100,
  },
  surcharge: {
    enabled: true,
    windows: [],
    weekendMode: 'OFF',
    defaultSurchargeNtd: 100,
  },
};

// ── 運算模組 ────────────────────────────────────────────────────────────────

const WEEKDAY_KEYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 將任意 Date 轉台北時區（UTC+8，無日光節約）的星期與 HH:MM */
function taipeiParts(t: Date): { dayKey: Weekday; hhmm: string } {
  const tpe = new Date(t.getTime() + 8 * 3600 * 1000);
  const dayKey = WEEKDAY_KEYS[tpe.getUTCDay()] ?? 'SUN';
  const hh = String(tpe.getUTCHours()).padStart(2, '0');
  const mm = String(tpe.getUTCMinutes()).padStart(2, '0');
  return { dayKey, hhmm: `${hh}:${mm}` };
}

/**
 * 山區係數：三訊號（海拔起伏 / 曲折度 / 無塞車時速）各 1 分，依階梯取最高符合的 multiplier。
 * 任一訊號取不到（apiSourcesOk 對應 false）→ 該訊號 0 分。
 */
export function computeMountainMul(m: RouteMetrics, rule: MountainRule): number {
  if (!rule.enabled) return 1;
  let score = 0;
  if (m.apiSourcesOk.elevation && m.elevationDiffM >= rule.thresholdElevationDiffM) score++;
  if (m.sinuosity >= rule.thresholdSinuosity) score++;
  if (m.apiSourcesOk.routes && m.freeFlowKmh <= rule.thresholdFreeFlowKmh) score++;
  const sortedTiers = [...rule.tiers].sort((a, b) => b.minScore - a.minScore);
  for (const tier of sortedTiers) {
    if (score >= tier.minScore) return tier.multiplier;
  }
  return 1;
}

/** 找出 pickupTime 落在哪個顛峰時段，回傳適用費率（NTD/min）；非顛峰回 null。 */
function findActivePeakRate(t: Date, rule: TrafficJamRule): number | null {
  const { dayKey, hhmm } = taipeiParts(t);
  const isWeekend = dayKey === 'SAT' || dayKey === 'SUN';
  if (isWeekend) {
    if (rule.weekendMode === 'OFF') return null;
    if (rule.weekendMode === 'ALL_DAY') return rule.defaultNtdPerMinute;
    // EVENING_ONLY：僅 17:00-21:00
    return hhmm >= '17:00' && hhmm <= '21:00' ? rule.defaultNtdPerMinute : null;
  }
  const w = rule.peakWindows.find(
    (pw) => pw.days.includes(dayKey) && hhmm >= pw.start && hhmm <= pw.end,
  );
  if (!w) return null;
  return w.ntdPerMinute ?? rule.defaultNtdPerMinute;
}

/** 顛峰塞車費：顛峰時段內，純塞車分鐘 × 每分鐘費率。 */
export function computeJamFee(
  pureJamMinutes: number,
  pickupTime: Date,
  rule: TrafficJamRule,
): number {
  if (!rule.enabled || pureJamMinutes <= 0) return 0;
  const rate = findActivePeakRate(pickupTime, rule);
  if (rate === null) return 0;
  return pureJamMinutes * rate;
}

/**
 * 找出 pickupTime 落在哪個優惠時段，回傳適用折扣金額（NTD 固定額）；無匹配回 0。
 * 多個時段同時命中時取「最大折扣」。週末沿用 weekendMode（OFF / ALL_DAY / EVENING_ONLY）。
 */
export function findActivePromoDiscount(t: Date, rule: PromoRule): number {
  const { dayKey, hhmm } = taipeiParts(t);
  const isWeekend = dayKey === 'SAT' || dayKey === 'SUN';
  if (isWeekend) {
    if (rule.weekendMode === 'OFF') return 0;
    if (rule.weekendMode === 'ALL_DAY') return rule.defaultDiscountNtd;
    // EVENING_ONLY：僅 17:00-21:00
    return hhmm >= '17:00' && hhmm <= '21:00' ? rule.defaultDiscountNtd : 0;
  }
  const matched = rule.windows.filter(
    (w) => w.days.includes(dayKey) && hhmm >= w.start && hhmm <= w.end,
  );
  if (matched.length === 0) return 0;
  return Math.max(...matched.map((w) => w.discountNtd ?? rule.defaultDiscountNtd));
}

/** 優惠時段折抵：命中優惠時段時折抵固定金額（平面折抵）。保證回傳 >= 0。 */
export function computePromoDiscount(pickupTime: Date, rule: PromoRule): number {
  if (!rule.enabled) return 0;
  return Math.max(0, findActivePromoDiscount(pickupTime, rule));
}

/**
 * 找出 pickupTime 落在哪個加價時段，回傳適用加價金額（NTD 固定額）；無匹配回 0。
 * 多個時段同時命中時取「最大加價」。週末沿用 weekendMode（OFF / ALL_DAY / EVENING_ONLY）。
 */
export function findActiveSurcharge(t: Date, rule: SurchargeRule): number {
  const { dayKey, hhmm } = taipeiParts(t);
  const isWeekend = dayKey === 'SAT' || dayKey === 'SUN';
  if (isWeekend) {
    if (rule.weekendMode === 'OFF') return 0;
    if (rule.weekendMode === 'ALL_DAY') return rule.defaultSurchargeNtd;
    // EVENING_ONLY：僅 17:00-21:00
    return hhmm >= '17:00' && hhmm <= '21:00' ? rule.defaultSurchargeNtd : 0;
  }
  const matched = rule.windows.filter(
    (w) => w.days.includes(dayKey) && hhmm >= w.start && hhmm <= w.end,
  );
  if (matched.length === 0) return 0;
  return Math.max(...matched.map((w) => w.surchargeNtd ?? rule.defaultSurchargeNtd));
}

/** 時段固定加價：命中加價時段時加收固定金額（平面加成）。保證回傳 >= 0。 */
export function computeSurcharge(pickupTime: Date, rule: SurchargeRule): number {
  if (!rule.enabled) return 0;
  return Math.max(0, findActiveSurcharge(pickupTime, rule));
}

/** 跨縣市補貼：crossingCount = 訪問縣市數 − 1，依階梯費率累加。 */
export function computeCrossCountyFee(visited: ReadonlyArray<string>, rule: CrossCountyRule): number {
  if (!rule.enabled || visited.length <= 1) return 0;
  // 北北桃排除：所有訪問縣市都在北北桃集合內 → 不收
  if (rule.excludeTpeNtpeTyn && visited.every((c) => (TPE_METRO_CODES as ReadonlySet<string>).has(c))) {
    return 0;
  }
  const crossings = visited.length - 1;
  let total = 0;
  for (let i = 0; i < crossings; i++) {
    const tier = Math.min(i, rule.tieredNtd.length - 1);
    total += rule.tieredNtd[tier] ?? 0;
  }
  return total;
}

/** 國道通行費：首段免費 + 每 km 費率 + 日上限後折扣（單次接送通常不觸及上限）。 */
export function computeFreewayToll(freewayKm: number, rule: FreewayRule): number {
  if (!rule.enabled || freewayKm <= 0) return 0;
  const chargeable = Math.max(0, freewayKm - rule.freeKm);
  if (chargeable === 0) return 0;
  let toll: number;
  if (chargeable <= rule.dailyCapKm) {
    toll = chargeable * rule.ntdPerKm;
  } else {
    const fullRate = rule.dailyCapKm * rule.ntdPerKm;
    const discounted =
      (chargeable - rule.dailyCapKm) * rule.ntdPerKm * (1 - rule.dailyCapDiscountPct / 100);
    toll = fullRate + discounted;
  }
  return Math.round(toll);
}

/**
 * Fare V2 主計算 — 組合 6 項加總 → FareBreakdownV2。純函式，前後端皆可呼叫。
 */
export function calculateFareV2(
  vehicle: Pick<FleetVehicle, 'baseFare' | 'perKmRate'>,
  metrics: RouteMetrics,
  pickupTime: Date,
  extras: ReadonlyArray<Pick<FleetExtra, 'price'>>,
  rules: FareRules,
): FareBreakdownV2 {
  // 1. 基本里程費 + 塞車費
  const distanceFee = metrics.distanceKm * vehicle.perKmRate;
  const jamFee = computeJamFee(metrics.pureJamMinutes, pickupTime, rules.trafficJam);

  // 2. 山區係數
  const mountainMul = computeMountainMul(metrics, rules.mountain);

  // 3. 固定加費
  const crossCountyFee = computeCrossCountyFee(metrics.countiesVisited, rules.crossCounty);
  const freewayToll = computeFreewayToll(metrics.freewayKm, rules.freeway);

  // 4. 加值服務
  const extrasSum = extras.reduce((sum, e) => sum + e.price, 0);

  // 5. 時段固定加價 + 優惠時段折抵（皆平面計算，不被山區係數連乘）
  const surcharge = computeSurcharge(pickupTime, rules.surcharge);
  const promoDiscount = computePromoDiscount(pickupTime, rules.promo);

  // 6. 公式骨架
  const variableSubtotal = distanceFee + jamFee;
  const variableScaled = variableSubtotal * mountainMul;
  const raw =
    vehicle.baseFare +
    variableScaled +
    crossCountyFee +
    freewayToll +
    extrasSum +
    surcharge -
    promoDiscount;

  // 7. 最後進位（只執行一次）；折抵後可能小於 0，鎖最低 0 元
  const final = Math.max(0, Math.ceil(raw / rules.rounding) * rules.rounding);

  return {
    baseFare: vehicle.baseFare,
    distanceFee,
    jamFee,
    variableSubtotal,
    mountainMul,
    variableScaled,
    crossCountyFee,
    freewayToll,
    extrasSum,
    surcharge,
    promoDiscount,
    raw,
    final,
    rounding: rules.rounding,
    rulesVersion: rules.version,
  };
}
