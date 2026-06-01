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
import type { TagGroup, TagScope } from './tagTaxonomy';

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
  /** @deprecated SU 系統已停用（airport-calibration wave）；保留欄位向後相容 Firestore 既有資料 */
  luggageSU?: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  /** Booking v2：車型卡情境文案三語（optional；向後相容） */
  tagline?: I18nLabel;
  /** 行李容量與適用情境的市面描述（三語；admin 編輯，UI 取代行李 SU 對照表） */
  luggageDescription?: I18nLabel;
  /** 車卡圖庫（airport-calibration wave D）— exterior 為主圖；interior / trunk 補充顯示 lightbox */
  images?: VehicleImages;
  /** Charter Fare V1：包車三檔時長套餐（optional；缺省時 charter 訂單 fallback fare-v2，由編排層處理） */
  charterPlans?: Partial<Record<CharterPlanKey, CharterPlan>>;
}

export interface VehicleImages {
  /** 外觀照（主圖；卡片預設顯示） */
  exterior?: string;
  /** 內裝照 */
  interior?: string;
  /** 後車廂照（與 driver vehicleCapacity.trunkPhotoUrl 不同 — 此為車型展示用） */
  trunk?: string;
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
 * 計算預估車資（v1 — 簡化版，Routes API 全失敗時的 fallback / 公開頁示範估價）。
 *
 * 行為對齊 v2（calculateFareV2）核心：
 *   - 里程分段累進折扣（rules.distanceTier 套用）
 *   - 起跳費 floor：里程費 < 起跳費 → 以起跳費計
 *   - 加值服務在最後加總
 *   - 進位至 rules.rounding（預設 50）
 * 不含：山區係數 / 顛峰塞車 / 跨縣市 / 國道 / 時段加價折抵（皆需 routeMetrics）。
 *
 * @param rules optional；省略時用 DEFAULT_FARE_RULES（沿用 v1 既有行為的數值常數）
 */
export const calculateFare = (
  vehicle: Pick<FleetVehicle, 'baseFare' | 'perKmRate'>,
  distanceKm: number,
  extras: ReadonlyArray<Pick<FleetExtra, 'price'>>,
  rules: Pick<FareRules, 'distanceTier' | 'rounding'> = DEFAULT_FARE_RULES,
): number => {
  const distanceFee = computeDistanceFee(distanceKm, vehicle.perKmRate, rules.distanceTier);
  const chargedDistanceFee = Math.max(vehicle.baseFare, distanceFee);
  const extrasSum = extras.reduce((sum, e) => sum + e.price, 0);
  return Math.ceil((chargedDistanceFee + extrasSum) / rules.rounding) * rules.rounding;
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
  /** 行程類型過濾；未設或空陣列 = 套用全部行程 */
  orderTypes?: OrderType[];
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
  /** 行程類型過濾；未設或空陣列 = 套用全部行程 */
  orderTypes?: OrderType[];
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
  /** 行程類型過濾；未設或空陣列 = 套用全部行程 */
  orderTypes?: OrderType[];
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

/** 里程分段累進折扣的一段 */
export interface DistanceTier {
  /** 此段下界（km，含）；第一段必為 0；陣列須按 fromKm 升冪 */
  fromKm: number;
  /** 此段折扣百分比（0–100）；0 = 原價，10 = 9 折，20 = 8 折 */
  discountPct: number;
}

/**
 * 里程分段累進折扣規則：依距離切段，每段套各自費率（perKmRate × (1 − discountPct/100)）。
 * 隱含上界為下一段的 fromKm；最後一段為「剩餘里程」。
 */
export interface DistanceTierRule {
  enabled: boolean;
  /** 至少 1 段；第一段 fromKm 必為 0；按 fromKm 升冪 */
  tiers: DistanceTier[];
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
  /** 里程分段累進折扣（distanceFee 計算規則）；全車型一致；折扣套在 distanceFee 上 */
  distanceTier: DistanceTierRule;
  /** Charter Fare V1：包車（orderType='charter'）獨立計費規則；W1 鎖介面，W2 實作 */
  charter: CharterRule;
}

// =============================================================================
// Charter Fare V1 — 包車車資（時長套餐 + 超時 + 過夜 + 來回 + 山區）
//
// W1 範圍（本檔）：型別 + 預設值 + calculateCharterFareV2 stub。
// W2 範圍：填滿 stub 實作 + 14 個 vitest it.todo + 來回判定演算法。
// 詳見 openspec/changes/2026-05-28-charter-fare-v1/design.md。
//
// 公式骨架（hardcode，不可改）：
//   A = plan.basePrice（多日累加）
//   B = max(0, distanceKm − plan.includedKm) × plan.extraKmRate
//   mountainScaled = (A + B) × mountainMul
//   raw   = mountainScaled + roundTripFee + overnightFee + overtimeCharge
//         + extrasTotal + surcharge − promoDiscount
//   final = ⌈ raw / charter.rounding ⌉ × charter.rounding
//
// 包車不套：crossCountyFee / freewayToll / distanceTier（與 fare-v2 公式關鍵差異）。
// =============================================================================

/** 三檔時長套餐 key — 鎖定 union，不可擴充其他鍵 */
export type CharterPlanKey = '4h' | '8h' | '10h';

export interface CharterPlan {
  key: CharterPlanKey;
  /** 套餐時長（4 / 8 / 10），與 key 對齊；冗餘存以便讀取端不用 parse key */
  durationHours: number;
  /** 套餐底價 NTD */
  basePrice: number;
  /** 含里程（km）；超過部分按 extraKmRate 加收 */
  includedKm: number;
  /** 超公里費率 NTD / km */
  extraKmRate: number;
  /** OT 段價 NTD / 30min */
  overtimeRatePer30min: number;
  enabled: boolean;
}

export interface CharterMountainRule {
  enabled: boolean;
  /** 山區階梯（沿用 fare-v2 三訊號偵測，僅 multiplier 階梯獨立於 fare-v2） */
  tiers: MountainTier[];
}

export interface CharterRule {
  enabled: boolean;
  /** 最終進位基數（元）；charter 預設 100，與 fare-v2 的 50 分離 */
  rounding: number;
  /** OT 寬限（分鐘）；actual − planned ≤ grace → 不收 */
  overtimeGraceMin: number;
  /** 來回固定加收 NTD（命中 isRoundTrip 時加一次） */
  roundTripFlatFee: number;
  /** D 到 (X→A polyline) 最短距離門檻（km） */
  roundTripBufferKm: number;
  /** D 到 A 直線距離門檻（km，過頭情境） */
  roundTripOverShootMaxKm: number;
  /** 每晚過夜固定加收 NTD（司機住宿補貼） */
  overnightFlatFee: number;
  /** 山區係數（沿用 fare-v2 三訊號偵測；階梯獨立） */
  mountain: CharterMountainRule;
  /** 是否套 fare-v2 時段加價（windows）— 沿用同套 windows，僅以 orderType='charter' 過濾 */
  applySurchargeWindows: boolean;
  /** 是否套 fare-v2 時段優惠（windows）— 沿用同套 windows，僅以 orderType='charter' 過濾 */
  applyPromoWindows: boolean;
}

/** 計算結果明細（W2 填入；W1 stub 不產生此物件） */
export interface CharterFareBreakdownV2 {
  /** 多日 plan basePrice 加總（A） */
  planBasePriceSum: number;
  /** 超公里加收（B），用第一天 plan 的 includedKm / extraKmRate */
  extraKmCharge: number;
  /** A + B，套山區係數前的底層 */
  baseLayer: number;
  /** 山區係數（沿用 fare-v2 三訊號分數 + charter.mountain.tiers） */
  mountainMul: number;
  /** baseLayer × mountainMul */
  mountainScaled: number;
  /** 來回固定加收（C） */
  roundTripFee: number;
  /** 過夜固定加收 = nights × charter.overnightFlatFee（D） */
  overnightFee: number;
  /** OT 加收 = overtimeBlocks × plan.overtimeRatePer30min（E） */
  overtimeCharge: number;
  /** 加值服務加總（F） */
  extrasTotal: number;
  /** 時段固定加價（G）— 沿用 fare-v2 windows，以 orderType='charter' 過濾 */
  surcharge: number;
  /** 時段折抵（H）— 沿用 fare-v2 windows，以 orderType='charter' 過濾 */
  promoDiscount: number;
  /** 進位前合計 */
  raw: number;
  /** 進位後最終車資 */
  final: number;
  /** 多日各 plan basePrice 明細（供 UI 顯示「Day 1 8h / Day 2 8h」）*/
  daysBreakdown: Array<{ day: number; planKey: CharterPlanKey; basePrice: number }>;
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
  /** Charter Fare V1：最後 stopover X → 上車點 A 的 encoded polyline（W2 額外取一次 Routes 計算）。
   *  非 charter 模式或無 stopover 時為 undefined；來回判定（shortestDistanceKmFromPointToPolyline）使用。 */
  returnLegPolyline?: string;
}

// ── 車資明細 ────────────────────────────────────────────────────────────────

export interface FareBreakdownV2 {
  /** 車型起跳費（informational；起跳費作為里程費下限，不再單獨加總） */
  baseFare: number;
  /** 里程費（分段累進折扣後的原始值，僅供顯示） */
  distanceFee: number;
  /** 起跳費 floor 後實際計入小計的里程相關費用 = max(baseFare, distanceFee) */
  chargedDistanceFee: number;
  jamFee: number;
  /** chargedDistanceFee + jamFee（套係數前） */
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
  distanceTier: {
    enabled: true,
    tiers: [
      { fromKm: 0,  discountPct: 0 },
      { fromKm: 10, discountPct: 10 },
      { fromKm: 30, discountPct: 20 },
    ],
  },
  charter: {
    enabled: true,
    rounding: 100,
    overtimeGraceMin: 15,
    roundTripFlatFee: 1500,
    roundTripBufferKm: 5,
    roundTripOverShootMaxKm: 15,
    overnightFlatFee: 2000,
    mountain: {
      enabled: true,
      tiers: [
        { minScore: 2, multiplier: 1.4 },
        { minScore: 3, multiplier: 1.6 },
      ],
    },
    applySurchargeWindows: true,
    applyPromoWindows: true,
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

/** 三個門檻（fare-v2 與 charter 共用）。charter.mountain 沿用同套 threshold，只 multiplier tiers 獨立。 */
type MountainThresholds = Pick<
  MountainRule,
  'thresholdElevationDiffM' | 'thresholdSinuosity' | 'thresholdFreeFlowKmh'
>;

/**
 * 三訊號分數（0-3）：海拔起伏 / 曲折度 / 無塞車時速 各 1 分。
 * 任一訊號取不到（apiSourcesOk 對應 false）→ 該訊號 0 分。
 * 抽出共用以便 fare-v2 與 charter 共享偵測邏輯，僅 tiers 不同。
 */
function computeMountainScoreFromMetrics(m: RouteMetrics, t: MountainThresholds): number {
  let score = 0;
  if (m.apiSourcesOk.elevation && m.elevationDiffM >= t.thresholdElevationDiffM) score++;
  if (m.sinuosity >= t.thresholdSinuosity) score++;
  if (m.apiSourcesOk.routes && m.freeFlowKmh <= t.thresholdFreeFlowKmh) score++;
  return score;
}

/** 依分數從 tiers 中取最高符合的 multiplier；無命中回 1。 */
function pickMountainMulFromTiers(score: number, tiers: ReadonlyArray<MountainTier>): number {
  const sorted = [...tiers].sort((a, b) => b.minScore - a.minScore);
  for (const tier of sorted) {
    if (score >= tier.minScore) return tier.multiplier;
  }
  return 1;
}

/**
 * 山區係數（fare-v2）：三訊號分數 → rule.tiers 取階梯。
 * 任一訊號取不到（apiSourcesOk 對應 false）→ 該訊號 0 分。
 */
export function computeMountainMul(m: RouteMetrics, rule: MountainRule): number {
  if (!rule.enabled) return 1;
  const score = computeMountainScoreFromMetrics(m, rule);
  return pickMountainMulFromTiers(score, rule.tiers);
}

/**
 * 山區係數（charter）：偵測訊號沿用 fare-v2 三 threshold（baseThresholds），
 * 但 multiplier 階梯來自 charter.mountain.tiers（W1 預設 2 分 1.4x / 3 分 1.6x）。
 *
 * charter.mountain.enabled=false → 一律 1。
 */
export function computeCharterMountainMul(
  m: RouteMetrics,
  charterMountain: CharterMountainRule,
  baseThresholds: MountainThresholds,
): number {
  if (!charterMountain.enabled) return 1;
  const score = computeMountainScoreFromMetrics(m, baseThresholds);
  return pickMountainMulFromTiers(score, charterMountain.tiers);
}

/**
 * 時段的行程類型過濾：window.orderTypes 未設或空陣列 → 套用全部行程；
 * 否則需 orderType 在清單內（orderType 為 null 時視為不符）。
 */
function orderTypeMatches(
  windowOrderTypes: OrderType[] | undefined,
  orderType: OrderType | null,
): boolean {
  if (!windowOrderTypes || windowOrderTypes.length === 0) return true;
  return orderType !== null && windowOrderTypes.includes(orderType);
}

/** 找出 pickupTime 落在哪個顛峰時段，回傳適用費率（NTD/min）；非顛峰回 null。 */
function findActivePeakRate(
  t: Date,
  rule: TrafficJamRule,
  orderType: OrderType | null,
): number | null {
  const { dayKey, hhmm } = taipeiParts(t);
  const isWeekend = dayKey === 'SAT' || dayKey === 'SUN';
  if (isWeekend) {
    if (rule.weekendMode === 'OFF') return null;
    if (rule.weekendMode === 'ALL_DAY') return rule.defaultNtdPerMinute;
    // EVENING_ONLY：僅 17:00-21:00
    return hhmm >= '17:00' && hhmm <= '21:00' ? rule.defaultNtdPerMinute : null;
  }
  const w = rule.peakWindows.find(
    (pw) =>
      pw.days.includes(dayKey) &&
      hhmm >= pw.start &&
      hhmm <= pw.end &&
      orderTypeMatches(pw.orderTypes, orderType),
  );
  if (!w) return null;
  return w.ntdPerMinute ?? rule.defaultNtdPerMinute;
}

/** 顛峰塞車費：顛峰時段內，純塞車分鐘 × 每分鐘費率。 */
export function computeJamFee(
  pureJamMinutes: number,
  pickupTime: Date,
  rule: TrafficJamRule,
  orderType: OrderType | null = null,
): number {
  if (!rule.enabled || pureJamMinutes <= 0) return 0;
  const rate = findActivePeakRate(pickupTime, rule, orderType);
  if (rate === null) return 0;
  return pureJamMinutes * rate;
}

/**
 * 找出 pickupTime 落在哪個優惠時段，回傳適用折扣金額（NTD 固定額）；無匹配回 0。
 * 多個時段同時命中時取「最大折扣」。週末沿用 weekendMode（OFF / ALL_DAY / EVENING_ONLY）。
 */
export function findActivePromoDiscount(
  t: Date,
  rule: PromoRule,
  orderType: OrderType | null = null,
): number {
  const { dayKey, hhmm } = taipeiParts(t);
  const isWeekend = dayKey === 'SAT' || dayKey === 'SUN';
  if (isWeekend) {
    if (rule.weekendMode === 'OFF') return 0;
    if (rule.weekendMode === 'ALL_DAY') return rule.defaultDiscountNtd;
    // EVENING_ONLY：僅 17:00-21:00
    return hhmm >= '17:00' && hhmm <= '21:00' ? rule.defaultDiscountNtd : 0;
  }
  const matched = rule.windows.filter(
    (w) =>
      w.days.includes(dayKey) &&
      hhmm >= w.start &&
      hhmm <= w.end &&
      orderTypeMatches(w.orderTypes, orderType),
  );
  if (matched.length === 0) return 0;
  return Math.max(...matched.map((w) => w.discountNtd ?? rule.defaultDiscountNtd));
}

/** 優惠時段折抵：命中優惠時段時折抵固定金額（平面折抵）。保證回傳 >= 0。 */
export function computePromoDiscount(
  pickupTime: Date,
  rule: PromoRule,
  orderType: OrderType | null = null,
): number {
  if (!rule.enabled) return 0;
  return Math.max(0, findActivePromoDiscount(pickupTime, rule, orderType));
}

/**
 * 找出 pickupTime 落在哪個加價時段，回傳適用加價金額（NTD 固定額）；無匹配回 0。
 * 多個時段同時命中時取「最大加價」。週末沿用 weekendMode（OFF / ALL_DAY / EVENING_ONLY）。
 */
export function findActiveSurcharge(
  t: Date,
  rule: SurchargeRule,
  orderType: OrderType | null = null,
): number {
  const { dayKey, hhmm } = taipeiParts(t);
  const isWeekend = dayKey === 'SAT' || dayKey === 'SUN';
  if (isWeekend) {
    if (rule.weekendMode === 'OFF') return 0;
    if (rule.weekendMode === 'ALL_DAY') return rule.defaultSurchargeNtd;
    // EVENING_ONLY：僅 17:00-21:00
    return hhmm >= '17:00' && hhmm <= '21:00' ? rule.defaultSurchargeNtd : 0;
  }
  const matched = rule.windows.filter(
    (w) =>
      w.days.includes(dayKey) &&
      hhmm >= w.start &&
      hhmm <= w.end &&
      orderTypeMatches(w.orderTypes, orderType),
  );
  if (matched.length === 0) return 0;
  return Math.max(...matched.map((w) => w.surchargeNtd ?? rule.defaultSurchargeNtd));
}

/** 時段固定加價：命中加價時段時加收固定金額（平面加成）。保證回傳 >= 0。 */
export function computeSurcharge(
  pickupTime: Date,
  rule: SurchargeRule,
  orderType: OrderType | null = null,
): number {
  if (!rule.enabled) return 0;
  return Math.max(0, findActiveSurcharge(pickupTime, rule, orderType));
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

/**
 * 里程費（分段累進折扣）：依規則把距離切段，每段套 perKmRate × (1 − discountPct/100) 累加。
 *
 * - rule.enabled=false / tiers 空 → 退回 distanceKm × perKmRate（原 v1 邏輯）
 * - 第一段隱含下界 = 0；最後一段為「剩餘里程」（無上界）
 * - 不在此處進位 — 由 calculateFareV2 最後統一 ceil 50 元
 */
export function computeDistanceFee(
  distanceKm: number,
  perKmRate: number,
  rule: DistanceTierRule,
): number {
  if (distanceKm <= 0 || perKmRate <= 0) return 0;
  if (!rule.enabled || rule.tiers.length === 0) return distanceKm * perKmRate;

  const sorted = [...rule.tiers].sort((a, b) => a.fromKm - b.fromKm);
  let fee = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (!cur) continue;
    const next = sorted[i + 1];
    const lower = Math.max(0, cur.fromKm);
    const upper = next ? next.fromKm : Number.POSITIVE_INFINITY;
    if (distanceKm <= lower) break;
    const segKm = Math.min(distanceKm, upper) - lower;
    if (segKm <= 0) continue;
    const pct = Math.min(100, Math.max(0, cur.discountPct));
    fee += segKm * perKmRate * (1 - pct / 100);
  }
  return fee;
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

// =============================================================================
// Phase 1D — 偏好標籤加價（拍板取 max，不取 sum）
//
// 公式：tagSurcharge = max(乘客勾選命中標籤的 surchargeAmount)；未命中為 0。
// 無效 id（不存在 / archived / scope!==vehicle）會被過濾入 invalidTagIds，不影響 surcharge。
// =============================================================================

export interface TagSurchargeIndexEntry {
  id: string;
  group: TagGroup;
  scope: TagScope;
  surchargeAmount: number;
  status: 'active' | 'archived';
}

export interface CalcTagSurchargeResult {
  /** max(命中標籤的 surchargeAmount)；未命中為 0 */
  surcharge: number;
  /** 真正命中的 id（active + scope=vehicle + 存在於 index） */
  matchedTagIds: string[];
  /** 無效的 id（server 端可用來回 400） */
  invalidTagIds: string[];
}

/**
 * 從 active vehicle tag DTO 陣列建 index map。
 * 呼叫端通常會自己 filter scope=vehicle / status=active，但本 helper 也接受混雜輸入。
 */
export function buildTagSurchargeIndex(
  tags: ReadonlyArray<TagSurchargeIndexEntry>,
): Map<string, TagSurchargeIndexEntry> {
  const map = new Map<string, TagSurchargeIndexEntry>();
  for (const t of tags) {
    if (t && typeof t.id === 'string' && t.id.length > 0) {
      map.set(t.id, t);
    }
  }
  return map;
}

/**
 * 計算偏好標籤加價（取 max 而非 sum）。
 *
 * 規則：
 *   - 不在 tagIndex → invalid
 *   - status !== 'active' → invalid
 *   - scope !== 'vehicle' → invalid
 *   - 命中：surcharge = max(matched.surchargeAmount)；無命中為 0
 */
export function calcTagSurcharge(
  selectedTagIds: ReadonlyArray<string>,
  tagIndex: ReadonlyMap<string, TagSurchargeIndexEntry>,
): CalcTagSurchargeResult {
  const matched: TagSurchargeIndexEntry[] = [];
  const invalidTagIds: string[] = [];
  for (const id of selectedTagIds) {
    if (typeof id !== 'string' || id.length === 0) {
      invalidTagIds.push(String(id));
      continue;
    }
    const entry = tagIndex.get(id);
    if (!entry) {
      invalidTagIds.push(id);
      continue;
    }
    if (entry.status !== 'active' || entry.scope !== 'vehicle') {
      invalidTagIds.push(id);
      continue;
    }
    matched.push(entry);
  }
  const surcharge = matched.length === 0
    ? 0
    : Math.max(...matched.map((t) => t.surchargeAmount));
  return {
    surcharge,
    matchedTagIds: matched.map((t) => t.id),
    invalidTagIds,
  };
}

// =============================================================================
// Charter Fare V1 — calculateCharterFareV2
//
// 公式骨架（見 design.md / spec.md，不可改）：
//   A = plan.basePrice（多日累加）
//   B = max(0, distanceKm − dayOnePlan.includedKm) × dayOnePlan.extraKmRate
//   mountainScaled = (A + B) × mountainMul
//   raw = mountainScaled + roundTripFee + overnightFee + overtimeCharge
//         + extrasTotal + surcharge − promoDiscount
//   final = max(0, ⌈ raw / charter.rounding ⌉ × charter.rounding)
//
// 包車不套：crossCountyFee / freewayToll / distanceTier。
// engine 本身不關心 charter.enabled — 編排層決定走 charter 引擎或 fallback fare-v2。
// =============================================================================

/**
 * OT 段數計算：actualEnd（或 estimatedEnd 兜底）− estimatedEnd − grace 分鐘，
 * 不足 0 視 0；正值 ceil / 30 取段。
 *
 * 寬限邊界：15 分（grace 15） → overshootMin=0 / blocks=0；16 分 → overshootMin=1 / blocks=1；
 * 46 分 → overshootMin=31 / blocks=2。
 */
export function computeOvertimeBlocks(
  estimatedEndTime: Date,
  actualEndTime: Date | null,
  charter: Pick<CharterRule, 'overtimeGraceMin'>,
): number {
  const effectiveEnd = actualEndTime ?? estimatedEndTime;
  const diffMin = (effectiveEnd.getTime() - estimatedEndTime.getTime()) / 60000;
  const overshootMin = Math.max(0, diffMin - charter.overtimeGraceMin);
  return overshootMin > 0 ? Math.ceil(overshootMin / 30) : 0;
}

export interface CharterReconciliationInput {
  estimatedEndTime: Date;
  actualEndTime: Date;
  overtimeRatePer30min: number;
  charter: Pick<CharterRule, 'overtimeGraceMin'>;
}

export interface CharterReconciliationResult {
  /** 實際 − 預估，分鐘（提早 / 0 差 → 0；小數四捨五入） */
  overtimeMinutes: number;
  /** 套 grace 後的 30 分段數（ceil） */
  overtimeBlocks: number;
  /** blocks × overtimeRatePer30min */
  overtimeCharge: number;
}

/**
 * Charter Fare V1 W5：driver 結束包車任務後，server 端用此純函式重算 OT 對帳。
 * 三欄回寫 orders/{id}.charter.{overtimeMinutes,overtimeBlocks,overtimeCharge}。
 *
 * - overtimeMinutes 提早結束視為 0（avoid 負數混淆 admin 對帳）
 * - overtimeBlocks 完整套 computeOvertimeBlocks（grace + 30 分 ceil）
 * - overtimeCharge = blocks × overtimeRatePer30min（dayOnePlan 凍結價）
 */
export function computeCharterReconciliation(input: CharterReconciliationInput): CharterReconciliationResult {
  const { estimatedEndTime, actualEndTime, overtimeRatePer30min, charter } = input;
  const diffMs = actualEndTime.getTime() - estimatedEndTime.getTime();
  const overtimeMinutes = Math.max(0, Math.round(diffMs / 60000));
  const overtimeBlocks = computeOvertimeBlocks(estimatedEndTime, actualEndTime, charter);
  const overtimeCharge = overtimeBlocks * overtimeRatePer30min;
  return { overtimeMinutes, overtimeBlocks, overtimeCharge };
}

export function calculateCharterFareV2(
  vehicle: FleetVehicle,
  planKeys: CharterPlanKey[],
  routeMetrics: RouteMetrics,
  isRoundTripFlag: boolean,
  pickupTime: Date,
  estimatedEndTime: Date,
  actualEndTime: Date | null,
  extras: ReadonlyArray<Pick<FleetExtra, 'price'>>,
  rules: FareRules,
): CharterFareBreakdownV2 {
  if (planKeys.length === 0) {
    throw new Error('calculateCharterFareV2: planKeys is empty');
  }
  const plans = planKeys.map((k) => {
    const p = vehicle.charterPlans?.[k];
    if (!p) throw new Error(`calculateCharterFareV2: vehicle.charterPlans missing plan "${k}"`);
    return p;
  });
  const dayOnePlan = plans[0]!;

  // 1. 多日 plan basePrice 加總 + 超公里加收（用第一天 plan 的 includedKm / extraKmRate）
  const planBasePriceSum = plans.reduce((s, p) => s + p.basePrice, 0);
  const extraKm = Math.max(0, routeMetrics.distanceKm - dayOnePlan.includedKm);
  const extraKmCharge = extraKm * dayOnePlan.extraKmRate;
  const baseLayer = planBasePriceSum + extraKmCharge;

  // 2. 山區係數（charter 沿用 fare-v2 三訊號偵測，tiers 取自 charter.mountain.tiers）
  const mountainMul = computeCharterMountainMul(routeMetrics, rules.charter.mountain, rules.mountain);
  const mountainScaled = baseLayer * mountainMul;

  // 3. 來回 / 過夜 / OT
  const roundTripFee = isRoundTripFlag ? rules.charter.roundTripFlatFee : 0;
  const nights = Math.max(0, planKeys.length - 1);
  const overnightFee = nights * rules.charter.overnightFlatFee;
  const overtimeBlocks = computeOvertimeBlocks(estimatedEndTime, actualEndTime, rules.charter);
  const overtimeCharge = overtimeBlocks * dayOnePlan.overtimeRatePer30min;

  // 4. extras（平面加總，不被山區係數放大）
  const extrasTotal = extras.reduce((s, e) => s + e.price, 0);

  // 5. 時段加價 / 折抵（共用 fare-v2 windows + orderType='charter' 過濾；charter 可 opt-out）
  const surcharge = rules.charter.applySurchargeWindows
    ? computeSurcharge(pickupTime, rules.surcharge, 'charter')
    : 0;
  const promoDiscount = rules.charter.applyPromoWindows
    ? computePromoDiscount(pickupTime, rules.promo, 'charter')
    : 0;

  // 6. 合計 + 進位（charter.rounding，與 fare-v2 的 rounding 分離；最後一次 ceil）
  const raw =
    mountainScaled + roundTripFee + overnightFee + overtimeCharge + extrasTotal + surcharge - promoDiscount;
  const final = Math.max(0, Math.ceil(raw / rules.charter.rounding) * rules.charter.rounding);

  return {
    planBasePriceSum,
    extraKmCharge,
    baseLayer,
    mountainMul,
    mountainScaled,
    roundTripFee,
    overnightFee,
    overtimeCharge,
    extrasTotal,
    surcharge,
    promoDiscount,
    raw,
    final,
    daysBreakdown: planKeys.map((k, i) => ({
      day: i + 1,
      planKey: k,
      basePrice: plans[i]!.basePrice,
    })),
  };
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
  orderType: OrderType | null = null,
): FareBreakdownV2 {
  // 1. 基本里程費（分段累進折扣，全車型一致）+ 塞車費
  const distanceFee = computeDistanceFee(metrics.distanceKm, vehicle.perKmRate, rules.distanceTier);
  const jamFee = computeJamFee(metrics.pureJamMinutes, pickupTime, rules.trafficJam, orderType);

  // 1b. 起跳費 floor：里程費 < 起跳費 → 以起跳費計；里程費 ≥ 起跳費 → 以里程費計
  //     等價於 max(baseFare, distanceFee)；baseFare 不再單獨加總（已含在 chargedDistanceFee）
  const chargedDistanceFee = Math.max(vehicle.baseFare, distanceFee);

  // 2. 山區係數
  const mountainMul = computeMountainMul(metrics, rules.mountain);

  // 3. 固定加費
  const crossCountyFee = computeCrossCountyFee(metrics.countiesVisited, rules.crossCounty);
  const freewayToll = computeFreewayToll(metrics.freewayKm, rules.freeway);

  // 4. 加值服務
  const extrasSum = extras.reduce((sum, e) => sum + e.price, 0);

  // 5. 時段固定加價 + 優惠時段折抵（皆平面計算，不被山區係數連乘）
  const surcharge = computeSurcharge(pickupTime, rules.surcharge, orderType);
  const promoDiscount = computePromoDiscount(pickupTime, rules.promo, orderType);

  // 6. 公式骨架：chargedDistanceFee（已含起跳） + jamFee → 套山區係數 → 加固定費 / 服務 / 時段差
  const variableSubtotal = chargedDistanceFee + jamFee;
  const variableScaled = variableSubtotal * mountainMul;
  const raw =
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
    chargedDistanceFee,
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
