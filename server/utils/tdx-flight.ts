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
 * 實測 2026-05-12（debug=1 dump 真實 response）後對齊欄位：
 *   - FlightNumber **已含 airline prefix**（例 "CI852" 不是 "852"）
 *   - 七個獨立 boolean 欄位 Monday/.../Sunday，不是 WeekDays[] 也不是 WeekPattern[]
 *   - ScheduleStartDate / ScheduleEndDate 不是 EffectiveDate / ExpireDate
 *   - DepartureTime / ArrivalTime 不是 ScheduledDeparture/ArrivalTime
 *   - CodeShare 是 array 不是 boolean，element 形如 { AirlineID, FlightNumber }
 *
 * 舊欄位名仍保留 union 標記，因 TDX 不同 endpoint 偶有不一致命名。
 */
export interface TdxScheduleEntry {
  AirlineID?: string;
  /** 已含 airline prefix（"CI852"）— 不要再拼 AirlineID */
  FlightNumber?: string;
  DepartureAirportID?: string;
  ArrivalAirportID?: string;
  /** 實測欄位名 "DepartureTime" / "ArrivalTime"，"HH:mm" 或 "HH:mm:ss" */
  DepartureTime?: string;
  ArrivalTime?: string;
  /** 舊命名相容（部分 endpoint 可能用） */
  ScheduledDepartureTime?: string;
  ScheduledArrivalTime?: string;
  DepartureTerminal?: string;
  ArrivalTerminal?: string;
  /** 七個獨立 boolean — 實測為主要 weekday 欄位 */
  Monday?: boolean;
  Tuesday?: boolean;
  Wednesday?: boolean;
  Thursday?: boolean;
  Friday?: boolean;
  Saturday?: boolean;
  Sunday?: boolean;
  /** 舊命名相容 */
  WeekDays?: number[];
  WeekPattern?: number[];
  /** 實測欄位名 ScheduleStartDate / ScheduleEndDate */
  ScheduleStartDate?: string;
  ScheduleEndDate?: string;
  /** 舊命名相容 */
  EffectiveDate?: string;
  ExpireDate?: string;
  /** 實測為 array，element 形如 { AirlineID, FlightNumber }，空 array 表「非 codeshare」 */
  CodeShare?: Array<{ AirlineID?: string; FlightNumber?: string }>;
  OperatingAirlineID?: string;
  OperatingFlightNumber?: string;
  ServiceType?: string;
  [k: string]: unknown;
}

// ── 舊舊欄位 → 新欄位（單向相容讀取）helpers ──
const _firstString = (...vals: Array<unknown>): string | undefined => {
  for (const v of vals) {
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
};

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
/**
 * 從 entry 取出規範化的航班號（已含 airline prefix，例 "CI852"）。
 * TDX 實測 FlightNumber 已含 prefix，直接 trim+upper 回；空白時 fallback 拼 AirlineID。
 */
const _normalizeFlightNo = (entry: TdxScheduleEntry): string => {
  const fn = (entry.FlightNumber ?? '').trim().toUpperCase();
  if (!fn) return '';
  // 若已含 airline prefix（TDX 主要格式）→ 直接用
  if (entry.AirlineID) {
    const aid = entry.AirlineID.toUpperCase();
    if (fn.startsWith(aid)) return fn;
    // Fallback：FlightNumber 不含 prefix（部分 endpoint 可能），拼上去並去前導 0
    const num = fn.replace(/^0+/, '') || fn;
    return `${aid}${num}`;
  }
  return fn;
};

/** Codeshare row 結構：嘗試比對某個 entry.CodeShare array 內是否含目標 flightNo */
const _codeShareIncludes = (entry: TdxScheduleEntry, flightNoUpper: string): boolean => {
  if (!Array.isArray(entry.CodeShare) || entry.CodeShare.length === 0) return false;
  return entry.CodeShare.some((cs) => {
    if (!cs?.FlightNumber) return false;
    const fn = cs.FlightNumber.trim().toUpperCase();
    if (!fn) return false;
    if (fn === flightNoUpper) return true;
    if (cs.AirlineID) {
      const aid = cs.AirlineID.toUpperCase();
      if (fn.startsWith(aid) && fn === flightNoUpper) return true;
      const num = fn.replace(/^0+/, '') || fn;
      if (`${aid}${num}` === flightNoUpper) return true;
    }
    return false;
  });
};

const _normalizeWeekDays = (entry: TdxScheduleEntry): number[] => {
  // 主要：七個獨立 boolean 欄位（TDX 實測格式）
  const fromBool: number[] = [];
  if (entry.Monday) fromBool.push(1);
  if (entry.Tuesday) fromBool.push(2);
  if (entry.Wednesday) fromBool.push(3);
  if (entry.Thursday) fromBool.push(4);
  if (entry.Friday) fromBool.push(5);
  if (entry.Saturday) fromBool.push(6);
  if (entry.Sunday) fromBool.push(7);
  if (fromBool.length > 0) return fromBool;

  // 舊命名相容（萬一某些 endpoint 仍用）
  if (Array.isArray(entry.WeekDays) && entry.WeekDays.length > 0) {
    return entry.WeekDays.filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  }
  if (Array.isArray(entry.WeekPattern) && entry.WeekPattern.length === 7) {
    const days: number[] = [];
    entry.WeekPattern.forEach((flag, idx) => { if (flag) days.push(idx + 1); });
    return days;
  }
  // 全部都沒 → 視為「全週可飛」（保守 fallback，避免誤判）
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
  const flightNo = _normalizeFlightNo(entry);
  if (!flightNo) return null;
  const departureAirport = (entry.DepartureAirportID ?? '').toUpperCase();
  const arrivalAirport = (entry.ArrivalAirportID ?? '').toUpperCase();
  const terminal = direction === 'arrival'
    ? (entry.ArrivalTerminal ?? '')
    : (entry.DepartureTerminal ?? '');

  // CodeShare 是 array：判斷 + 取第一個 partner 當 operating（Best-effort，TDX 文件不明）
  const isCodeShare = Array.isArray(entry.CodeShare) && entry.CodeShare.length > 0;
  let operatingAirlineCode: string | null = null;
  let operatingFlightNumber: string | null = null;
  if (isCodeShare) {
    const op = entry.CodeShare?.[0];
    operatingAirlineCode = op?.AirlineID ? op.AirlineID.toUpperCase() : null;
    operatingFlightNumber = op?.FlightNumber ?? null;
  } else if (entry.OperatingAirlineID) {
    operatingAirlineCode = entry.OperatingAirlineID.toUpperCase();
    operatingFlightNumber = entry.OperatingFlightNumber ?? null;
  }

  return {
    flightNo,
    airlineCode: (entry.AirlineID ?? '').toUpperCase(),
    isDomestic,
    departureAirport,
    arrivalAirport,
    terminal: terminal.trim(),
    // 實測欄位 DepartureTime / ArrivalTime；舊命名 ScheduledDepartureTime / ScheduledArrivalTime fallback
    scheduledDeparture: _normalizeTime(_firstString(entry.DepartureTime, entry.ScheduledDepartureTime)),
    scheduledArrival: _normalizeTime(_firstString(entry.ArrivalTime, entry.ScheduledArrivalTime)),
    weekDays: _normalizeWeekDays(entry),
    // 實測欄位 ScheduleStartDate / ScheduleEndDate；舊命名 EffectiveDate / ExpireDate fallback
    effectiveStart: _normalizeDate(_firstString(entry.ScheduleStartDate, entry.EffectiveDate)),
    effectiveEnd: _normalizeDate(_firstString(entry.ScheduleEndDate, entry.ExpireDate)),
    codeShare: isCodeShare,
    operatingAirlineCode,
    operatingFlightNumber,
  };
};

// ── Schedule cache（spec 2026-05-12 修正）─────────────────────────
// TDX International endpoint 高機率 429（user 實測）→ 改 module-level cache 整份 schedule。
// 每 30 分鐘只打 2 次 API（不是每查 1 個航班打 2 次），429 機率大幅降低。
// International schedule ~ 5MB / Domestic ~ 1MB，Vercel function 1024MB 容得下。
interface TdxSchedules { domestic: TdxScheduleEntry[]; international: TdxScheduleEntry[] }
const SCHEDULE_CACHE_TTL_MS = 30 * 60 * 1000;
let _scheduleCache: { data: TdxSchedules; exp: number } | null = null;
let _scheduleInflight: Promise<TdxSchedules> | null = null;

/** 429 → 等 1.5 秒重試一次（TDX 偶發 burst 限制）*/
const _fetchScheduleWithRetry = async (
  url: string,
  token: string,
  endpointLabel: string,
): Promise<{ data: TdxScheduleEntry[]; error: string | null }> => {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const query = { $format: 'JSON' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await $fetch<TdxScheduleEntry[]>(url, { headers, query, timeout: 30000 });
      return { data: Array.isArray(res) ? res : [], error: null };
    } catch (err) {
      const statusCode = (err as { statusCode?: number; status?: number })?.statusCode
        ?? (err as { statusCode?: number; status?: number })?.status;
      if (statusCode === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tdx-flight] ${endpointLabel} fetch failed (attempt ${attempt + 1}):`, msg);
      return { data: [], error: msg };
    }
  }
  return { data: [], error: 'unreachable' };
};

const _getSchedules = async (token: string): Promise<TdxSchedules> => {
  if (_scheduleCache && _scheduleCache.exp > Date.now()) return _scheduleCache.data;
  if (_scheduleInflight) return _scheduleInflight;
  _scheduleInflight = (async () => {
    const [dom, intl] = await Promise.all([
      _fetchScheduleWithRetry(SCHEDULE_DOMESTIC_URL, token, 'Domestic'),
      _fetchScheduleWithRetry(SCHEDULE_INTERNATIONAL_URL, token, 'International'),
    ]);
    const data: TdxSchedules = { domestic: dom.data, international: intl.data };
    // 任一 endpoint 都成功 → cache（國內/國際各自完整）
    // 兩 endpoint 都失敗 → 不 cache（下次重試）
    if (dom.data.length > 0 || intl.data.length > 0) {
      _scheduleCache = { data, exp: Date.now() + SCHEDULE_CACHE_TTL_MS };
    }
    return data;
  })().finally(() => { _scheduleInflight = null; });
  return _scheduleInflight;
};

/** 給 debug=1 模式用：拿 cache 內整份原始 response（含 stale 也回，方便看欄位結構） */
const _getSchedulesWithMeta = async (token: string): Promise<{
  domestic: { data: TdxScheduleEntry[]; error: string | null };
  international: { data: TdxScheduleEntry[]; error: string | null };
}> => {
  // 若 cache 有效直接回（不算 error）
  if (_scheduleCache && _scheduleCache.exp > Date.now()) {
    return {
      domestic: { data: _scheduleCache.data.domestic, error: null },
      international: { data: _scheduleCache.data.international, error: null },
    };
  }
  // Cold fetch — 回個別 error 給 trace 看
  const [dom, intl] = await Promise.all([
    _fetchScheduleWithRetry(SCHEDULE_DOMESTIC_URL, token, 'Domestic'),
    _fetchScheduleWithRetry(SCHEDULE_INTERNATIONAL_URL, token, 'International'),
  ]);
  const data: TdxSchedules = { domestic: dom.data, international: intl.data };
  if (dom.data.length > 0 || intl.data.length > 0) {
    _scheduleCache = { data, exp: Date.now() + SCHEDULE_CACHE_TTL_MS };
  }
  return { domestic: dom, international: intl };
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

  const schedules = await _getSchedules(token);

  const allEntries: Array<{ entry: TdxScheduleEntry; isDomestic: boolean }> = [
    ...schedules.domestic.map((entry) => ({ entry, isDomestic: true })),
    ...schedules.international.map((entry) => ({ entry, isDomestic: false })),
  ];

  if (allEntries.length === 0) return null;

  // ── 比對航班號（含 codeshare 雙向）───────────────────
  // 第一輪：直接比 entry.FlightNumber（TDX FlightNumber 已含 airline prefix）
  let matched = allEntries.find(
    ({ entry }) => _normalizeFlightNo(entry) === flightNoUpper,
  );

  // 第二輪 fallback：迭代 entry.CodeShare array element 看有沒有對到目標 flightNo
  // （用戶輸入的可能是「銷售編號」而非「實體營運編號」）
  if (!matched) {
    matched = allEntries.find(({ entry }) => _codeShareIncludes(entry, flightNoUpper));
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

// ── Debug 模式（給 flight.get.ts ?debug=1 用）─────────────────────
/**
 * 等同 QueryTdxFlight 但同時回傳完整 trace：OAuth 狀態、雙 endpoint 各幾筆 + 第一筆 raw entry、
 * 4 條 validation 哪條 fail。用於 prod 排查 TDX 欄位名 / 比對 / 驗證問題。
 */
export interface TdxQueryTrace {
  input: { flightNo: string; direction: FlightDirection; date: string };
  oauth: { ok: boolean; error: string | null };
  domestic: { count: number; sample: TdxScheduleEntry | null; error: string | null };
  international: { count: number; sample: TdxScheduleEntry | null; error: string | null };
  matchAttempt1Precise: { matched: boolean };
  matchAttempt2Codeshare: { triggered: boolean; matched: boolean };
  matchedRawEntry: TdxScheduleEntry | null;
  matchedIsDomestic: boolean | null;
  /** 命中後依 direction 對應 mapping 出的中間結果 */
  mappedResult: TdxFlightResult | null;
  validation: {
    flightFound: boolean;
    atLeastOneTwAirport: { result: boolean; departure: string; arrival: string } | null;
    dateInRange: { result: boolean; date: string; effectiveStart: string | null; effectiveEnd: string | null } | null;
    weekdayMatches: { result: boolean; isoWeekDay: number; weekDays: number[] } | null;
  };
  finalResult: TdxFlightResult | null;
}

export const QueryTdxFlightWithTrace = async (
  clientId: string,
  clientSecret: string,
  flightNoUpper: string,
  direction: FlightDirection,
  date: string,
): Promise<TdxQueryTrace> => {
  const trace: TdxQueryTrace = {
    input: { flightNo: flightNoUpper, direction, date },
    oauth: { ok: false, error: null },
    domestic: { count: 0, sample: null, error: null },
    international: { count: 0, sample: null, error: null },
    matchAttempt1Precise: { matched: false },
    matchAttempt2Codeshare: { triggered: false, matched: false },
    matchedRawEntry: null,
    matchedIsDomestic: null,
    mappedResult: null,
    validation: {
      flightFound: false,
      atLeastOneTwAirport: null,
      dateInRange: null,
      weekdayMatches: null,
    },
    finalResult: null,
  };

  let token: string;
  try {
    token = await _getToken(clientId, clientSecret);
    trace.oauth.ok = Boolean(token);
  } catch (err) {
    trace.oauth.error = err instanceof Error ? err.message : String(err);
    return trace;
  }

  const meta = await _getSchedulesWithMeta(token);
  trace.domestic.count = meta.domestic.data.length;
  trace.international.count = meta.international.data.length;
  trace.domestic.sample = trace.domestic.count > 0 ? meta.domestic.data[0] : null;
  trace.international.sample = trace.international.count > 0 ? meta.international.data[0] : null;
  trace.domestic.error = meta.domestic.error;
  trace.international.error = meta.international.error;

  const allEntries: Array<{ entry: TdxScheduleEntry; isDomestic: boolean }> = [
    ...meta.domestic.data.map((entry) => ({ entry, isDomestic: true })),
    ...meta.international.data.map((entry) => ({ entry, isDomestic: false })),
  ];

  // 比對 attempt 1：直接比 entry.FlightNumber（TDX FlightNumber 已含 airline prefix）
  let matched = allEntries.find(({ entry }) => _normalizeFlightNo(entry) === flightNoUpper);
  trace.matchAttempt1Precise.matched = Boolean(matched);

  // 比對 attempt 2：codeshare array element fallback
  if (!matched) {
    trace.matchAttempt2Codeshare.triggered = true;
    matched = allEntries.find(({ entry }) => _codeShareIncludes(entry, flightNoUpper));
    trace.matchAttempt2Codeshare.matched = Boolean(matched);
  }

  if (!matched) return trace;

  trace.matchedRawEntry = matched.entry;
  trace.matchedIsDomestic = matched.isDomestic;
  trace.validation.flightFound = true;

  const result = _mapEntry(matched.entry, direction, matched.isDomestic);
  trace.mappedResult = result;
  if (!result) return trace;

  // Validation 1：至少一端機場在台灣
  const taiwanOk = _isTwAirport(result.departureAirport) || _isTwAirport(result.arrivalAirport);
  trace.validation.atLeastOneTwAirport = {
    result: taiwanOk,
    departure: result.departureAirport,
    arrival: result.arrivalAirport,
  };
  if (!taiwanOk) return trace;

  // Validation 2：日期在有效期區間
  const dateOk = _isInDateRange(date, result.effectiveStart, result.effectiveEnd);
  trace.validation.dateInRange = {
    result: dateOk,
    date,
    effectiveStart: result.effectiveStart,
    effectiveEnd: result.effectiveEnd,
  };
  if (!dateOk) return trace;

  // Validation 3：weekday
  const weekDay = _isoWeekDay(date);
  const weekdayOk = result.weekDays.includes(weekDay);
  trace.validation.weekdayMatches = {
    result: weekdayOk,
    isoWeekDay: weekDay,
    weekDays: result.weekDays,
  };
  if (!weekdayOk) return trace;

  trace.finalResult = result;
  return trace;
};
