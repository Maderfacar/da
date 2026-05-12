/**
 * 靜態航空公司 / 機場辭典（Layer 2 Local Registry）
 *
 * 用途：
 *   1. Aviation Edge / TDX 回傳缺欄位時補資料（如 cityName 留空）
 *   2. API 全部失敗時，至少能用 IATA code 回填基本中文名
 *   3. 寫 flight_registry 時補齊 airlineName（API 偶爾只回 iataCode）
 *
 * 維護原則：
 *   - 只放 TPE 出入境常見航線（亞太、北美、歐洲主要 hub）
 *   - 公司名以繁中為主（消費端 LIFF 介面用）
 *   - 缺漏由 self-learning（API 成功後寫 Firestore registry）補強
 */

export interface AirlineEntry {
  iataCode: string;
  nameZh: string;
}

export interface AirportEntry {
  iataCode: string;
  cityZh: string;
  /** 該機場通常掛在哪個 IATA city code，方便日後處理多機場城市 */
  cityIata?: string;
}

const _airlines: Record<string, string> = {
  CI: '中華航空',
  BR: '長榮航空',
  JX: '星宇航空',
  AE: '華信航空',
  B7: '立榮航空',
  IT: '台灣虎航',
  // 日韓
  JL: '日本航空',
  NH: '全日空',
  KE: '大韓航空',
  OZ: '韓亞航空',
  LJ: '真航空',
  TW: '德威航空',
  ZE: '易斯達航空',
  BX: '釜山航空',
  // 大中華
  CX: '國泰航空',
  KA: '國泰港龍',
  HX: '香港航空',
  UO: '香港快運',
  CA: '中國國際航空',
  CZ: '中國南方航空',
  MU: '中國東方航空',
  HU: '海南航空',
  MF: '廈門航空',
  ZH: '深圳航空',
  // 東南亞
  SQ: '新加坡航空',
  TR: '酷航',
  TG: '泰國航空',
  MH: '馬來西亞航空',
  AK: '亞洲航空',
  PR: '菲律賓航空',
  Z2: '亞洲航空菲律賓',
  VN: '越南航空',
  VJ: '越捷航空',
  GA: '嘉魯達航空',
  QZ: '印尼亞航',
  // 北美
  UA: '聯合航空',
  AA: '美國航空',
  DL: '達美航空',
  AS: '阿拉斯加航空',
  AC: '加拿大航空',
  WS: '西捷航空',
  // 歐洲
  BA: '英國航空',
  LH: '漢莎航空',
  AF: '法國航空',
  KL: '荷蘭皇家航空',
  TK: '土耳其航空',
  LX: '瑞士航空',
  // 大洋洲
  QF: '澳洲航空',
  NZ: '紐西蘭航空',
  // 中東
  EK: '阿聯酋航空',
  EY: '阿提哈德航空',
  QR: '卡達航空',
};

const _airports: Record<string, string> = {
  // 台灣
  TPE: '台北桃園',
  TSA: '台北松山',
  KHH: '高雄',
  TXG: '台中',
  TNN: '台南',
  RMQ: '台中清泉崗',
  HUN: '花蓮',
  KNH: '金門',
  // 台灣國內離島 + 偏鄉機場
  TTT: '台東',
  MZG: '馬公(澎湖)',
  CYI: '嘉義',
  PIF: '屏東',
  WOT: '望安',
  KYD: '蘭嶼',
  GNI: '綠島',
  MFK: '馬祖北竿',
  LZN: '馬祖南竿',
  CMJ: '七美',
  // 日本
  NRT: '東京成田',
  HND: '東京羽田',
  KIX: '大阪關西',
  ITM: '大阪伊丹',
  NGO: '名古屋',
  CTS: '札幌新千歲',
  FUK: '福岡',
  OKA: '沖繩',
  HIJ: '廣島',
  KMJ: '熊本',
  KOJ: '鹿兒島',
  TAK: '高松',
  // 韓國
  ICN: '首爾仁川',
  GMP: '首爾金浦',
  PUS: '釜山',
  CJU: '濟州',
  TAE: '大邱',
  // 大中華
  HKG: '香港',
  MFM: '澳門',
  PVG: '上海浦東',
  SHA: '上海虹橋',
  PEK: '北京首都',
  PKX: '北京大興',
  CAN: '廣州',
  SZX: '深圳',
  HGH: '杭州',
  NKG: '南京',
  XMN: '廈門',
  // 東南亞
  SIN: '新加坡',
  BKK: '曼谷蘇凡納布',
  DMK: '曼谷廊曼',
  CNX: '清邁',
  HKT: '普吉',
  KUL: '吉隆坡',
  PEN: '檳城',
  CGK: '雅加達',
  DPS: '峇里島',
  MNL: '馬尼拉',
  CEB: '宿霧',
  SGN: '胡志明',
  HAN: '河內',
  DAD: '峴港',
  // 北美
  LAX: '洛杉磯',
  SFO: '舊金山',
  SEA: '西雅圖',
  JFK: '紐約甘迺迪',
  EWR: '紐約紐華克',
  ORD: '芝加哥',
  IAH: '休士頓',
  DFW: '達拉斯',
  ATL: '亞特蘭大',
  YVR: '溫哥華',
  YYZ: '多倫多',
  // 歐洲
  LHR: '倫敦希斯洛',
  LGW: '倫敦蓋特威克',
  CDG: '巴黎戴高樂',
  AMS: '阿姆斯特丹',
  FRA: '法蘭克福',
  MUC: '慕尼黑',
  ZRH: '蘇黎世',
  IST: '伊斯坦堡',
  // 大洋洲
  SYD: '雪梨',
  MEL: '墨爾本',
  BNE: '布里斯本',
  AKL: '奧克蘭',
  // 中東
  DXB: '杜拜',
  AUH: '阿布達比',
  DOH: '杜哈',
};

/** 從 IATA code 取航空公司中文名（找不到回 iata 自身大寫） */
export const GetAirlineNameByIata = (iataCode: string | undefined | null): string => {
  if (!iataCode) return '';
  const v = iataCode.trim().toUpperCase();
  return _airlines[v] ?? v;
};

/** 從 IATA code 取機場 / 城市中文名（找不到回 iata 自身大寫） */
export const GetAirportCityByIata = (iataCode: string | undefined | null): string => {
  if (!iataCode) return '';
  const v = iataCode.trim().toUpperCase();
  return _airports[v] ?? v;
};

/** 是否為已知航空公司 IATA code */
export const IsKnownAirline = (iataCode: string | undefined | null): boolean => {
  if (!iataCode) return false;
  return _airlines[iataCode.trim().toUpperCase()] !== undefined;
};

/** 從航班號 'JX801' 拆出 airline IATA 'JX' */
export const ParseAirlineIataFromFlightNo = (flightNoUpper: string): string => {
  const m = flightNoUpper.match(/^([A-Z0-9]{2})\d+$/);
  return m?.[1] ?? '';
};
