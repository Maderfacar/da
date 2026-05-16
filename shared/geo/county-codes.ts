// 台灣 22 縣市代碼與中英日名稱對照（前後端共用，以 ~shared 別名引用）
//
// code 對應 shared/geo/taiwan-counties.json 每個 Feature 的 properties.code。
// Fare V2 跨縣市補貼以此 code 集合判定（design.md computeCrossCountyFee）。

export interface CountyInfo {
  /** 自定 ISO 風格代碼 */
  code: string;
  /** 繁體中文 */
  zh: string;
  /** English */
  en: string;
  /** 日本語 */
  ja: string;
}

export const COUNTY_CODES = {
  TPE: { code: 'TPE', zh: '台北市', en: 'Taipei City', ja: '台北市' },
  NTPE: { code: 'NTPE', zh: '新北市', en: 'New Taipei City', ja: '新北市' },
  TYN: { code: 'TYN', zh: '桃園市', en: 'Taoyuan City', ja: '桃園市' },
  KEE: { code: 'KEE', zh: '基隆市', en: 'Keelung City', ja: '基隆市' },
  HSC: { code: 'HSC', zh: '新竹市', en: 'Hsinchu City', ja: '新竹市' },
  HSZ: { code: 'HSZ', zh: '新竹縣', en: 'Hsinchu County', ja: '新竹県' },
  MIA: { code: 'MIA', zh: '苗栗縣', en: 'Miaoli County', ja: '苗栗県' },
  TXG: { code: 'TXG', zh: '台中市', en: 'Taichung City', ja: '台中市' },
  CHA: { code: 'CHA', zh: '彰化縣', en: 'Changhua County', ja: '彰化県' },
  NAN: { code: 'NAN', zh: '南投縣', en: 'Nantou County', ja: '南投県' },
  YUN: { code: 'YUN', zh: '雲林縣', en: 'Yunlin County', ja: '雲林県' },
  CYI: { code: 'CYI', zh: '嘉義市', en: 'Chiayi City', ja: '嘉義市' },
  CYQ: { code: 'CYQ', zh: '嘉義縣', en: 'Chiayi County', ja: '嘉義県' },
  TNN: { code: 'TNN', zh: '台南市', en: 'Tainan City', ja: '台南市' },
  KHH: { code: 'KHH', zh: '高雄市', en: 'Kaohsiung City', ja: '高雄市' },
  PIF: { code: 'PIF', zh: '屏東縣', en: 'Pingtung County', ja: '屏東県' },
  ILA: { code: 'ILA', zh: '宜蘭縣', en: 'Yilan County', ja: '宜蘭県' },
  HUA: { code: 'HUA', zh: '花蓮縣', en: 'Hualien County', ja: '花蓮県' },
  TTT: { code: 'TTT', zh: '台東縣', en: 'Taitung County', ja: '台東県' },
  PEH: { code: 'PEH', zh: '澎湖縣', en: 'Penghu County', ja: '澎湖県' },
  KIN: { code: 'KIN', zh: '金門縣', en: 'Kinmen County', ja: '金門県' },
  LIE: { code: 'LIE', zh: '連江縣', en: 'Lienchiang County', ja: '連江県' },
} as const satisfies Record<string, CountyInfo>;

export type CountyCode = keyof typeof COUNTY_CODES;

/** 北北桃集合 — 跨縣市補貼可排除此區域內互跨（design.md crossCounty.excludeTpeNtpeTyn） */
export const TPE_METRO_CODES: ReadonlySet<CountyCode> = new Set<CountyCode>(['TPE', 'NTPE', 'TYN']);

export function isCountyCode(value: string): value is CountyCode {
  return value in COUNTY_CODES;
}

export function getCountyInfo(code: string): CountyInfo | null {
  return isCountyCode(code) ? COUNTY_CODES[code] : null;
}
