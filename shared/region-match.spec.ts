/**
 * shared/region-match 單元測試。
 *
 * 覆蓋三類場景：
 *  1. 舊訂單無 city → fallback 用 address contains
 *  2. 新訂單 city='臺北市'（Google 寫的「臺」），selector value='台北市'（locations-taiwan id）→ alias match
 *  3. district fallback + __unknown__ bucket
 */
import { describe, it, expect } from 'vitest';
import { matchRegion } from './region-match';

const ALL_CITIES = [
  '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
  '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
  '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '台東縣', '澎湖縣', '金門縣', '連江縣',
];

// Phase 1 之前的舊訂單（無 city/district）
const OLD_TAIPEI_PICKUP = {
  address: '100台灣臺北市中正區黎明里北平西路1號',
  displayName: '台北車站西三門接送區',
};
const OLD_TAOYUAN_DROPOFF = {
  address: '337台灣桃園市大園區第二航廈',
  displayName: '第二航廈',
};
const OLD_NEWTAIPEI_DROPOFF = {
  address: '220台灣新北市板橋區溪頭里江子翠',
  displayName: '江子翠',
};

// Phase 1 之後的新訂單（含 city/district，Google long_name 用「臺」字）
const NEW_TAIPEI_PICKUP = {
  address: '100台灣臺北市中正區黎明里北平西路1號',
  city: '臺北市',
  district: '中正區',
};

describe('matchRegion — 舊訂單 fallback (no city field, use address contains)', () => {
  it('selector 「台北市」 → 舊單 address 含「臺北市」→ alias match 通過', () => {
    const ok = matchRegion({
      pickup: OLD_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['台北市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });

  it('selector 「桃園市」 → 舊單 pickup 是台北 → 不通過', () => {
    const ok = matchRegion({
      pickup: OLD_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['桃園市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(false);
  });

  it('regionField=dropoff + selector 「桃園市」 → 通過', () => {
    const ok = matchRegion({
      pickup: OLD_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'dropoff',
      cities: new Set(['桃園市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });

  it('selector 多選「台北市,新北市」(OR) → 訂單上車是台北 → 通過', () => {
    const ok = matchRegion({
      pickup: OLD_TAIPEI_PICKUP,
      dropoff: OLD_NEWTAIPEI_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['台北市', '新北市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });
});

describe('matchRegion — 新訂單 city alias match', () => {
  it('doc city=「臺北市」 + selector value=「台北市」 → alias 通過', () => {
    const ok = matchRegion({
      pickup: NEW_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['台北市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });

  it('doc city=「臺北市」 + selector value=「臺北市」 → 同字也通過', () => {
    const ok = matchRegion({
      pickup: NEW_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['臺北市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });

  it('doc city=「臺北市」 + selector 選「桃園市」 → 不通過', () => {
    const ok = matchRegion({
      pickup: NEW_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['桃園市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(false);
  });
});

describe('matchRegion — district', () => {
  it('city + district 一起選 (AND)：city 過但 district 不過 → 拒', () => {
    const ok = matchRegion({
      pickup: NEW_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['台北市']),
      districts: new Set(['信義區']),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(false);
  });

  it('city + district 一起選 (AND)：都過 → 通過', () => {
    const ok = matchRegion({
      pickup: NEW_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['台北市']),
      districts: new Set(['中正區']),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });

  it('district fallback：舊單無 district，address 含「中正區」→ 通過', () => {
    const ok = matchRegion({
      pickup: OLD_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['台北市']),
      districts: new Set(['中正區']),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });
});

describe('matchRegion — __unknown__ bucket', () => {
  it('doc city 空 + address 不含任何 city 名稱 → __unknown__ 通過', () => {
    const ok = matchRegion({
      pickup: { address: '某不明地址 12345' },
      dropoff: { address: '另一個' },
      regionField: 'pickup',
      cities: new Set(['__unknown__']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });

  it('doc city 空但 address 含「臺北市」→ __unknown__ 不通過（已可被「台北市」filter 認領）', () => {
    const ok = matchRegion({
      pickup: OLD_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(['__unknown__']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(false);
  });
});

describe('matchRegion — 邊界', () => {
  it('cities + districts 都空 → 一律通過', () => {
    const ok = matchRegion({
      pickup: OLD_TAIPEI_PICKUP,
      dropoff: OLD_TAOYUAN_DROPOFF,
      regionField: 'pickup',
      cities: new Set(),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(true);
  });

  it('pickup / dropoff 都 undefined → city filter 必拒', () => {
    const ok = matchRegion({
      pickup: undefined,
      dropoff: undefined,
      regionField: 'pickup',
      cities: new Set(['台北市']),
      districts: new Set(),
      allSelectableCityNames: ALL_CITIES,
    });
    expect(ok).toBe(false);
  });
});
