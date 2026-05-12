/**
 * TDX 航班 GeneralSchedule 查詢 helper（Layer 3 — booking 階段排程驗證）
 *
 * 認證：OAuth2 client_credentials grant
 *   - Token endpoint：https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token
 *   - Token TTL 24h，in-memory cache（Vercel cold start 重拿一次，遠低於 rate limit）
 *
 * 資料來源：
 *   - GET /api/basic/v2/Air/GeneralSchedule/Domestic
 *   - GET /api/basic/v2/Air/GeneralSchedule/International
 *   - 兩個 endpoint **並行**打，union 結果，再用 flightNo 過濾
 *
 * 驗證 4 條（任一不過 → 視為查無此航班）：
 *   1. flightNo 找得到（含 codeshare 雙向比對）
 *   2. 用車日期在 EffectiveStart ~ EffectiveEnd 區間內
 *   3. 用車日期當天的星期幾在 WeekDays 內（[1,3,5] 格式）
 *   4. 至少一端機場在台灣（TPE / TSA / KHH / RMQ）
 *
 * Codeshare：第一輪精確匹配 `AirlineID + FlightNumber`；miss 則第二輪 fallback
 *           `OperatingAirlineID + OperatingFlightNumber`，best-effort（TDX 文件未必每筆都有）。
 *
 * Rate limit：TDX 標準會員 50 req/sec、50k req/day，本 spec 雙 endpoint 並行打 = 2 req/查詢，
 *             遠低於上限。
 */

const OAUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const SCHEDULE_DOMESTIC_URL = 'https://tdx.transportdata.tw/api/basic/v2/Air/GeneralSchedule/Domestic';
const SCHEDULE_INTERNATIONAL_URL = 'https://tdx.transportdata.tw/api/basic/v2/Air/GeneralSchedule/International';

/** 台灣機場 IATA 清單（user 拍板：booking 服務範圍） */
export const TW_AIRPORT_IATA = ['TPE', 'TSA', 'KHH', 'RMQ'] as const;
type TwAirportIata = typeof TW_AIRPORT_IATA[number];

const _isTwAirport = (iata: string | undefined | null): boolean => {
  if (!iata) return false;
  return (TW_AIRPORT_IATA as ReadonlyArray<string>).includes(iata.trim().toUpperCase());
};

// ── OAuth Token cache（in-memory，per process）────────────────────
interface CachedToken { value: string; expiresAt: number }
let _cachedToken: CachedToken | null = null;
/** 並發拿 token 時共用同一個 promise，避免同時打多次 OAuth */
let _tokenInflight: Promise<string> | null = null;

const _fetchNewToken = async (clientId: string, clientSecret: string): Promise<string> => {
  // OAuth body 必須用 application/x-www-form-urlencoded
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await $fetch<{ access_token: string; expires_in: number }>(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeout: 10000,
  });
  if (!res?.access_token) throw new Error('TDX OAuth: missing access_token in response');
  // 提早 1 分鐘標記過期，邊界保險避免拿到剛 expire 的 token
  const expiresAt = Date.now() + (res.expires_in - 60) * 1000;
  _cachedToken = { value: res.access_token, expiresAt };
  return res.access_token;
};

const _getToken = async (clientId: string, clientSecret: string): Promise<string> => {
  if (_cachedToken && _cachedToken.expiresAt > Date.now()) return _cachedToken.value;
  if (_tokenInflight) return _tokenInflight;
  _tokenInflight = _fetchNewToken(clientId, clientSecret).finally(() => { _tokenInflight = null; });
  return _tokenInflight;
};

// ── TDX response 型別（GeneralSchedule） ──────────────────────────
/**
 * TDX 文件未必每個欄位都有，全部標 optional。
 * 命名遵循 TDX 慣例（PascalCase）。
 */
export interface TdxScheduleEntry {
  AirlineID?: string;
  FlightNumber?: string;
  DepartureAirportID?: string;
  ArrivalAirportID?: string;
  ScheduledDepartureTime?: string;   // "HH:mm" or "HH:mm:ss"
  ScheduledArrivalTime?: string;
  DepartureTerminal?: string;
  ArrivalTerminal?: string;
  /** 數字陣列，1=週一 ... 7=週日（ISO 8601）；TDX 文件規格略有差異，相容讀取 */
  WeekDays?: number[];
  /** Fallback：[1,0,1,0,1,0,0] 七元素 boolean 陣列（[Mon..Sun]） */
  WeekPattern?: number[];
  EffectiveDate?: string;            // "YYYY-MM-DD"
  ExpireDate?: string;
  CodeShare?: boolean;
  OperatingAirlineID?: string;
  OperatingFlightNumber?: string;
  /** TDX 部分 endpoint 用 ServiceType：Pax / Cargo / ... 過濾客運 */
  ServiceType?: string;
  [k: string]: unknown;
}

// ── 公開回傳型別（給 flight.get.ts 用）────────────────────────────
export type FlightDirection = 'arrival' | 'departure';

export interface TdxFlightResult {
  flightNo: string;                  // 'CI102'
  airlineCode: string;               // 'CI'
  isDomestic: boolean;
  departureAirport: string;          // 'NRT'
  arrivalAirport: string;            // 'TPE'
  /** 取「跟 direction 對應」那一端的航廈（arrival → ArrivalTerminal、departure → DepartureTerminal） */
  terminal: string;
  scheduledDeparture: string;        // 'HH:mm'
  scheduledArrival: string;
  weekDays: number[];                // [1,3,5]
  effectiveStart: string | null;
  effectiveEnd: string | null;
  codeShare: boolean;
  operatingAirlineCode: string | null;
  operatingFlightNumber: string | null;
}

// ── helpers ──────────────────────────────────────────────────────
const _normalizeFlightNo = (airlineId?: string, flightNumber?: string): string => {
  if (!airlineId || !flightNumber) return '';
  // TDX FlightNumber 可能含前導 0（"0102"），合併時去掉前導 0 對齊用戶輸入習慣（CI102）
  const num = flightNumber.replace(/^0+/, '') || flightNumber;
  return `${airlineId.toUpperCase()}${num}`;
};

const _normalizeWeekDays = (entry: TdxScheduleEntry): number[] => {
  if (Array.isArray(entry.WeekDays) && entry.WeekDays.length > 0) {
    // 過濾合法值 1-7
    return entry.WeekDays.filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  }
  if (Array.isArray(entry.WeekPattern) && entry.WeekPattern.length === 7) {
    // [Mon=idx0, ..., Sun=idx6] → 轉成 [1..7]
    const days: number[] = [];
    entry.WeekPattern.forEach((flag, idx) => {
      if (flag) days.push(idx + 1);
    });
    return days;
  }
  // 兩個欄位都沒 → 視為「全週可飛」（保守 fallback，避免誤判）
  return [1, 2, 3, 4, 5, 6, 7];
};

const _normalizeTime = (raw: string | undefined): string => {
  if (!raw) return '';
  // TDX 可能回 "10:30" 或 "10:30:00"，統一截短為 "HH:mm"
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};

const _normalizeDate = (raw: string | undefined): string | null => {
  if (!raw) return null;
  // 接受 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:mm:ss"，截前 10 字
  const m = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return m?.[0] ?? null;
};

/** 取 ISO weekday：Date 的 getDay() = 0(週日) ... 6(週六)，要轉 1(週一) ... 7(週日) */
const _isoWeekDay = (date: string): number => {
  const d = new Date(`${date}T00:00:00+08:00`);
  const sunday0 = d.getDay();
  return sunday0 === 0 ? 7 : sunday0;
};

const _isInDateRange = (date: string, start: string | null, end: string | null): boolean => {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
};

/** 把 TDX entry 對應「某 direction」轉成 TdxFlightResult */
const _mapEntry = (
  entry: TdxScheduleEntry,
  direction: FlightDirection,
  isDomestic: boolean,
): TdxFlightResult | null => {
  const flightNo = _normalizeFlightNo(entry.AirlineID, entry.FlightNumber);
  if (!flightNo) return null;
  const departureAirport = (entry.DepartureAirportID ?? '').toUpperCase();
  const arrivalAirport = (entry.ArrivalAirportID ?? '').toUpperCase();
  const terminal = direction === 'arrival'
    ? (entry.ArrivalTerminal ?? '')
    : (entry.DepartureTerminal ?? '');
  return {
    flightNo,
    airlineCode: (entry.AirlineID ?? '').toUpperCase(),
    isDomestic,
    departureAirport,
    arrivalAirport,
    terminal: terminal.trim(),
    scheduledDeparture: _normalizeTime(entry.ScheduledDepartureTime),
    scheduledArrival: _normalizeTime(entry.ScheduledArrivalTime),
    weekDays: _normalizeWeekDays(entry),
    effectiveStart: _normalizeDate(entry.EffectiveDate),
    effectiveEnd: _normalizeDate(entry.ExpireDate),
    codeShare: Boolean(entry.CodeShare),
    operatingAirlineCode: entry.OperatingAirlineID ? entry.OperatingAirlineID.toUpperCase() : null,
    operatingFlightNumber: entry.OperatingFlightNumber ?? null,
  };
};

// ── 主查詢 ──────────────────────────────────────────────────────
/**
 * TDX schedule 查詢主入口。
 * 失敗 / 找不到 → 回 null（呼叫端自行決定是否走下一個 fallback layer）
 *
 * @param flightNoUpper 已 uppercase + 去空白的航班號（'CI102'）
 * @param direction     'arrival' | 'departure'（用來決定取哪一端的 terminal）
 * @param date          'YYYY-MM-DD' 用車日期
 * @returns null 表 schedule 找不到、或 4 條 validation 任一不過
 */
export const QueryTdxFlight = async (
  clientId: string,
  clientSecret: string,
  flightNoUpper: string,
  direction: FlightDirection,
  date: string,
): Promise<TdxFlightResult | null> => {
  if (!clientId || !clientSecret || !flightNoUpper) return null;

  let token: string;
  try {
    token = await _getToken(clientId, clientSecret);
  } catch (err) {
    console.error('[tdx-flight] OAuth failed:', err);
    return null;
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const query = { $format: 'JSON' };

  // 兩個 endpoint 並行
  const [domesticRes, internationalRes] = await Promise.all([
    $fetch<TdxScheduleEntry[]>(SCHEDULE_DOMESTIC_URL, { headers, query, timeout: 10000 }).catch((err) => {
      console.error('[tdx-flight] Domestic query failed:', err);
      return [] as TdxScheduleEntry[];
    }),
    $fetch<TdxScheduleEntry[]>(SCHEDULE_INTERNATIONAL_URL, { headers, query, timeout: 10000 }).catch((err) => {
      console.error('[tdx-flight] International query failed:', err);
      return [] as TdxScheduleEntry[];
    }),
  ]);

  const allEntries: Array<{ entry: TdxScheduleEntry; isDomestic: boolean }> = [
    ...(Array.isArray(domesticRes) ? domesticRes : []).map((entry) => ({ entry, isDomestic: true })),
    ...(Array.isArray(internationalRes) ? internationalRes : []).map((entry) => ({ entry, isDomestic: false })),
  ];

  if (allEntries.length === 0) return null;

  // ── 比對航班號（含 codeshare 雙向）───────────────────
  // 第一輪：精確匹配 AirlineID + FlightNumber
  let matched = allEntries.find(
    ({ entry }) => _normalizeFlightNo(entry.AirlineID, entry.FlightNumber) === flightNoUpper,
  );

  // 第二輪 fallback：用 OperatingAirlineID + OperatingFlightNumber 比對
  // （codeshare 場景下，用戶輸入的可能是「實體營運」的編號）
  if (!matched) {
    matched = allEntries.find(
      ({ entry }) => _normalizeFlightNo(entry.OperatingAirlineID, entry.OperatingFlightNumber) === flightNoUpper,
    );
  }

  if (!matched) return null;

  const result = _mapEntry(matched.entry, direction, matched.isDomestic);
  if (!result) return null;

  // ── Validation 1：至少一端機場在台灣 ──
  if (!_isTwAirport(result.departureAirport) && !_isTwAirport(result.arrivalAirport)) {
    return null;
  }

  // ── Validation 2：日期在有效期區間 ──
  if (!_isInDateRange(date, result.effectiveStart, result.effectiveEnd)) {
    return null;
  }

  // ── Validation 3：weekday 符合 schedule ──
  const weekDay = _isoWeekDay(date);
  if (!result.weekDays.includes(weekDay)) {
    return null;
  }

  return result;
};

/**
 * 把 TDX schedule + 用車日期合成 ISO 8601 timestamp（Asia/Taipei）。
 * 給 flight.get.ts 把 TdxFlightResult 轉成 FlightInfo 用。
 */
export const ComposeTdxTimestamp = (date: string, hhmm: string): string => {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  return `${date}T${hhmm}:00+08:00`;
};
