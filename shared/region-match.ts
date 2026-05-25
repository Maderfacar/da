/**
 * 訂單縣市 / 行政區 filter helper（admin/orders + driver/dispatched 共用）。
 *
 * 解決兩個 bug：
 *  1. 舊訂單無 city/district 欄位 → fallback 用 location.address 字串 contains 比對
 *  2. 「台 / 臺」字歧義：locations-taiwan.ts id 用「台」字（如「台北市」），
 *     但 Google administrative_area_level_1 long_name 用「臺」字（如「臺北市」）
 *     → 雙寫法 alias 同時比對
 *
 * `__unknown__` bucket 保留給 selector 主動勾選「未知」時（doc 無 city 且 address 也不含任何 city 名）。
 */

/** 台 ↔ 臺 雙寫法 alias map（單向皆收錄，查表 O(1)） */
const CITY_ALIASES: Record<string, readonly string[]> = {
  '台北市': ['台北市', '臺北市'],
  '臺北市': ['台北市', '臺北市'],
  '台中市': ['台中市', '臺中市'],
  '臺中市': ['台中市', '臺中市'],
  '台南市': ['台南市', '臺南市'],
  '臺南市': ['台南市', '臺南市'],
  '台東縣': ['台東縣', '臺東縣'],
  '臺東縣': ['台東縣', '臺東縣'],
};

function _aliases(name: string): readonly string[] {
  return CITY_ALIASES[name] ?? [name];
}

interface LocationLite {
  address?: string;
  city?: string;
  district?: string;
}

/**
 * 單筆 selectedCity 是否 match doc 的 city / address。
 *  - doc.city 有值：alias 任一相等
 *  - doc.city 空：fallback 看 address 是否 contains 任一 alias
 *  - `__unknown__` selector：doc.city 空且 address 也不含任何 city 別名才 match
 */
function _cityMatches(
  target: LocationLite | undefined,
  selectedCity: string,
  allSelectableCityNames: readonly string[],
): boolean {
  const docCity = (target?.city ?? '').trim();
  const docAddress = target?.address ?? '';

  if (selectedCity === '__unknown__') {
    if (docCity) return false;
    // address 也不能含任何已知 city 名稱
    for (const knownCity of allSelectableCityNames) {
      for (const alias of _aliases(knownCity)) {
        if (docAddress.includes(alias)) return false;
      }
    }
    return true;
  }

  const aliases = _aliases(selectedCity);
  if (docCity && aliases.includes(docCity)) return true;
  if (!docCity) {
    // 舊單 fallback：用 address 字串 contains
    for (const alias of aliases) {
      if (docAddress.includes(alias)) return true;
    }
  }
  return false;
}

/** district 比對：doc.district 直接相等 OR address contains（district 不做 alias） */
function _districtMatches(target: LocationLite | undefined, selectedDistrict: string): boolean {
  const docDistrict = (target?.district ?? '').trim();
  const docAddress = target?.address ?? '';

  if (selectedDistrict === '__unknown__') {
    return !docDistrict;
  }
  if (docDistrict && docDistrict === selectedDistrict) return true;
  // 舊單 fallback：address 字串 contains
  if (!docDistrict && docAddress.includes(selectedDistrict)) return true;
  return false;
}

/**
 * 主 helper：判斷訂單是否通過縣市 / 行政區 filter。
 *  - cities / districts 空 → 一律通過
 *  - cities 有值：訂單需 match 任一 selectedCity（OR）
 *  - districts 有值：訂單需同時 match 任一 selectedDistrict（與 cities AND）
 *
 * @param allSelectableCityNames CityFilter 內所有可選的 city id list（給 `__unknown__` 比對用）
 */
export function matchRegion(input: {
  pickup: LocationLite | undefined;
  dropoff: LocationLite | undefined;
  regionField: 'pickup' | 'dropoff';
  cities: Set<string>;
  districts: Set<string>;
  allSelectableCityNames: readonly string[];
}): boolean {
  const { pickup, dropoff, regionField, cities, districts, allSelectableCityNames } = input;
  if (cities.size === 0 && districts.size === 0) return true;
  const target = regionField === 'dropoff' ? dropoff : pickup;

  if (cities.size > 0) {
    let cityHit = false;
    for (const selected of cities) {
      if (_cityMatches(target, selected, allSelectableCityNames)) {
        cityHit = true;
        break;
      }
    }
    if (!cityHit) return false;
  }

  if (districts.size > 0) {
    let districtHit = false;
    for (const selected of districts) {
      if (_districtMatches(target, selected)) {
        districtHit = true;
        break;
      }
    }
    if (!districtHit) return false;
  }

  return true;
}
