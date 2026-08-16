/**
 * 地點顯示 label helper（driver/trip 列表 + admin/orders 列表共用）。
 *
 * 訂單裡的地點只顯示 displayName 時常常只剩「路名 / 地標名」，
 * 司機與 admin 看不出是哪個縣市 → 這裡統一組出「縣市 + 行政區」前綴。
 *
 * 資料來源優先序：
 *  1. loc.city / loc.district（UiGooglePlaceInput 選取時由 place-details BFF 帶入）
 *  2. loc.address 字串 fallback（舊訂單無 city/district 欄位；與 region-match.ts 同一套 fallback 思路）
 *
 * 「台 / 臺」歧義：county-codes 用「台」字，Google administrative_area_level_1 用「臺」字，
 * 兩種寫法都要能從 address 命中，命中什麼就顯示什麼（不強制正規化，避免與地址原文不一致）。
 */
import { COUNTY_CODES } from './geo/county-codes';

export interface LocationLike {
  address?: string;
  displayName?: string;
  city?: string;
  district?: string;
}

/** 22 縣市中文名（county-codes 為唯一來源，避免重複維護清單） */
const COUNTY_NAMES: readonly string[] = Object.values(COUNTY_CODES).map((c) => c.zh);

/** 台 → 臺 雙寫法：只有含「台」字的縣市需要另一個 alias */
function _aliases(name: string): readonly string[] {
  return name.includes('台') ? [name, name.replace('台', '臺')] : [name];
}

/** address 字串前綴雜訊：郵遞區號（3~6 碼）與「台灣 / 臺灣」國名 */
const ADDRESS_PREFIX_NOISE = /^(?:\d{3,6}\s*)?(?:台灣|臺灣)?\s*/;

/** 行政區：緊接在縣市之後的「N區 / N鄉 / N鎮 / N市」（N 為 1~3 個中文字） */
const DISTRICT_PATTERN = /^[一-龥]{1,3}[區鄉鎮市]/;

function _cityFromAddress(address: string): string {
  for (const name of COUNTY_NAMES) {
    for (const alias of _aliases(name)) {
      if (address.includes(alias)) return alias;
    }
  }
  return '';
}

function _districtFromAddress(address: string, city: string): string {
  if (!city) return '';
  const idx = address.indexOf(city);
  if (idx < 0) return '';
  const rest = address.slice(idx + city.length);
  return rest.match(DISTRICT_PATTERN)?.[0] ?? '';
}

/** 取出地點的縣市 / 行政區（欄位優先，缺值退回 address 解析；都找不到回空字串） */
export function extractRegion(loc?: LocationLike | null): { city: string; district: string } {
  const address = (loc?.address ?? '').trim();
  const city = (loc?.city ?? '').trim() || _cityFromAddress(address);
  const district = (loc?.district ?? '').trim() || _districtFromAddress(address, city);
  return { city, district };
}

/** 縣市 + 行政區連寫（如「桃園市大園區」）；兩者皆無回空字串 */
export function formatRegion(loc?: LocationLike | null): string {
  const { city, district } = extractRegion(loc);
  return `${city}${district}`;
}

/**
 * 地點名稱（不含縣市前綴）。
 * 少數舊訂單的 displayName 存成「地點名稱 (完整地址)」→ 只取括號前那段；
 * 無 displayName 時退回 address，並清掉郵遞區號 / 國名前綴。
 */
export function formatPlaceName(loc?: LocationLike | null): string {
  const raw = (loc?.displayName ?? '').trim() || (loc?.address ?? '').trim();
  if (!raw) return '';
  const withoutParen = raw.replace(/\s*[（(][^（()）]*[)）]\s*$/, '').trim() || raw;
  const firstSegment = withoutParen.split(',')[0]?.trim() ?? '';
  return firstSegment.replace(ADDRESS_PREFIX_NOISE, '').trim() || withoutParen;
}

/**
 * 單行完整 label：「縣市行政區 地點名稱」。
 * 名稱本身已含該縣市行政區時（address fallback 情境）不重複前綴。
 */
export function formatLocationLabel(loc?: LocationLike | null): string {
  const name = formatPlaceName(loc);
  const region = formatRegion(loc);
  if (!region) return name;
  if (!name) return region;
  if (name.startsWith(region)) return name;
  return `${region} ${name}`;
}
