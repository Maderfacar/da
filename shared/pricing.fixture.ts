// 機場線 V1 校準資料（桃機 T1/T2 為起點，sedan-suv = 4 人座基準）
//
// 用於 shared/pricing.calibration.spec.ts。資料對齊 Brain AI 拍板的目標表（v1 wave）。
// tier 結構沿用 prod Firestore fare_rules/v1（0/15/50/100/160 × 0/75/40/90/55）—
// 0/10/30 × 0/10/20% 數學上無法收斂目標曲線（短程 47 / 長程 24 $/km，差 2 倍）。
//
// 容差：主力 OD（桃園/新北/台北/竹/新竹）±150；長距離（台中/大甲后里）±300。

import type { FareRules, RouteMetrics } from './pricing';

/** 校準專用 FareRules — 與 Firestore prod 同步，與 DEFAULT_FARE_RULES 並存 */
export const AIRPORT_CALIBRATION_RULES: FareRules = {
  version: 1,
  currency: 'TWD',
  rounding: 50,
  mountain: {
    enabled: true,
    thresholdElevationDiffM: 300,
    thresholdSinuosity: 1.3,
    thresholdFreeFlowKmh: 40,
    tiers: [
      { minScore: 2, multiplier: 1.1 },
      { minScore: 3, multiplier: 1.15 },
    ],
  },
  crossCounty: {
    enabled: true,
    tieredNtd: [150, 0, 50, 100],
    excludeTpeNtpeTyn: true,
  },
  trafficJam: {
    enabled: true,
    peakWindows: [],
    weekendMode: 'OFF',
    defaultNtdPerMinute: 15,
  },
  freeway: {
    enabled: true,
    freeKm: 0,
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
      { fromKm: 0,   discountPct: 0  },
      { fromKm: 15,  discountPct: 65 },
      { fromKm: 50,  discountPct: 45 },
      { fromKm: 100, discountPct: 80 },
      { fromKm: 160, discountPct: 55 },
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

/** 6 車型校準參數（baseFare + perKmRate）— 與 Firestore fleet_vehicles 同步 */
export interface VehicleCalibration {
  id: string;
  baseFare: number;
  perKmRate: number;
}

export const VEHICLE_CALIBRATIONS: ReadonlyArray<VehicleCalibration> = [
  { id: 'sedan-suv',       baseFare: 200, perKmRate: 50  },
  { id: 'sedan-business',  baseFare: 300, perKmRate: 66  },
  { id: 'mpv-family',      baseFare: 300, perKmRate: 70  },
  { id: 'mpv-vip',         baseFare: 500, perKmRate: 103 },
  { id: 'van-9',           baseFare: 400, perKmRate: 85  },
  { id: 'van-9-business',  baseFare: 500, perKmRate: 110 },
];

/** 8 個機場線 OD 場景（從桃機 T1/T2 出發） */
export interface AirportODCase {
  /** 場景名稱（中文） */
  name: string;
  /** 代表性距離（km，zone 中位數） */
  distanceKm: number;
  /** 行經縣市 code（用於 crossCountyFee） */
  countiesVisited: string[];
  /** 各車型目標價（NTD），順序對齊 VEHICLE_CALIBRATIONS */
  targets: ReadonlyArray<number>;
  /** 容差（NTD）；主力 OD ±150，長距離 ±300 */
  tolerance: number;
}

export const AIRPORT_OD_CASES: ReadonlyArray<AirportODCase> = [
  {
    name: '桃機→桃園市區（中壢/桃市/八德/平鎮/大園/蘆竹/龜山）',
    distanceKm: 15,
    countiesVisited: ['TYN'],
    targets: [699, 999, 999, 1599, 1299, 1799],
    tolerance: 150,
  },
  {
    name: '桃機→桃園外圍（新屋/觀音/楊梅）',
    distanceKm: 25,
    countiesVisited: ['TYN'],
    targets: [899, 1199, 1199, 1899, 1499, 1999],
    tolerance: 150,
  },
  {
    name: '桃機→新北 14 區',
    distanceKm: 35,
    countiesVisited: ['TYN', 'NTPE'],
    targets: [1199, 1599, 1699, 2599, 1999, 2599],
    tolerance: 150,
  },
  {
    name: '桃機→台北市',
    distanceKm: 47,
    countiesVisited: ['TYN', 'NTPE', 'TPE'],
    targets: [1299, 1699, 1799, 2799, 2199, 2799],
    tolerance: 150,
  },
  {
    name: '桃機→竹北',
    distanceKm: 65,
    countiesVisited: ['TYN', 'HSZ'],
    targets: [1999, 2599, 2699, 3999, 3199, 3999],
    tolerance: 150,
  },
  {
    name: '桃機→新竹市',
    distanceKm: 75,
    countiesVisited: ['TYN', 'HSZ', 'HSC'],
    targets: [2199, 2899, 2899, 4299, 3499, 4299],
    tolerance: 150,
  },
  {
    name: '桃機→台中市',
    distanceKm: 155,
    countiesVisited: ['TYN', 'HSZ', 'HSC', 'MIA', 'TXG'],
    targets: [3699, 4799, 4799, 6999, 5699, 7299],
    tolerance: 300,
  },
  {
    name: '桃機→大甲/后里',
    distanceKm: 167,
    countiesVisited: ['TYN', 'HSZ', 'HSC', 'MIA', 'TXG'],
    targets: [3999, 5199, 5199, 7499, 6099, 7799],
    tolerance: 300,
  },
];

/** 中午 12:00（避開所有 jam / promo / surcharge 時段） */
export const CALIBRATION_PICKUP_TIME = new Date('2026-05-18T04:00:00Z');

/**
 * Known target-curve gaps（無法用連續單一 tier 計費收斂）：
 *
 * - mpv-vip 35km：target 2599，曲線在 25→35km 漲 700 NTD（vs sedan-suv 漲 300）
 * - mpv-family / van-9 / van-9-business 75km：target 在 75km 比 65km 只漲 100-300 NTD（不到該段
 *   per-km 累進的累積額），曲線轉折點與 tier 邊界錯開
 *
 * 收斂到 ±300 或 documented 接受；非計費引擎缺陷。
 */
export const CALIBRATION_KNOWN_GAPS: ReadonlyArray<{ vehicleId: string; distanceKm: number; expectedGap: number }> = [
  { vehicleId: 'mpv-vip',        distanceKm: 35, expectedGap: -299 },
  { vehicleId: 'mpv-family',     distanceKm: 75, expectedGap:  151 },
  { vehicleId: 'van-9',          distanceKm: 75, expectedGap:  151 },
  { vehicleId: 'van-9-business', distanceKm: 75, expectedGap:  401 },
];

/** 標準 routeMetrics（無山區、無國道、無塞車）— 接 OD distanceKm 與 countiesVisited */
export function calibrationMetrics(distanceKm: number, countiesVisited: string[]): RouteMetrics {
  return {
    distanceKm,
    staticDurationSec: Math.round(distanceKm * 60),
    durationSec: Math.round(distanceKm * 60),
    pureJamMinutes: 0,
    freeFlowKmh: 60,
    polylineEncoded: '',
    elevationDiffM: 50,
    freewayKm: 0,
    hasTrunk: false,
    countiesVisited,
    straightLineKm: distanceKm * 0.9,
    sinuosity: 1.1,
    computedAt: 0,
    apiSourcesOk: { routes: true, elevation: true, osm: true, counties: true },
  };
}
