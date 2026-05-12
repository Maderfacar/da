/**
 * GET /api/flight?flightNo=CI102&direction=arrival&date=YYYY-MM-DD
 *
 * 桃園機場 (TPE) + TSA / KHH / RMQ 航班查詢 — 多層 fallback + 自學 registry
 *
 *   Layer 1：in-memory hot cache（5 min, per process）
 *           ↓ miss
 *   Layer 2A：Firestore `flight_registry.tdx`（spec 2026-05-12）
 *           - 命中且 tdx 子物件 < 24h → 秒渲染回傳（用 scheduledTime 當 estimatedTime）
 *           ↓ miss / stale
 *   Layer 2B：Firestore `flight_registry.schedules`（Aviation Edge 既有寫入；保留向下相容）
 *           - 命中且 schedule cache < 30 min → 秒渲染回傳
 *           ↓ miss / stale
 *   Layer 3：TDX API（spec 2026-05-12，booking 階段主要資料源）
 *           - Domestic + International 雙 endpoint 並行
 *           - Codeshare 雙向比對
 *           - 4 條 validation：找得到 + 至少一端在台灣 + 日期在有效期 + weekday 符合
 *           - 取得後立即寫回 flight_registry.tdx（self-learning）
 *           ↓ miss / fail
 *   Layer 4：Aviation Edge API（booking 階段已 hold；helper 保留不調用，等之後接「即時狀態」）
 *
 *   收尾：API 失敗但 registry 還有 stale → 仍回給使用者；都沒 → dev mock / prod 404
 *
 * 額外機制：
 *   - Request collapsing：同 flightNo|direction|date 同時來多 request 共享一個 in-flight Promise
 *   - 寫 Firestore registry 失敗一律 silent log，不影響當次回應
 */

import {
  GetAirlineNameByIata,
  GetAirportCityByIata,
  ParseAirlineIataFromFlightNo,
} from '@@/utils/airport-registry';
import {
  GetFlightFromRegistry,
  GetCachedSchedule,
  IsRegistryStaticFresh,
  IsScheduleFresh,
  IsTdxBlockFresh,
  SaveFlightToRegistry,
  SaveTdxBlockToRegistry,
  type FlightDirection,
  type FlightRegistryDoc,
  type FlightRegistrySchedule,
  type FlightRegistryTdxBlock,
} from '@@/utils/flight-registry';
import {
  ComposeTdxTimestamp,
  QueryTdxFlight,
  QueryTdxFlightWithTrace,
  type TdxFlightResult,
} from '@@/utils/tdx-flight';

export interface FlightInfo {
  flightNo: string;
  airline: { iataCode: string; name: string };
  origin: { iataCode: string; cityName: string };
  destination: { iataCode: string; cityName: string };
  terminal: '1' | '2';
  scheduledTime: string;   // ISO 8601
  estimatedTime: string;   // ISO 8601
  status: 'scheduled' | 'active' | 'landed' | 'delayed' | 'cancelled';
  direction: FlightDirection;
}

type FlightSource = 'cache' | 'registry' | 'registry-tdx' | 'tdx' | 'live' | 'registry-stale' | 'mock';

// ── Aviation Edge response 型別（局部，僅取我們需要的欄位）──
interface AeAirport {
  iataCode?: string;
  icaoCode?: string;
  terminal?: string | null;
  gate?: string | null;
  scheduledTime?: string;
}
interface AeAirline {
  name?: string;
  iataCode?: string;
  icaoCode?: string;
}
interface AeFlight {
  number?: string;
  iataNumber?: string;
  icaoNumber?: string;
}
interface AeFutureEntry {
  weekday?: string;
  departure?: AeAirport;
  arrival?: AeAirport;
  airline?: AeAirline;
  flight?: AeFlight;
}
interface AeTimetableAirport extends AeAirport {
  scheduledTime?: string;
  estimatedTime?: string;
  actualTime?: string;
}
interface AeTimetableEntry {
  type?: FlightDirection;
  status?: string;
  departure?: AeTimetableAirport;
  arrival?: AeTimetableAirport;
  airline?: AeAirline;
  flight?: AeFlight;
}

const _statusMap: Record<string, FlightInfo['status']> = {
  scheduled: 'scheduled',
  active:    'active',
  landed:    'landed',
  delayed:   'delayed',
  cancelled: 'cancelled',
  redirected: 'delayed',
  diverted:   'delayed',
  unknown:    'scheduled',
};

// ── Layer 1：in-memory hot cache（5 min）+ request collapsing ────
const _cache = new Map<string, { exp: number; data: FlightInfo | null }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
/** 同 cacheKey 進行中的 promise，做請求合併避免重複打 API */
const _inflight = new Map<string, Promise<FlightLookupResult>>();

interface FlightLookupResult {
  data: FlightInfo | null;
  source: FlightSource;
}

const _normalizeTerminal = (t?: string | null): '1' | '2' => {
  if (!t) return '1';
  const v = t.trim();
  if (v === '1' || v === '2') return v;
  if (v.includes('1')) return '1';
  if (v.includes('2')) return '2';
  return '1';
};

const _composeIso = (date: string, hhmm: string): string => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map((s) => s.padStart(2, '0'));
  return `${date}T${h}:${m}:00+08:00`;
};

const _ensureTpeTimezone = (iso?: string): string => {
  if (!iso) return '';
  if (/[+-]\d{2}:?\d{2}$/.test(iso) || iso.endsWith('Z')) return iso;
  return `${iso}+08:00`;
};

// ── Aviation Edge mapper ───────────────────────────────────
const _mapAeFuture = (
  entry: AeFutureEntry,
  flightNoUpper: string,
  direction: FlightDirection,
  date: string,
): FlightInfo => {
  const dep = entry.departure ?? {};
  const arr = entry.arrival ?? {};
  const terminal = _normalizeTerminal(direction === 'arrival' ? arr.terminal : dep.terminal);
  const focus = direction === 'arrival' ? arr : dep;
  const scheduledTime = _composeIso(date, focus.scheduledTime ?? '');
  return {
    flightNo: flightNoUpper,
    airline: {
      iataCode: entry.airline?.iataCode?.toUpperCase() ?? '',
      name: entry.airline?.name || GetAirlineNameByIata(entry.airline?.iataCode),
    },
    origin: {
      iataCode: dep.iataCode?.toUpperCase() ?? '',
      cityName: GetAirportCityByIata(dep.iataCode),
    },
    destination: {
      iataCode: arr.iataCode?.toUpperCase() ?? '',
      cityName: GetAirportCityByIata(arr.iataCode),
    },
    terminal,
    scheduledTime,
    estimatedTime: scheduledTime,
    status: 'scheduled',
    direction,
  };
};

const _mapAeTimetable = (
  entry: AeTimetableEntry,
  flightNoUpper: string,
  direction: FlightDirection,
): FlightInfo => {
  const dep = entry.departure ?? {};
  const arr = entry.arrival ?? {};
  const terminal = _normalizeTerminal(direction === 'arrival' ? arr.terminal : dep.terminal);
  const focus = direction === 'arrival' ? arr : dep;
  const scheduledTime = _ensureTpeTimezone(focus.scheduledTime);
  const estimatedTime = _ensureTpeTimezone(focus.estimatedTime ?? focus.actualTime ?? focus.scheduledTime);
  return {
    flightNo: flightNoUpper,
    airline: {
      iataCode: entry.airline?.iataCode?.toUpperCase() ?? '',
      name: entry.airline?.name || GetAirlineNameByIata(entry.airline?.iataCode),
    },
    origin: {
      iataCode: dep.iataCode?.toUpperCase() ?? '',
      cityName: GetAirportCityByIata(dep.iataCode),
    },
    destination: {
      iataCode: arr.iataCode?.toUpperCase() ?? '',
      cityName: GetAirportCityByIata(arr.iataCode),
    },
    terminal,
    scheduledTime,
    estimatedTime,
    status: _statusMap[(entry.status ?? '').toLowerCase()] ?? 'scheduled',
    direction,
  };
};

// ── Aviation Edge API call ─────────────────────────────────
const _queryAeTimetable = async (
  apiKey: string,
  flightNoUpper: string,
  direction: FlightDirection,
): Promise<FlightInfo | null> => {
  const airlineIata = ParseAirlineIataFromFlightNo(flightNoUpper);
  if (!airlineIata) return null;

  const url = 'https://aviation-edge.com/v2/public/timetable';
  const result = await $fetch<AeTimetableEntry[] | { error?: string } | null>(url, {
    method: 'GET',
    query: { key: apiKey, iataCode: 'TPE', type: direction, airline_iata: airlineIata },
    timeout: 10000,
  });
  if (!Array.isArray(result) || result.length === 0) return null;

  const flightLower = flightNoUpper.toLowerCase();
  const exact = result.find((e) => (e.flight?.iataNumber ?? '').toLowerCase() === flightLower);
  if (!exact) return null;
  return _mapAeTimetable(exact, flightNoUpper, direction);
};

const _queryAeFuture = async (
  apiKey: string,
  flightNoUpper: string,
  direction: FlightDirection,
  date: string,
): Promise<FlightInfo | null> => {
  const airlineIata = ParseAirlineIataFromFlightNo(flightNoUpper);
  if (!airlineIata) return null;

  const url = 'https://aviation-edge.com/v2/public/flightsFuture';
  const result = await $fetch<AeFutureEntry[] | { error?: string } | null>(url, {
    method: 'GET',
    query: {
      key: apiKey,
      iataCode: 'TPE',
      type: direction,
      date,
      airline_iata: airlineIata,
    },
    timeout: 10000,
  });

  if (!Array.isArray(result) || result.length === 0) return null;

  const flightLower = flightNoUpper.toLowerCase();
  const exact = result.find((e) => (e.flight?.iataNumber ?? '').toLowerCase() === flightLower);
  if (!exact) return null;
  return _mapAeFuture(exact, flightNoUpper, direction, date);
};

const _callAviationEdge = async (
  apiKey: string,
  flightNoUpper: string,
  direction: FlightDirection,
  date: string,
): Promise<FlightInfo | null> => {
  const today = _todayInTaipei();
  const daysFromNow = Math.round(
    (Date.parse(`${date}T00:00:00+08:00`) - Date.parse(`${today}T00:00:00+08:00`)) / 86400000,
  );
  if (daysFromNow < 7) {
    return _queryAeTimetable(apiKey, flightNoUpper, direction);
  }
  return _queryAeFuture(apiKey, flightNoUpper, direction, date);
};

// ── registry → FlightInfo / FlightInfo → registry schedule ──
const _scheduleToFlightInfo = (
  doc: FlightRegistryDoc,
  schedule: FlightRegistrySchedule,
  flightNoUpper: string,
  direction: FlightDirection,
): FlightInfo => {
  return {
    flightNo: flightNoUpper,
    airline: {
      iataCode: doc.airlineCode || ParseAirlineIataFromFlightNo(flightNoUpper),
      name: doc.airlineName || GetAirlineNameByIata(doc.airlineCode),
    },
    origin: {
      iataCode: schedule.departureIata,
      cityName: schedule.departureCity || GetAirportCityByIata(schedule.departureIata),
    },
    destination: {
      iataCode: schedule.arrivalIata,
      cityName: schedule.arrivalCity || GetAirportCityByIata(schedule.arrivalIata),
    },
    terminal: _normalizeTerminal(schedule.terminal),
    scheduledTime: schedule.scheduledTime,
    estimatedTime: schedule.estimatedTime || schedule.scheduledTime,
    status: (_statusMap[schedule.status?.toLowerCase()] ?? 'scheduled') as FlightInfo['status'],
    direction,
  };
};

const _flightInfoToScheduleData = (
  info: FlightInfo,
): Omit<FlightRegistrySchedule, 'fetchedAtMillis'> => ({
  scheduledTime: info.scheduledTime,
  estimatedTime: info.estimatedTime,
  status: info.status,
  terminal: info.terminal,
  departureIata: info.origin.iataCode,
  departureCity: info.origin.cityName,
  arrivalIata: info.destination.iataCode,
  arrivalCity: info.destination.cityName,
});

// ── TDX → FlightInfo mapper（spec 2026-05-12）─────────────────
/**
 * TDX GeneralSchedule 是「週期性排程」，沒有 active/landed/delayed 動態狀態，也沒有 actualTime。
 * 用 scheduledTime 當 estimatedTime（user 拍板方案 a），status 一律 'scheduled'。
 * 等之後接 Aviation Edge 即時狀態時，會由另一條 endpoint 覆蓋這兩個欄位。
 */
const _tdxResultToFlightInfo = (
  tdx: TdxFlightResult,
  airlineName: string,
  date: string,
  direction: FlightDirection,
): FlightInfo => {
  // 取「對應 direction」的時間：arrival 用 scheduledArrival，departure 用 scheduledDeparture
  const focusTime = direction === 'arrival' ? tdx.scheduledArrival : tdx.scheduledDeparture;
  const scheduledIso = ComposeTdxTimestamp(date, focusTime);
  return {
    flightNo: tdx.flightNo,
    airline: { iataCode: tdx.airlineCode, name: airlineName || GetAirlineNameByIata(tdx.airlineCode) },
    origin: {
      iataCode: tdx.departureAirport,
      cityName: GetAirportCityByIata(tdx.departureAirport),
    },
    destination: {
      iataCode: tdx.arrivalAirport,
      cityName: GetAirportCityByIata(tdx.arrivalAirport),
    },
    terminal: _normalizeTerminal(tdx.terminal),
    scheduledTime: scheduledIso,
    estimatedTime: scheduledIso,
    status: 'scheduled',
    direction,
  };
};

/** 從 flight_registry.tdx 子物件直接組 FlightInfo（Layer 2A 命中時用） */
const _registryTdxToFlightInfo = (
  doc: FlightRegistryDoc,
  tdx: FlightRegistryTdxBlock,
  flightNoUpper: string,
  date: string,
  direction: FlightDirection,
): FlightInfo => {
  const focusTime = direction === 'arrival' ? tdx.scheduledArrival : tdx.scheduledDeparture;
  const scheduledIso = ComposeTdxTimestamp(date, focusTime);
  return {
    flightNo: flightNoUpper,
    airline: {
      iataCode: doc.airlineCode,
      name: doc.airlineName || GetAirlineNameByIata(doc.airlineCode),
    },
    origin: {
      iataCode: tdx.departureAirport,
      cityName: GetAirportCityByIata(tdx.departureAirport),
    },
    destination: {
      iataCode: tdx.arrivalAirport,
      cityName: GetAirportCityByIata(tdx.arrivalAirport),
    },
    terminal: _normalizeTerminal(tdx.terminal),
    scheduledTime: scheduledIso,
    estimatedTime: scheduledIso,
    status: 'scheduled',
    direction,
  };
};

/**
 * 檢查 TDX 子物件對「指定 date + direction」是否仍有效（schedule 在有效期內 + weekday 符合）。
 * registry 內的 tdx 子物件是「該航班的週期性排程快照」，不同 date 都共用同一份 — 故每次取用都要驗證。
 */
const _isTdxBlockApplicable = (tdx: FlightRegistryTdxBlock, date: string): boolean => {
  if (tdx.effectiveStart && date < tdx.effectiveStart) return false;
  if (tdx.effectiveEnd && date > tdx.effectiveEnd) return false;
  const d = new Date(`${date}T00:00:00+08:00`);
  const sunday0 = d.getDay();
  const isoWeekDay = sunday0 === 0 ? 7 : sunday0;
  return tdx.weekDays.includes(isoWeekDay);
};

// ── Mock 資料（dev 環境 fallback）─────────────────────────────
const _mockFlights: Record<string, Omit<FlightInfo, 'flightNo' | 'scheduledTime' | 'estimatedTime'>> = {
  CI102: { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'NRT', cityName: '東京' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '1', status: 'active',    direction: 'arrival' },
  CI100: { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'HND', cityName: '東京' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '1', status: 'scheduled', direction: 'arrival' },
  CI001: { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'LAX', cityName: '洛杉磯' }, terminal: '1', status: 'scheduled', direction: 'departure' },
  CI3:   { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'JFK', cityName: '紐約' },    terminal: '1', status: 'delayed',   direction: 'departure' },
  BR12:  { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'LAX', cityName: '洛杉磯' },   destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'active',    direction: 'arrival' },
  BR6:   { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'SFO', cityName: '舊金山' },   destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'delayed',   direction: 'arrival' },
  BR9:   { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'LHR', cityName: '倫敦' },   terminal: '2', status: 'scheduled', direction: 'departure' },
  BR832: { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'NRT', cityName: '東京' },  terminal: '2', status: 'active',    direction: 'departure' },
  JL99:  { airline: { iataCode: 'JL', name: '日本航空' }, origin: { iataCode: 'HND', cityName: '東京' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'landed',    direction: 'arrival' },
  JL97:  { airline: { iataCode: 'JL', name: '日本航空' }, origin: { iataCode: 'KIX', cityName: '大阪' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'scheduled', direction: 'arrival' },
  CX400: { airline: { iataCode: 'CX', name: '國泰航空' }, origin: { iataCode: 'HKG', cityName: '香港' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'active',    direction: 'arrival' },
  CX401: { airline: { iataCode: 'CX', name: '國泰航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'HKG', cityName: '香港' }, terminal: '2', status: 'scheduled', direction: 'departure' },
};

const _buildMockTime = (offsetMinutes: number): string => {
  const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
  return d.toISOString();
};

const _queryMock = (flightNoUpper: string, direction: FlightDirection): FlightInfo | null => {
  const mock = _mockFlights[flightNoUpper];
  if (!mock) return null;
  if (mock.direction !== direction) return null;
  const BASE = mock.direction === 'departure' ? 25 * 60 : 0;
  const offsets: Record<FlightInfo['status'], [number, number]> = {
    scheduled: [90,  90],
    active:    [30,  35],
    landed:    [-10, -8],
    delayed:   [60,  110],
    cancelled: [120, 120],
  };
  const [s, e] = offsets[mock.status].map((m) => m + BASE) as [number, number];
  return {
    flightNo: flightNoUpper,
    ...mock,
    scheduledTime: _buildMockTime(s),
    estimatedTime: _buildMockTime(e),
  };
};

// ── 工具 ─────────────────────────────────────────────────────
const _isValidDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const _todayInTaipei = (): string => {
  const now = new Date();
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
};

// ── 核心查詢流程（多層 fallback + self-learning） ───────────────
// spec 2026-05-12：Booking 階段改用 TDX 為主資料源，Aviation Edge 暫時 hold。
// helper 保留在本檔（_callAviationEdge 等），等之後接「即時狀態」階段再啟用。
const _lookupFlight = async (
  flightNoUpper: string,
  direction: FlightDirection,
  date: string,
): Promise<FlightLookupResult> => {
  const { tdxClientId, tdxClientSecret, aviationEdgeKey } = useRuntimeConfig();

  // 預先讀 Firestore registry — Layer 2A/2B + 後段 stale fallback 共用
  let registryDoc: FlightRegistryDoc | null = null;
  try {
    registryDoc = await GetFlightFromRegistry(flightNoUpper);
  } catch (err) {
    console.error('[api/flight] registry read failed:', err);
  }

  // ── Layer 2A：Firestore registry.tdx（spec 2026-05-12）──
  // tdx 子物件 < 24h 且該 date 仍在 effective 區間 + weekday 符合 → 秒回
  if (registryDoc?.tdx && IsTdxBlockFresh(registryDoc.tdx) && _isTdxBlockApplicable(registryDoc.tdx, date)) {
    const data = _registryTdxToFlightInfo(registryDoc, registryDoc.tdx, flightNoUpper, date, direction);
    return { data, source: 'registry-tdx' };
  }

  // ── Layer 2B：Firestore registry.schedules（Aviation Edge 既有寫入；保留向下相容）──
  if (registryDoc && IsRegistryStaticFresh(registryDoc)) {
    const cachedSchedule = GetCachedSchedule(registryDoc, date, direction);
    if (cachedSchedule && IsScheduleFresh(cachedSchedule)) {
      const data = _scheduleToFlightInfo(registryDoc, cachedSchedule, flightNoUpper, direction);
      return { data, source: 'registry' };
    }
  }

  // ── Layer 3：TDX API（Booking 主資料源） ──
  if (tdxClientId && tdxClientSecret) {
    try {
      const tdx = await QueryTdxFlight(tdxClientId, tdxClientSecret, flightNoUpper, direction, date);
      if (tdx) {
        const airlineName = registryDoc?.airlineName || GetAirlineNameByIata(tdx.airlineCode);
        const data = _tdxResultToFlightInfo(tdx, airlineName, date, direction);
        // self-learning：寫回 Firestore.tdx（silent on failure）
        void SaveTdxBlockToRegistry({
          flightNo: flightNoUpper,
          airlineCode: tdx.airlineCode,
          airlineName,
          tdx: {
            isDomestic: tdx.isDomestic,
            departureAirport: tdx.departureAirport,
            arrivalAirport: tdx.arrivalAirport,
            terminal: tdx.terminal,
            scheduledDeparture: tdx.scheduledDeparture,
            scheduledArrival: tdx.scheduledArrival,
            weekDays: tdx.weekDays,
            effectiveStart: tdx.effectiveStart,
            effectiveEnd: tdx.effectiveEnd,
            codeShare: tdx.codeShare,
            operatingAirlineCode: tdx.operatingAirlineCode,
            operatingFlightNumber: tdx.operatingFlightNumber,
          },
        });
        return { data, source: 'tdx' };
      }
    } catch (err) {
      console.error('[api/flight] TDX call failed:', err);
    }
  }

  // ── Layer 4：Aviation Edge（spec 2026-05-12 booking 階段已 hold；helper 保留不調用）──
  // 若之後接「即時狀態」階段，這段會被改回啟用 — _callAviationEdge / _queryAeTimetable
  // / _queryAeFuture / _mapAeFuture / _mapAeTimetable 全部留在本檔。

  // ── Stale fallback：所有 API miss 但 registry 還有任何排程資料 → 仍回給使用者 ──
  if (registryDoc?.tdx && _isTdxBlockApplicable(registryDoc.tdx, date)) {
    const data = _registryTdxToFlightInfo(registryDoc, registryDoc.tdx, flightNoUpper, date, direction);
    return { data, source: 'registry-stale' };
  }
  if (registryDoc && IsRegistryStaticFresh(registryDoc)) {
    const stale = GetCachedSchedule(registryDoc, date, direction);
    if (stale) {
      const data = _scheduleToFlightInfo(registryDoc, stale, flightNoUpper, direction);
      return { data, source: 'registry-stale' };
    }
  }

  // ── 保險絲：dev mock（沒設 TDX 與 Aviation Edge key 才走，方便本地測試）──
  if (!tdxClientId && !aviationEdgeKey) {
    const mock = _queryMock(flightNoUpper, direction);
    if (mock) return { data: mock, source: 'mock' };
  }

  return { data: null, source: tdxClientId ? 'tdx' : 'mock' };
};

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { flightNo?: string; direction?: string; date?: string; debug?: string };
  const flightNoUpper = (query.flightNo ?? '').toUpperCase().replace(/\s/g, '');
  const direction: FlightDirection = query.direction === 'departure' ? 'departure' : 'arrival';
  const date = (query.date && _isValidDate(query.date)) ? query.date : _todayInTaipei();
  const isDebug = query.debug === '1';

  if (!flightNoUpper) {
    setResponseStatus(event, 400);
    return { ok: false, message: 'flightNo is required' };
  }

  const cacheKey = `${flightNoUpper}|${direction}|${date}`;

  // Debug 模式：繞過 cache，dump 完整 trace（OAuth / 雙 endpoint / 比對 / 4 條 validation）
  // 順手清掉這個 key 的 in-memory cache（解 prod 上「之前失敗 cached null」的問題）
  if (isDebug) {
    _cache.delete(cacheKey);
    const cfg = useRuntimeConfig();
    let registryDoc: FlightRegistryDoc | null = null;
    let registryErr: string | null = null;
    try {
      registryDoc = await GetFlightFromRegistry(flightNoUpper);
    } catch (err) {
      registryErr = err instanceof Error ? err.message : String(err);
    }
    const tdxTrace = (cfg.tdxClientId && cfg.tdxClientSecret)
      ? await QueryTdxFlightWithTrace(cfg.tdxClientId, cfg.tdxClientSecret, flightNoUpper, direction, date)
      : null;
    return {
      ok: Boolean(tdxTrace?.finalResult),
      debug: {
        env: {
          hasTdxClientId: Boolean(cfg.tdxClientId),
          hasTdxClientSecret: Boolean(cfg.tdxClientSecret),
          hasAviationEdgeKey: Boolean(cfg.aviationEdgeKey),
          hasFirebaseServiceAccount: Boolean(cfg.firebaseServiceAccountJson),
        },
        input: { flightNo: flightNoUpper, direction, date },
        registry: {
          hit: Boolean(registryDoc),
          hasTdxBlock: Boolean(registryDoc?.tdx),
          tdxBlock: registryDoc?.tdx ?? null,
          scheduleKeys: registryDoc?.schedules ? Object.keys(registryDoc.schedules) : [],
          error: registryErr,
        },
        tdx: tdxTrace,
      },
    };
  }

  // Layer 1：in-memory hot cache
  const cached = _cache.get(cacheKey);
  if (cached && cached.exp > Date.now()) {
    if (cached.data) return { ok: true, data: cached.data, source: 'cache' as const };
    setResponseStatus(event, 404);
    return { ok: false, message: `Flight ${flightNoUpper} not found`, source: 'cache' as const };
  }

  // Stage 2：Request collapsing — 同 key 同時來多 request 共用一個 promise
  let inflight = _inflight.get(cacheKey);
  if (!inflight) {
    inflight = _lookupFlight(flightNoUpper, direction, date)
      .finally(() => {
        _inflight.delete(cacheKey);
      });
    _inflight.set(cacheKey, inflight);
  }

  const result = await inflight;
  // 寫 hot cache（含 null，避免持續打 API 查不存在航班）
  _cache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, data: result.data });

  if (!result.data) {
    setResponseStatus(event, 404);
    return { ok: false, message: `Flight ${flightNoUpper} not found`, source: result.source };
  }
  return { ok: true, data: result.data, source: result.source };
});
