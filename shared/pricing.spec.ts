import { describe, it, expect } from 'vitest';
import {
  calculateFare,
  calculateFareV2,
  computeMountainMul,
  computeJamFee,
  computeCrossCountyFee,
  computeFreewayToll,
  computeDistanceFee,
  computePromoDiscount,
  findActivePromoDiscount,
  computeSurcharge,
  findActiveSurcharge,
  buildTagSurchargeIndex,
  calcTagSurcharge,
  DEFAULT_FARE_RULES,
  type DistanceTierRule,
  type FareRules,
  type PromoRule,
  type SurchargeRule,
  type TrafficJamRule,
  type RouteMetrics,
  type TagSurchargeIndexEntry,
} from './pricing';

const SEDAN = { baseFare: 300, perKmRate: 25 };
const RULES = DEFAULT_FARE_RULES;

// 測試用日期（已驗證星期）：
const PEAK_MON_0800 = new Date('2026-05-18T00:00:00Z'); // 週一 08:00 台北（落 07:00-09:30）
const OFFPEAK_MON_1200 = new Date('2026-05-18T04:00:00Z'); // 週一 12:00 台北（非顛峰）
const WEEKEND_SUN_1200 = new Date('2026-05-17T04:00:00Z'); // 週日 12:00 台北

function metrics(over: Partial<RouteMetrics> = {}): RouteMetrics {
  return {
    distanceKm: 10,
    staticDurationSec: 600,
    durationSec: 600,
    pureJamMinutes: 0,
    freeFlowKmh: 60,
    polylineEncoded: '',
    elevationDiffM: 50,
    freewayKm: 0,
    hasTrunk: false,
    countiesVisited: ['TPE'],
    straightLineKm: 9.5,
    sinuosity: 1.05,
    computedAt: 0,
    apiSourcesOk: { routes: true, elevation: true, osm: true, counties: true },
    ...over,
  };
}

describe('computeMountainMul', () => {
  it('三訊號皆不達標 → 0 分 → 係數 1.0', () => {
    expect(computeMountainMul(metrics(), RULES.mountain)).toBe(1);
  });

  it('達 2 分 → 1.30；達 3 分 → 1.50', () => {
    const twoOfThree = metrics({ elevationDiffM: 500, sinuosity: 1.4, freeFlowKmh: 60 });
    expect(computeMountainMul(twoOfThree, RULES.mountain)).toBe(1.3);
    const allThree = metrics({ elevationDiffM: 500, sinuosity: 1.4, freeFlowKmh: 35 });
    expect(computeMountainMul(allThree, RULES.mountain)).toBe(1.5);
  });

  it('rule.enabled=false → 一律 1.0', () => {
    const allThree = metrics({ elevationDiffM: 500, sinuosity: 1.4, freeFlowKmh: 35 });
    expect(computeMountainMul(allThree, { ...RULES.mountain, enabled: false })).toBe(1);
  });

  it('降級：elevation 訊號取不到 → 該訊號 0 分（3 達標降為 2 → 1.30）', () => {
    const m = metrics({
      elevationDiffM: 500,
      sinuosity: 1.4,
      freeFlowKmh: 35,
      apiSourcesOk: { routes: true, elevation: false, osm: true, counties: true },
    });
    expect(computeMountainMul(m, RULES.mountain)).toBe(1.3);
  });
});

describe('computeJamFee', () => {
  it('顛峰時段 + 純塞車分鐘 → 分鐘 × 費率', () => {
    expect(computeJamFee(10, PEAK_MON_0800, RULES.trafficJam)).toBe(150);
  });

  it('非顛峰時段 → 0', () => {
    expect(computeJamFee(10, OFFPEAK_MON_1200, RULES.trafficJam)).toBe(0);
  });

  it('週末 weekendMode=OFF → 0', () => {
    expect(computeJamFee(10, WEEKEND_SUN_1200, RULES.trafficJam)).toBe(0);
  });

  it('純塞車分鐘 0 → 0', () => {
    expect(computeJamFee(0, PEAK_MON_0800, RULES.trafficJam)).toBe(0);
  });

  it('rule.enabled=false → 0', () => {
    expect(computeJamFee(10, PEAK_MON_0800, { ...RULES.trafficJam, enabled: false })).toBe(0);
  });

  it('週末 weekendMode=ALL_DAY → 收費', () => {
    expect(computeJamFee(10, WEEKEND_SUN_1200, { ...RULES.trafficJam, weekendMode: 'ALL_DAY' })).toBe(150);
  });
});

describe('computeCrossCountyFee', () => {
  it('單一縣市 → 0', () => {
    expect(computeCrossCountyFee(['TPE'], RULES.crossCounty)).toBe(0);
  });

  it('跨 1 縣市（非全北北桃）→ tieredNtd[0]', () => {
    expect(computeCrossCountyFee(['TYN', 'HSZ'], RULES.crossCounty)).toBe(200);
  });

  it('跨 2 縣市 → tieredNtd[0] + tieredNtd[1]', () => {
    expect(computeCrossCountyFee(['HSZ', 'MIA', 'TXG'], RULES.crossCounty)).toBe(550);
  });

  it('北北桃內互跨 + excludeTpeNtpeTyn → 0', () => {
    expect(computeCrossCountyFee(['TPE', 'NTPE', 'TYN'], RULES.crossCounty)).toBe(0);
  });

  it('含北北桃但跨出 → 照收', () => {
    expect(computeCrossCountyFee(['TPE', 'HSZ'], RULES.crossCounty)).toBe(200);
  });

  it('rule.enabled=false → 0', () => {
    expect(computeCrossCountyFee(['TYN', 'HSZ'], { ...RULES.crossCounty, enabled: false })).toBe(0);
  });
});

describe('computeFreewayToll', () => {
  it('里程未超過免費段 → 0', () => {
    expect(computeFreewayToll(15, RULES.freeway)).toBe(0);
  });

  it('超過免費段 → 計費里程 × 費率（四捨五入）', () => {
    // (30 - 20) × 1.2 = 12
    expect(computeFreewayToll(30, RULES.freeway)).toBe(12);
  });

  it('freewayKm 0 → 0', () => {
    expect(computeFreewayToll(0, RULES.freeway)).toBe(0);
  });

  it('rule.enabled=false → 0', () => {
    expect(computeFreewayToll(30, { ...RULES.freeway, enabled: false })).toBe(0);
  });
});

describe('computePromoDiscount / findActivePromoDiscount', () => {
  const promoRule: PromoRule = {
    enabled: true,
    windows: [
      { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '13:00', end: '16:00' },
      { days: ['MON'], start: '14:00', end: '15:00', discountNtd: 250 },
    ],
    weekendMode: 'OFF',
    defaultDiscountNtd: 100,
  };

  const PROMO_MON_1330 = new Date('2026-05-18T05:30:00Z'); // 週一 13:30 台北（只落第一段）
  const PROMO_MON_1400 = new Date('2026-05-18T06:00:00Z'); // 週一 14:00 台北（兩段同時命中）
  const OFFPROMO_MON_1000 = new Date('2026-05-18T02:00:00Z'); // 週一 10:00 台北（未命中）

  it('時段命中（未設 discountNtd）→ 用 defaultDiscountNtd', () => {
    expect(computePromoDiscount(PROMO_MON_1330, promoRule)).toBe(100);
  });

  it('多時段同時命中 → 取最大折扣', () => {
    expect(computePromoDiscount(PROMO_MON_1400, promoRule)).toBe(250);
  });

  it('未命中任何時段 → 0', () => {
    expect(computePromoDiscount(OFFPROMO_MON_1000, promoRule)).toBe(0);
  });

  it('rule.enabled=false → 0（即使時段命中）', () => {
    expect(computePromoDiscount(PROMO_MON_1400, { ...promoRule, enabled: false })).toBe(0);
  });

  it('per-window discountNtd 優先於 defaultDiscountNtd', () => {
    expect(findActivePromoDiscount(PROMO_MON_1330, promoRule)).toBe(100);
    expect(findActivePromoDiscount(PROMO_MON_1400, promoRule)).toBe(250);
  });

  it('邊界時間：start / end 為閉區間皆命中', () => {
    const atStart = new Date('2026-05-18T05:00:00Z'); // 週一 13:00 台北
    const atEnd = new Date('2026-05-18T08:00:00Z'); // 週一 16:00 台北
    expect(computePromoDiscount(atStart, promoRule)).toBe(100);
    expect(computePromoDiscount(atEnd, promoRule)).toBe(100);
  });

  it('週末 weekendMode=OFF → 0', () => {
    expect(computePromoDiscount(WEEKEND_SUN_1200, promoRule)).toBe(0);
  });

  it('週末 weekendMode=ALL_DAY → defaultDiscountNtd', () => {
    expect(computePromoDiscount(WEEKEND_SUN_1200, { ...promoRule, weekendMode: 'ALL_DAY' })).toBe(100);
  });
});

describe('computeSurcharge / findActiveSurcharge', () => {
  const surchargeRule: SurchargeRule = {
    enabled: true,
    windows: [
      { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '23:00', end: '23:59' },
      { days: ['MON'], start: '23:00', end: '23:30', surchargeNtd: 300 },
    ],
    weekendMode: 'OFF',
    defaultSurchargeNtd: 100,
  };

  const NIGHT_MON_2315 = new Date('2026-05-18T15:15:00Z'); // 週一 23:15 台北（兩段同時命中）
  const NIGHT_MON_2345 = new Date('2026-05-18T15:45:00Z'); // 週一 23:45 台北（只落第一段）
  const DAY_MON_1000 = new Date('2026-05-18T02:00:00Z'); // 週一 10:00 台北（未命中）

  it('時段命中（未設 surchargeNtd）→ 用 defaultSurchargeNtd', () => {
    expect(computeSurcharge(NIGHT_MON_2345, surchargeRule)).toBe(100);
  });

  it('多時段同時命中 → 取最大加價', () => {
    expect(computeSurcharge(NIGHT_MON_2315, surchargeRule)).toBe(300);
  });

  it('未命中任何時段 → 0', () => {
    expect(computeSurcharge(DAY_MON_1000, surchargeRule)).toBe(0);
  });

  it('rule.enabled=false → 0（即使時段命中）', () => {
    expect(computeSurcharge(NIGHT_MON_2315, { ...surchargeRule, enabled: false })).toBe(0);
  });

  it('per-window surchargeNtd 優先於 defaultSurchargeNtd', () => {
    expect(findActiveSurcharge(NIGHT_MON_2345, surchargeRule)).toBe(100);
    expect(findActiveSurcharge(NIGHT_MON_2315, surchargeRule)).toBe(300);
  });

  it('週末 weekendMode=OFF → 0', () => {
    expect(computeSurcharge(WEEKEND_SUN_1200, surchargeRule)).toBe(0);
  });

  it('週末 weekendMode=ALL_DAY → defaultSurchargeNtd', () => {
    expect(computeSurcharge(WEEKEND_SUN_1200, { ...surchargeRule, weekendMode: 'ALL_DAY' })).toBe(100);
  });
});

describe('orderType 行程過濾', () => {
  const MON_1400 = new Date('2026-05-18T06:00:00Z'); // 週一 14:00 台北

  it('window 未設 orderTypes → 套用全部行程（含 orderType 為 null）', () => {
    const rule: SurchargeRule = {
      enabled: true,
      windows: [{ days: ['MON'], start: '13:00', end: '16:00', surchargeNtd: 100 }],
      weekendMode: 'OFF',
      defaultSurchargeNtd: 100,
    };
    expect(computeSurcharge(MON_1400, rule, 'charter')).toBe(100);
    expect(computeSurcharge(MON_1400, rule, 'airport-pickup')).toBe(100);
    expect(computeSurcharge(MON_1400, rule, null)).toBe(100);
  });

  it('window 設 orderTypes → 僅清單內行程命中', () => {
    const rule: SurchargeRule = {
      enabled: true,
      windows: [
        { days: ['MON'], start: '13:00', end: '16:00', surchargeNtd: 100, orderTypes: ['airport-pickup'] },
      ],
      weekendMode: 'OFF',
      defaultSurchargeNtd: 100,
    };
    expect(computeSurcharge(MON_1400, rule, 'airport-pickup')).toBe(100);
    expect(computeSurcharge(MON_1400, rule, 'charter')).toBe(0);
    // 有行程過濾但 orderType 為 null → 視為不符
    expect(computeSurcharge(MON_1400, rule, null)).toBe(0);
  });

  it('優惠時段與顛峰塞車費同樣套用行程過濾', () => {
    const promo: PromoRule = {
      enabled: true,
      windows: [{ days: ['MON'], start: '13:00', end: '16:00', discountNtd: 50, orderTypes: ['charter'] }],
      weekendMode: 'OFF',
      defaultDiscountNtd: 50,
    };
    expect(computePromoDiscount(MON_1400, promo, 'charter')).toBe(50);
    expect(computePromoDiscount(MON_1400, promo, 'transfer')).toBe(0);

    const jam: TrafficJamRule = {
      enabled: true,
      peakWindows: [{ days: ['MON'], start: '13:00', end: '16:00', ntdPerMinute: 10, orderTypes: ['charter'] }],
      weekendMode: 'OFF',
      defaultNtdPerMinute: 10,
    };
    expect(computeJamFee(5, MON_1400, jam, 'charter')).toBe(50);
    expect(computeJamFee(5, MON_1400, jam, 'transfer')).toBe(0);
  });

  it('多 window 命中、行程過濾後 → 取符合行程者的最大值', () => {
    const rule: SurchargeRule = {
      enabled: true,
      windows: [
        { days: ['MON'], start: '13:00', end: '16:00', surchargeNtd: 100, orderTypes: ['airport-pickup'] },
        { days: ['MON'], start: '13:00', end: '16:00', surchargeNtd: 300, orderTypes: ['charter'] },
      ],
      weekendMode: 'OFF',
      defaultSurchargeNtd: 100,
    };
    expect(computeSurcharge(MON_1400, rule, 'airport-pickup')).toBe(100);
    expect(computeSurcharge(MON_1400, rule, 'charter')).toBe(300);
  });

  it('calculateFareV2 帶 orderType → 行程過濾生效', () => {
    const rules: FareRules = {
      ...RULES,
      surcharge: {
        enabled: true,
        windows: [
          {
            days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
            start: '13:00',
            end: '16:00',
            surchargeNtd: 200,
            orderTypes: ['airport-pickup'],
          },
        ],
        weekendMode: 'OFF',
        defaultSurchargeNtd: 100,
      },
    };
    const m = metrics({ distanceKm: 10 });
    expect(calculateFareV2(SEDAN, m, MON_1400, [], rules, 'airport-pickup').surcharge).toBe(200);
    expect(calculateFareV2(SEDAN, m, MON_1400, [], rules, 'charter').surcharge).toBe(0);
  });
});

describe('calculateFare（v1 fallback）— 同步套 distanceTier + 起跳費 floor', () => {
  it('短程 distanceFee < baseFare → 以起跳費計，再進位 50', () => {
    // 5 km × 25 = 125 < 300 → chargedDistanceFee = 300
    // 300 + 0 extras = 300 → 進位 → 300
    expect(calculateFare(SEDAN, 5, [])).toBe(300);
  });

  it('長程 distanceFee ≥ baseFare → 以里程費計（tier 折扣套用，不再雙計 baseFare）', () => {
    // 40 km tier-applied = 900；max(300, 900) = 900；900 + 0 extras = 900 → 進位 → 900
    expect(calculateFare(SEDAN, 40, [])).toBe(900);
  });

  it('帶 extras → 累加後一次進位', () => {
    // 5 km：chargedDistanceFee = 300；extras = 200 + 200 = 400；300+400 = 700 → 進位 → 700
    expect(calculateFare(SEDAN, 5, [{ price: 200 }, { price: 200 }])).toBe(700);
  });

  it('帶自訂 rules（disabled tier + rounding 10）→ 套客製設定', () => {
    const customRules = {
      distanceTier: { enabled: false, tiers: [{ fromKm: 0, discountPct: 0 }] },
      rounding: 10,
    };
    // tier disabled → distanceFee = 40 × 25 = 1000；max(300, 1000) = 1000；進位 10 → 1000
    expect(calculateFare(SEDAN, 40, [], customRules)).toBe(1000);
  });

  it('未傳 rules → 套 DEFAULT_FARE_RULES（向後相容）', () => {
    // 與「長程 40 km」同結果
    expect(calculateFare(SEDAN, 40, [])).toBe(900);
  });
});

describe('computeDistanceFee — 里程分段累進折扣', () => {
  const DEFAULT_TIER = DEFAULT_FARE_RULES.distanceTier;

  it('disabled → 回退 distanceKm × perKmRate', () => {
    expect(computeDistanceFee(40, 25, { ...DEFAULT_TIER, enabled: false })).toBe(1000);
  });

  it('distanceKm = 0 → 0', () => {
    expect(computeDistanceFee(0, 25, DEFAULT_TIER)).toBe(0);
  });

  it('全程落在第一段（0–10km，0 折扣）→ 等於原 km×rate', () => {
    expect(computeDistanceFee(8, 25, DEFAULT_TIER)).toBe(200);
    expect(computeDistanceFee(10, 25, DEFAULT_TIER)).toBe(250);
  });

  it('跨第一第二段（10–30km，9 折）— 分段累加', () => {
    // 10×25×1 + 10×25×0.9 = 250 + 225 = 475
    expect(computeDistanceFee(20, 25, DEFAULT_TIER)).toBe(475);
  });

  it('跨三段（30+km，8 折）— 預設情境', () => {
    // 10×25×1 + 20×25×0.9 + 10×25×0.8 = 250 + 450 + 200 = 900
    expect(computeDistanceFee(40, 25, DEFAULT_TIER)).toBe(900);
    // 70km：10×25 + 20×25×0.9 + 40×25×0.8 = 250 + 450 + 800 = 1500
    expect(computeDistanceFee(70, 25, DEFAULT_TIER)).toBe(1500);
  });

  it('tiers 空陣列 → 退回 flat 公式', () => {
    expect(computeDistanceFee(40, 25, { enabled: true, tiers: [] })).toBe(1000);
  });

  it('單一段（無折扣）→ 等同 flat', () => {
    const oneTier: DistanceTierRule = {
      enabled: true,
      tiers: [{ fromKm: 0, discountPct: 0 }],
    };
    expect(computeDistanceFee(40, 25, oneTier)).toBe(1000);
  });

  it('單一段（30% 折扣）→ 整段套同一折扣', () => {
    const oneTier: DistanceTierRule = {
      enabled: true,
      tiers: [{ fromKm: 0, discountPct: 30 }],
    };
    // 40 × 25 × 0.7 = 700
    expect(computeDistanceFee(40, 25, oneTier)).toBe(700);
  });

  it('perKmRate = 0 → 0', () => {
    expect(computeDistanceFee(40, 0, DEFAULT_TIER)).toBe(0);
  });

  it('tiers 順序錯亂 → 內部自動排序', () => {
    const messy: DistanceTierRule = {
      enabled: true,
      tiers: [
        { fromKm: 30, discountPct: 20 },
        { fromKm: 0,  discountPct: 0 },
        { fromKm: 10, discountPct: 10 },
      ],
    };
    expect(computeDistanceFee(40, 25, messy)).toBe(900);
  });

  it('折扣 100% → 該段全免', () => {
    const freeMiddle: DistanceTierRule = {
      enabled: true,
      tiers: [
        { fromKm: 0,  discountPct: 0 },
        { fromKm: 10, discountPct: 100 },
        { fromKm: 30, discountPct: 0 },
      ],
    };
    // 10×25 + 20×25×0 + 10×25 = 250 + 0 + 250 = 500
    expect(computeDistanceFee(40, 25, freeMiddle)).toBe(500);
  });
});

describe('calculateFareV2 — 代表情境', () => {
  it('短程：里程費 < 起跳費 → 起跳費 floor 生效（chargedDistanceFee = baseFare）', () => {
    const b = calculateFareV2(SEDAN, metrics({ distanceKm: 10 }), OFFPEAK_MON_1200, [], RULES);
    // distanceFee = 10×25 = 250；< baseFare 300 → chargedDistanceFee = 300
    expect(b.distanceFee).toBe(250);
    expect(b.chargedDistanceFee).toBe(300);
    expect(b.mountainMul).toBe(1);
    expect(b.jamFee).toBe(0);
    expect(b.crossCountyFee).toBe(0);
    expect(b.freewayToll).toBe(0);
    // raw = 300×1 + 0 + 0 = 300（baseFare 不再單獨加）→ 進位 → 300
    expect(b.raw).toBe(300);
    expect(b.final).toBe(300);
  });

  it('跨縣市 + 國道：里程費 > 起跳費 → 用里程費（不雙計）+ 跨縣市補貼 + 國道通行費', () => {
    const m = metrics({ distanceKm: 40, freewayKm: 30, countiesVisited: ['TYN', 'HSZ'] });
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, [], RULES);
    expect(b.crossCountyFee).toBe(200);
    expect(b.freewayToll).toBe(12);
    expect(b.mountainMul).toBe(1);
    // distanceFee = 10×25×1 + 20×25×0.9 + 10×25×0.8 = 250 + 450 + 200 = 900
    expect(b.distanceFee).toBe(900);
    // chargedDistanceFee = max(300, 900) = 900
    expect(b.chargedDistanceFee).toBe(900);
    // 900×1 + 200 + 12 = 1112 → 進位 50 → 1150
    expect(b.raw).toBe(1112);
    expect(b.final).toBe(1150);
  });

  it('山區路線：三訊號達標 → mountainMul 1.5，套在 chargedDistanceFee+jamFee 上', () => {
    const m = metrics({
      distanceKm: 70,
      elevationDiffM: 500,
      sinuosity: 1.4,
      freeFlowKmh: 35,
      countiesVisited: ['NAN'],
    });
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, [], RULES);
    expect(b.mountainMul).toBe(1.5);
    // distanceFee = 1500；chargedDistanceFee = max(300, 1500) = 1500
    expect(b.distanceFee).toBe(1500);
    expect(b.chargedDistanceFee).toBe(1500);
    // variableScaled = 1500×1.5 = 2250；raw = 2250（無 baseFare 加總）→ 進位 → 2250
    expect(b.variableScaled).toBe(2250);
    expect(b.raw).toBe(2250);
    expect(b.final).toBe(2250);
  });

  it('顛峰時段：jamFee 觸發，且 jamFee 參與山區係數放大', () => {
    const m = metrics({ distanceKm: 20, pureJamMinutes: 10 });
    const b = calculateFareV2(SEDAN, m, PEAK_MON_0800, [], RULES);
    expect(b.jamFee).toBe(150);
    // distanceFee = 10×25 + 10×25×0.9 = 250 + 225 = 475；chargedDistanceFee = max(300, 475) = 475
    expect(b.distanceFee).toBe(475);
    expect(b.chargedDistanceFee).toBe(475);
    // (475 + 150)×1 = 625 → 進位 → 650
    expect(b.raw).toBe(625);
    expect(b.final).toBe(650);
  });

  it('加值服務不被山區係數放大，加在最後', () => {
    const m = metrics({ distanceKm: 70, elevationDiffM: 500, sinuosity: 1.4, freeFlowKmh: 35 });
    const extras = [{ price: 200 }, { price: 200 }];
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, extras, RULES);
    expect(b.extrasSum).toBe(400);
    // chargedDistanceFee = 1500；1500×1.5 + 400 = 2650 → 進位 → 2650
    expect(b.raw).toBe(2650);
    expect(b.final).toBe(2650);
  });

  it('優惠時段：promoDiscount 平面折抵，不被山區係數連乘', () => {
    const rulesWithPromo: FareRules = {
      ...RULES,
      promo: {
        enabled: true,
        windows: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '13:00', end: '16:00', discountNtd: 200 }],
        weekendMode: 'OFF',
        defaultDiscountNtd: 100,
      },
    };
    const m = metrics({ distanceKm: 70, elevationDiffM: 500, sinuosity: 1.4, freeFlowKmh: 35 });
    const b = calculateFareV2(SEDAN, m, new Date('2026-05-18T06:00:00Z'), [], rulesWithPromo);
    expect(b.promoDiscount).toBe(200);
    // chargedDistanceFee = 1500；1500×1.5 − 200 = 2050 → 進位 → 2050
    expect(b.variableScaled).toBe(2250);
    expect(b.raw).toBe(2050);
    expect(b.final).toBe(2050);
  });

  it('折抵大於車資 → final 鎖 0（不為負）', () => {
    const rulesWithBigPromo: FareRules = {
      ...RULES,
      promo: {
        enabled: true,
        windows: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '13:00', end: '16:00', discountNtd: 99999 }],
        weekendMode: 'OFF',
        defaultDiscountNtd: 100,
      },
    };
    const b = calculateFareV2(SEDAN, metrics({ distanceKm: 10 }), new Date('2026-05-18T06:00:00Z'), [], rulesWithBigPromo);
    expect(b.raw).toBeLessThan(0);
    expect(b.final).toBe(0);
  });

  it('時段加價：surcharge 平面加成，不被山區係數連乘', () => {
    const rulesWithSurcharge: FareRules = {
      ...RULES,
      surcharge: {
        enabled: true,
        windows: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '13:00', end: '16:00', surchargeNtd: 200 }],
        weekendMode: 'OFF',
        defaultSurchargeNtd: 100,
      },
    };
    const m = metrics({ distanceKm: 70, elevationDiffM: 500, sinuosity: 1.4, freeFlowKmh: 35 });
    const b = calculateFareV2(SEDAN, m, new Date('2026-05-18T06:00:00Z'), [], rulesWithSurcharge);
    expect(b.surcharge).toBe(200);
    // chargedDistanceFee = 1500；1500×1.5 + 200 = 2450 → 進位 → 2450
    expect(b.variableScaled).toBe(2250);
    expect(b.raw).toBe(2450);
    expect(b.final).toBe(2450);
  });

  it('時段加價與優惠折抵同時生效：先加價後折抵', () => {
    const rules: FareRules = {
      ...RULES,
      surcharge: {
        enabled: true,
        windows: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '13:00', end: '16:00', surchargeNtd: 200 }],
        weekendMode: 'OFF',
        defaultSurchargeNtd: 100,
      },
      promo: {
        enabled: true,
        windows: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '13:00', end: '16:00', discountNtd: 80 }],
        weekendMode: 'OFF',
        defaultDiscountNtd: 100,
      },
    };
    const b = calculateFareV2(SEDAN, metrics({ distanceKm: 10 }), new Date('2026-05-18T06:00:00Z'), [], rules);
    expect(b.surcharge).toBe(200);
    expect(b.promoDiscount).toBe(80);
    // distanceFee=250 < baseFare 300 → chargedDistanceFee=300；300 + 200 − 80 = 420 → 進位 → 450
    expect(b.chargedDistanceFee).toBe(300);
    expect(b.raw).toBe(420);
    expect(b.final).toBe(450);
  });

  it('起跳費 floor — 邊界：里程費接近但低於起跳費 → 仍以起跳費計', () => {
    // 12 km 含 tier：10×25 + 2×25×0.9 = 250 + 45 = 295 < baseFare 300
    const b = calculateFareV2(SEDAN, metrics({ distanceKm: 12 }), OFFPEAK_MON_1200, [], RULES);
    expect(b.distanceFee).toBe(295);
    expect(b.chargedDistanceFee).toBe(300);
    expect(b.raw).toBe(300);
    expect(b.final).toBe(300);
  });

  it('起跳費 floor — 長程：里程費遠大於起跳費 → chargedDistanceFee = 里程費（不重複加 base）', () => {
    // 40 km tier-applied = 900；max(300, 900) = 900
    const b = calculateFareV2(SEDAN, metrics({ distanceKm: 40 }), OFFPEAK_MON_1200, [], RULES);
    expect(b.chargedDistanceFee).toBe(900);
    expect(b.raw).toBe(900); // 沒有其他費用 → raw = chargedDistanceFee
    expect(b.final).toBe(900);
  });

  it('起跳費 floor — 短程：里程費 < 起跳費 → 以起跳費計', () => {
    // 5 km × 25 = 125；max(300, 125) = 300
    const b = calculateFareV2(SEDAN, metrics({ distanceKm: 5 }), OFFPEAK_MON_1200, [], RULES);
    expect(b.distanceFee).toBe(125);
    expect(b.chargedDistanceFee).toBe(300);
    expect(b.raw).toBe(300);
    expect(b.final).toBe(300);
  });

  it('起跳費 floor 與山區係數互動：mountainMul 作用於 chargedDistanceFee（不雙重加 baseFare）', () => {
    // 5 km × 25 = 125 < 300；chargedDistanceFee = 300；山區 1.5
    const m = metrics({
      distanceKm: 5,
      elevationDiffM: 500,
      sinuosity: 1.4,
      freeFlowKmh: 35,
    });
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, [], RULES);
    expect(b.mountainMul).toBe(1.5);
    expect(b.chargedDistanceFee).toBe(300);
    // raw = 300×1.5 = 450
    expect(b.raw).toBe(450);
    expect(b.final).toBe(450);
  });

  it('失敗降級：apiSourcesOk.routes=false → freeFlow 訊號歸 0（3 達標降 2 → 1.3）', () => {
    const m = metrics({
      distanceKm: 70,
      elevationDiffM: 500,
      sinuosity: 1.4,
      freeFlowKmh: 35,
      apiSourcesOk: { routes: false, elevation: true, osm: true, counties: true },
    });
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, [], RULES);
    expect(b.mountainMul).toBe(1.3);
  });
});

// =============================================================================
// Phase 1D — calcTagSurcharge / buildTagSurchargeIndex（max 邏輯）
// =============================================================================

const TAG_INDEX_ENTRIES: TagSurchargeIndexEntry[] = [
  { id: 't-power-ev',       group: 'power',       scope: 'vehicle', surchargeAmount: 100, status: 'active' },
  { id: 't-power-hybrid',   group: 'power',       scope: 'vehicle', surchargeAmount: 50,  status: 'active' },
  { id: 't-int-captain',    group: 'interior',    scope: 'vehicle', surchargeAmount: 300, status: 'active' },
  { id: 't-int-leather',    group: 'interior',    scope: 'vehicle', surchargeAmount: 200, status: 'active' },
  { id: 't-eq-childseat',   group: 'equipment',   scope: 'vehicle', surchargeAmount: 150, status: 'active' },
  { id: 't-power-archived', group: 'power',       scope: 'vehicle', surchargeAmount: 500, status: 'archived' },
  { id: 't-driver-en',      group: 'driverSkill', scope: 'driver',  surchargeAmount: 999, status: 'active' },
];

describe('buildTagSurchargeIndex + calcTagSurcharge', () => {
  const INDEX = buildTagSurchargeIndex(TAG_INDEX_ENTRIES);

  it('空陣列 → surcharge=0、matched=[]、invalid=[]', () => {
    expect(calcTagSurcharge([], INDEX)).toEqual({ surcharge: 0, matchedTagIds: [], invalidTagIds: [] });
  });

  it('單一有效 → surcharge=該值', () => {
    expect(calcTagSurcharge(['t-power-ev'], INDEX)).toEqual({
      surcharge: 100,
      matchedTagIds: ['t-power-ev'],
      invalidTagIds: [],
    });
  });

  it('多個有效 → surcharge=max（300 > 100）', () => {
    const r = calcTagSurcharge(['t-power-ev', 't-int-captain', 't-eq-childseat'], INDEX);
    expect(r.surcharge).toBe(300);
    expect(r.matchedTagIds).toEqual(['t-power-ev', 't-int-captain', 't-eq-childseat']);
    expect(r.invalidTagIds).toEqual([]);
  });

  it('含 archived → archived 入 invalid，surcharge 用剩下的', () => {
    const r = calcTagSurcharge(['t-power-archived', 't-power-ev'], INDEX);
    expect(r.surcharge).toBe(100);
    expect(r.matchedTagIds).toEqual(['t-power-ev']);
    expect(r.invalidTagIds).toEqual(['t-power-archived']);
  });

  it('含 scope=driver → driver 入 invalid（max 999 不計入）', () => {
    const r = calcTagSurcharge(['t-driver-en', 't-int-captain'], INDEX);
    expect(r.surcharge).toBe(300);
    expect(r.matchedTagIds).toEqual(['t-int-captain']);
    expect(r.invalidTagIds).toEqual(['t-driver-en']);
  });

  it('不存在 id → 入 invalid', () => {
    const r = calcTagSurcharge(['t-unknown', 't-int-leather'], INDEX);
    expect(r.surcharge).toBe(200);
    expect(r.matchedTagIds).toEqual(['t-int-leather']);
    expect(r.invalidTagIds).toEqual(['t-unknown']);
  });

  it('全部無效 → surcharge=0、matched=[]、invalid=[全部]', () => {
    const r = calcTagSurcharge(['t-unknown-a', 't-power-archived', 't-driver-en'], INDEX);
    expect(r.surcharge).toBe(0);
    expect(r.matchedTagIds).toEqual([]);
    expect(r.invalidTagIds).toEqual(['t-unknown-a', 't-power-archived', 't-driver-en']);
  });

  it('buildTagSurchargeIndex 忽略空 id', () => {
    const m = buildTagSurchargeIndex([
      { id: '', group: 'power', scope: 'vehicle', surchargeAmount: 1, status: 'active' },
      { id: 't-ok', group: 'power', scope: 'vehicle', surchargeAmount: 2, status: 'active' },
    ]);
    expect(m.size).toBe(1);
    expect(m.has('t-ok')).toBe(true);
  });

  // ─── Phase 1G 邊界補強 ─────────────────────────────────────
  it('Phase 1G — 所有 selected 都 archived → surcharge=0 / matched=[] / 全進 invalid', () => {
    const allArchived = buildTagSurchargeIndex([
      { id: 't-a1', group: 'power',    scope: 'vehicle', surchargeAmount: 100, status: 'archived' },
      { id: 't-a2', group: 'interior', scope: 'vehicle', surchargeAmount: 999, status: 'archived' },
    ]);
    const r = calcTagSurcharge(['t-a1', 't-a2'], allArchived);
    expect(r.surcharge).toBe(0);
    expect(r.matchedTagIds).toEqual([]);
    expect(r.invalidTagIds).toEqual(['t-a1', 't-a2']);
  });

  it('Phase 1G — surcharge 全 0 → max 取 0（無人加價但仍命中）', () => {
    const allZero = buildTagSurchargeIndex([
      { id: 't-z1', group: 'power',     scope: 'vehicle', surchargeAmount: 0, status: 'active' },
      { id: 't-z2', group: 'interior',  scope: 'vehicle', surchargeAmount: 0, status: 'active' },
    ]);
    const r = calcTagSurcharge(['t-z1', 't-z2'], allZero);
    expect(r.surcharge).toBe(0);
    expect(r.matchedTagIds).toEqual(['t-z1', 't-z2']);
    expect(r.invalidTagIds).toEqual([]);
  });

  it('Phase 1G — 重複 id 算兩次 → matched 列兩次（呼叫端責任去重），max 不變', () => {
    const r = calcTagSurcharge(['t-power-ev', 't-power-ev'], INDEX);
    expect(r.surcharge).toBe(100);
    expect(r.matchedTagIds).toEqual(['t-power-ev', 't-power-ev']);
    expect(r.invalidTagIds).toEqual([]);
  });

  it('Phase 1G — selectedTagIds 含非字串（null/number/object）→ 全進 invalid', () => {
    // @ts-expect-error 模擬 server 端拿到 firestore array 含意外型別
    const r = calcTagSurcharge([null, 123, { foo: 1 }, ''], INDEX);
    expect(r.surcharge).toBe(0);
    expect(r.matchedTagIds).toEqual([]);
    expect(r.invalidTagIds).toEqual(['null', '123', '[object Object]', '']);
  });

  it('Phase 1G — buildTagSurchargeIndex 後者覆蓋前者（同 id 二筆）', () => {
    const m = buildTagSurchargeIndex([
      { id: 't-x', group: 'power', scope: 'vehicle', surchargeAmount: 50,  status: 'active' },
      { id: 't-x', group: 'power', scope: 'vehicle', surchargeAmount: 200, status: 'active' },
    ]);
    expect(m.size).toBe(1);
    expect(m.get('t-x')?.surchargeAmount).toBe(200);
  });

  it('Phase 1G — driver-scope + vehicle-scope mix → driver-scope 即使 active 也算 invalid', () => {
    const r = calcTagSurcharge(['t-driver-en', 't-power-ev', 't-int-leather'], INDEX);
    expect(r.surcharge).toBe(200); // max(100, 200)
    expect(r.matchedTagIds).toEqual(['t-power-ev', 't-int-leather']);
    expect(r.invalidTagIds).toEqual(['t-driver-en']);
  });
});
