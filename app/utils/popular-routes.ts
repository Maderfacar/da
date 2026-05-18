// 熱門路線與機場共用資料
//
// - POPULAR_ROUTES：/fare 示範估價、首頁航班看板（PassengerRouteBoard）共用。
//   km 為代表性固定里程，供 shared/pricing.ts 即時試算；flightNo 純樣式用途。
// - SERVICE_AIRPORTS：/service、首頁服務範圍區塊共用的四大機場。
//
// 文案（i18n key 對應的中文）由架構師於上線後校正。

export interface PopularRoute {
  /** 穩定 id，對應 i18n key route.<id> */
  id: string;
  /** 出發 / 抵達顯示代碼（看板翻牌用，3-4 碼大寫） */
  fromCode: string;
  toCode: string;
  /** i18n key：routeBoard.routes.<id>.from / .to 的地點中文名 */
  fromKey: string;
  toKey: string;
  /** 代表性里程（km），供 calculateFare 試算 */
  km: number;
  /** 純樣式用航班號（看板情境裝飾，非真實航班） */
  flightNo: string;
}

export const POPULAR_ROUTES: ReadonlyArray<PopularRoute> = [
  { id: 'tpe-taipei',   fromCode: 'TPE', toCode: 'TPE',  fromKey: 'tpeAirport',  toKey: 'taipeiMain',  km: 40, flightNo: 'DA101' },
  { id: 'tpe-xinyi',    fromCode: 'TPE', toCode: 'XYI',  fromKey: 'tpeAirport',  toKey: 'xinyi',       km: 45, flightNo: 'DA208' },
  { id: 'tsa-taipei',   fromCode: 'TSA', toCode: 'TPC',  fromKey: 'tsaAirport',  toKey: 'taipeiCity',  km: 8,  flightNo: 'DA312' },
  { id: 'rmq-taichung', fromCode: 'RMQ', toCode: 'TXG',  fromKey: 'rmqAirport',  toKey: 'taichung',    km: 15, flightNo: 'DA416' },
  { id: 'khh-kaohsiung',fromCode: 'KHH', toCode: 'KAO',  fromKey: 'khhAirport',  toKey: 'kaohsiung',   km: 12, flightNo: 'DA523' },
];

export interface ServiceAirport {
  /** 對應 i18n key coverage.airports.<id> */
  id: string;
  iata: string;
}

export const SERVICE_AIRPORTS: ReadonlyArray<ServiceAirport> = [
  { id: 'taoyuan',   iata: 'TPE' },
  { id: 'songshan',  iata: 'TSA' },
  { id: 'taichung',  iata: 'RMQ' },
  { id: 'kaohsiung', iata: 'KHH' },
];
