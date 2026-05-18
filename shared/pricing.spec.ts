import { describe, it, expect } from 'vitest';
import {
  calculateFare,
  calculateFareV2,
  computeMountainMul,
  computeJamFee,
  computeCrossCountyFee,
  computeFreewayToll,
  computePromoDiscount,
  findActivePromoDiscount,
  computeSurcharge,
  findActiveSurcharge,
  DEFAULT_FARE_RULES,
  type FareRules,
  type PromoRule,
  type SurchargeRule,
  type TrafficJamRule,
  type RouteMetrics,
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

describe('calculateFareV2 — 代表情境', () => {
  it('純市區短程：無山區/國道/跨縣市 → 與 v1 公式等價', () => {
    const b = calculateFareV2(SEDAN, metrics({ distanceKm: 10 }), OFFPEAK_MON_1200, [], RULES);
    expect(b.final).toBe(550);
    expect(b.final).toBe(calculateFare(SEDAN, 10, []));
    expect(b.mountainMul).toBe(1);
    expect(b.jamFee).toBe(0);
    expect(b.crossCountyFee).toBe(0);
    expect(b.freewayToll).toBe(0);
  });

  it('跨縣市 + 國道：v1 里程費 + 跨縣市補貼 + 國道通行費', () => {
    const m = metrics({ distanceKm: 40, freewayKm: 30, countiesVisited: ['TYN', 'HSZ'] });
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, [], RULES);
    expect(b.crossCountyFee).toBe(200);
    expect(b.freewayToll).toBe(12);
    expect(b.mountainMul).toBe(1);
    // 300 + (40×25)×1 + 200 + 12 = 1512 → 進位 50 → 1550
    expect(b.raw).toBe(1512);
    expect(b.final).toBe(1550);
  });

  it('山區路線：三訊號達標 → mountainMul 1.5，且只乘 distanceFee+jamFee', () => {
    const m = metrics({
      distanceKm: 70,
      elevationDiffM: 500,
      sinuosity: 1.4,
      freeFlowKmh: 35,
      countiesVisited: ['NAN'],
    });
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, [], RULES);
    expect(b.mountainMul).toBe(1.5);
    // 300 + (70×25)×1.5 = 300 + 2625 = 2925 → 進位 → 2950
    expect(b.variableScaled).toBe(2625);
    expect(b.raw).toBe(2925);
    expect(b.final).toBe(2950);
  });

  it('顛峰時段：jamFee 觸發，且 jamFee 參與山區係數放大', () => {
    const m = metrics({ distanceKm: 20, pureJamMinutes: 10 });
    const b = calculateFareV2(SEDAN, m, PEAK_MON_0800, [], RULES);
    expect(b.jamFee).toBe(150);
    // 300 + (20×25 + 150)×1 = 950
    expect(b.raw).toBe(950);
    expect(b.final).toBe(950);
  });

  it('加值服務不被山區係數放大，加在最後', () => {
    const m = metrics({ distanceKm: 70, elevationDiffM: 500, sinuosity: 1.4, freeFlowKmh: 35 });
    const extras = [{ price: 200 }, { price: 200 }];
    const b = calculateFareV2(SEDAN, m, OFFPEAK_MON_1200, extras, RULES);
    expect(b.extrasSum).toBe(400);
    // 300 + 2625 + 0 + 0 + 400 = 3325 → 進位 → 3350
    expect(b.raw).toBe(3325);
    expect(b.final).toBe(3350);
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
    // 300 + (70×25)×1.5 − 200 = 2725 → 進位 → 2750
    expect(b.variableScaled).toBe(2625);
    expect(b.raw).toBe(2725);
    expect(b.final).toBe(2750);
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
    // 300 + (70×25)×1.5 + 200 = 300 + 2625 + 200 = 3125 → 進位 → 3150
    expect(b.variableScaled).toBe(2625);
    expect(b.raw).toBe(3125);
    expect(b.final).toBe(3150);
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
    // 300 + (10×25)×1 + 200 − 80 = 670 → 進位 → 700
    expect(b.raw).toBe(670);
    expect(b.final).toBe(700);
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
