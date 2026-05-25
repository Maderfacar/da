// 台灣 22 縣市三語對照表（縣市過濾用）
//
// city 欄位值 = 中文「全名」（如「台北市」「桃園市」），與 Google Places
// `administrative_area_level_1` long_name 一致 → server filter 直接字串比對，無需轉碼。
//
// district（鄉鎮市區）不走 hardcode：本次 UI 採「從現有訂單聚合 distinct」動態渲染，
// 避免硬寫 ~368 筆鄉鎮 × 三語膨脹 bundle。後續若 brain 要全 list disabled tag 可再補。

export interface TaiwanCity {
  /** 中文全名（與 Google Places admin_area_level_1 一致）*/
  id: string;
  zh_tw: string;
  en: string;
  ja: string;
}

export const TAIWAN_CITIES: TaiwanCity[] = [
  { id: '台北市', zh_tw: '台北市', en: 'Taipei City', ja: '台北市' },
  { id: '新北市', zh_tw: '新北市', en: 'New Taipei City', ja: '新北市' },
  { id: '桃園市', zh_tw: '桃園市', en: 'Taoyuan City', ja: '桃園市' },
  { id: '台中市', zh_tw: '台中市', en: 'Taichung City', ja: '台中市' },
  { id: '台南市', zh_tw: '台南市', en: 'Tainan City', ja: '台南市' },
  { id: '高雄市', zh_tw: '高雄市', en: 'Kaohsiung City', ja: '高雄市' },
  { id: '基隆市', zh_tw: '基隆市', en: 'Keelung City', ja: '基隆市' },
  { id: '新竹市', zh_tw: '新竹市', en: 'Hsinchu City', ja: '新竹市' },
  { id: '新竹縣', zh_tw: '新竹縣', en: 'Hsinchu County', ja: '新竹県' },
  { id: '苗栗縣', zh_tw: '苗栗縣', en: 'Miaoli County', ja: '苗栗県' },
  { id: '彰化縣', zh_tw: '彰化縣', en: 'Changhua County', ja: '彰化県' },
  { id: '南投縣', zh_tw: '南投縣', en: 'Nantou County', ja: '南投県' },
  { id: '雲林縣', zh_tw: '雲林縣', en: 'Yunlin County', ja: '雲林県' },
  { id: '嘉義市', zh_tw: '嘉義市', en: 'Chiayi City', ja: '嘉義市' },
  { id: '嘉義縣', zh_tw: '嘉義縣', en: 'Chiayi County', ja: '嘉義県' },
  { id: '屏東縣', zh_tw: '屏東縣', en: 'Pingtung County', ja: '屏東県' },
  { id: '宜蘭縣', zh_tw: '宜蘭縣', en: 'Yilan County', ja: '宜蘭県' },
  { id: '花蓮縣', zh_tw: '花蓮縣', en: 'Hualien County', ja: '花蓮県' },
  { id: '台東縣', zh_tw: '台東縣', en: 'Taitung County', ja: '台東県' },
  { id: '澎湖縣', zh_tw: '澎湖縣', en: 'Penghu County', ja: '澎湖県' },
  { id: '金門縣', zh_tw: '金門縣', en: 'Kinmen County', ja: '金門県' },
  { id: '連江縣', zh_tw: '連江縣', en: 'Lienchiang County', ja: '連江県' },
];

/** 依 i18n locale 取縣市顯示名（fallback 繁中） */
export function getCityLabel(city: TaiwanCity, locale: string): string {
  if (locale.startsWith('en')) return city.en;
  if (locale.startsWith('ja')) return city.ja;
  return city.zh_tw;
}
