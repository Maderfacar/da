/**
 * GET /api/flight?flightNo=CI102&direction=arrival
 * 查詢桃園機場 (TPE) 航班資訊
 *
 * - 有 NUXT_AVIATION_EDGE_KEY 時：呼叫 Aviation Edge timetable API
 * - 沒設 key（dev 環境）：fallback to _mockFlights，保持本地開發體驗
 *
 * Aviation Edge:
 *   GET https://aviation-edge.com/v2/public/timetable?key={KEY}&iataCode=TPE&type={arrival|departure}&flight_iata={flightNo}
 *   docs: https://aviation-edge.com/developers/
 *
 * direction:
 *   - 'arrival'   接機（航班抵達 TPE）
 *   - 'departure' 送機（航班從 TPE 起飛）
 *   - 預設 arrival
 */

export interface FlightInfo {
  flightNo: string;
  airline: { iataCode: string; name: string };
  origin: { iataCode: string; cityName: string };
  destination: { iataCode: string; cityName: string };
  terminal: '1' | '2';
  scheduledTime: string;   // ISO 8601
  estimatedTime: string;   // ISO 8601
  status: 'scheduled' | 'active' | 'landed' | 'delayed' | 'cancelled';
  direction: 'arrival' | 'departure';
}

type Direction = 'arrival' | 'departure';

// ── Aviation Edge response 型別（局部，僅取我們需要的欄位）──
// flightsFuture endpoint 用，scheduledTime 為 'HH:mm' 字串、無 status / actualTime
interface AeAirport {
  iataCode?: string;
  icaoCode?: string;
  terminal?: string | null;
  gate?: string | null;
  scheduledTime?: string; // flightsFuture: 'HH:mm'
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

// ── 簡易 in-memory cache（避免 rate limit）─────────────────
// key = `${flightNo}|${direction}`，TTL 5 分鐘
const _cache = new Map<string, { exp: number; data: FlightInfo | null }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const _normalizeTerminal = (t?: string | null): '1' | '2' => {
  if (!t) return '1';
  const v = t.trim();
  if (v === '1' || v === '2') return v;
  // Aviation Edge 偶有 '1A', 'T1', '01' 等格式
  if (v.includes('1')) return '1';
  if (v.includes('2')) return '2';
  return '1';
};

const _airlineCityFallback = (iataCode?: string): string => {
  // 簡易 IATA 城市對照（避免 Aviation Edge 不回 cityName 時 UI 空白）
  const m: Record<string, string> = {
    TPE: '台北', NRT: '東京', HND: '東京', KIX: '大阪', ITM: '大阪',
    LAX: '洛杉磯', SFO: '舊金山', JFK: '紐約', LHR: '倫敦', FRA: '法蘭克福',
    HKG: '香港', SIN: '新加坡', BKK: '曼谷', ICN: '首爾', GMP: '首爾',
    PVG: '上海', PEK: '北京', CAN: '廣州', SZX: '深圳', MFM: '澳門',
  };
  return iataCode ? (m[iataCode.toUpperCase()] ?? iataCode) : '—';
};

// 把 'HH:mm' + 'YYYY-MM-DD' 組成 ISO（TPE 在 UTC+8 → 帶 +08:00 offset）
const _composeIso = (date: string, hhmm: string): string => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map((s) => s.padStart(2, '0'));
  return `${date}T${h}:${m}:00+08:00`;
};

// 把 Aviation Edge flightsFuture entry 轉為 FlightInfo
const _mapAeFuture = (
  entry: AeFutureEntry,
  flightNoUpper: string,
  direction: Direction,
  date: string,
): FlightInfo => {
  const dep = entry.departure ?? {};
  const arr = entry.arrival ?? {};
  // 接機 (arrival)：terminal 看 arrival 抵達 TPE 的航廈
  // 送機 (departure)：terminal 看 departure 從 TPE 出去的航廈
  const terminal = _normalizeTerminal(direction === 'arrival' ? arr.terminal : dep.terminal);
  // 時間：focus 的 scheduledTime 是 'HH:mm' 字串
  const focus = direction === 'arrival' ? arr : dep;
  const scheduledTime = _composeIso(date, focus.scheduledTime ?? '');

  return {
    flightNo: flightNoUpper,
    airline: {
      iataCode: entry.airline?.iataCode?.toUpperCase() ?? '',
      name: entry.airline?.name ?? '',
    },
    origin: {
      iataCode: dep.iataCode?.toUpperCase() ?? '',
      cityName: _airlineCityFallback(dep.iataCode),
    },
    destination: {
      iataCode: arr.iataCode?.toUpperCase() ?? '',
      cityName: _airlineCityFallback(arr.iataCode),
    },
    terminal,
    scheduledTime,
    estimatedTime: scheduledTime, // future 沒有 estimate，用 scheduled
    status: 'scheduled',
    direction,
  };
};

// 從 flightNo 拆出 airline IATA（前 2 碼字母 / 數字字母混合）
// 'JX801' → 'JX'、'CI3' → 'CI'、'BR832' → 'BR'、'9W1' → '9W'
const _parseAirlineIata = (flightNoUpper: string): string => {
  const m = flightNoUpper.match(/^([A-Z0-9]{2})\d+$/);
  return m?.[1] ?? '';
};

// ── 真實 API call ──────────────────────────────────────────
// 用 /flightsFuture（依日期查未來航班排程，覆蓋廣，可查任何日期）
// /timetable 只涵蓋當前/未來 1-2 天即時排程，使用者訂遠日期會查不到，故不採用
//
// Aviation Edge 對 flight_iata / flight_num filter 不 work（都回 No Record Found），
// 只有 airline_iata 過濾可用。策略：用 airline_iata 抓該航空公司全部 TPE 排程，
// server 端 filter 對應的 iataNumber。
const _queryAviationEdge = async (
  apiKey: string,
  flightNoUpper: string,
  direction: Direction,
  date: string,
): Promise<FlightInfo | null> => {
  const airlineIata = _parseAirlineIata(flightNoUpper);
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

  // 先找 iataNumber 完全相符的（Aviation Edge 回傳是 lowercase 'jx833'）
  const flightLower = flightNoUpper.toLowerCase();
  const exact = result.find((e) => (e.flight?.iataNumber ?? '').toLowerCase() === flightLower);
  if (!exact) return null;
  return _mapAeFuture(exact, flightNoUpper, direction, date);
};

// ── Mock 資料（dev 環境 fallback）────────────────────────────────────
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

const _queryMock = (flightNoUpper: string, direction: Direction): FlightInfo | null => {
  const mock = _mockFlights[flightNoUpper];
  if (!mock) return null;
  // mock 只保留 direction 一致的；不一致回 null（同 real API 行為）
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

// 驗證 'YYYY-MM-DD'（接受寬鬆但確認結構）
const _isValidDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// 取「今天 (Asia/Taipei)」的 YYYY-MM-DD（fallback 用）
const _todayInTaipei = (): string => {
  const now = new Date();
  // toLocaleDateString with sv-SE locale → 'YYYY-MM-DD'
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
};

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { flightNo?: string; direction?: string; date?: string };
  const flightNoUpper = (query.flightNo ?? '').toUpperCase().replace(/\s/g, '');
  const direction: Direction = query.direction === 'departure' ? 'departure' : 'arrival';
  const date = (query.date && _isValidDate(query.date)) ? query.date : _todayInTaipei();

  if (!flightNoUpper) {
    setResponseStatus(event, 400);
    return { ok: false, message: 'flightNo is required' };
  }

  // cache 命中（key 含 date，避免不同日期共用結果）
  const cacheKey = `${flightNoUpper}|${direction}|${date}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.exp > Date.now()) {
    if (cached.data) return { ok: true, data: cached.data };
    setResponseStatus(event, 404);
    return { ok: false, message: `Flight ${flightNoUpper} not found` };
  }

  const { aviationEdgeKey } = useRuntimeConfig();

  let data: FlightInfo | null = null;
  let usedSource: 'live' | 'mock' = 'mock';

  if (aviationEdgeKey) {
    try {
      data = await _queryAviationEdge(aviationEdgeKey, flightNoUpper, direction, date);
      usedSource = 'live';
    } catch (err) {
      // API 失敗（網路 / 401 / 5xx）：log + fallback to mock 維持基本可用性
      console.error('[api/flight] Aviation Edge call failed, falling back to mock:', err);
      data = _queryMock(flightNoUpper, direction);
    }
  } else {
    data = _queryMock(flightNoUpper, direction);
  }

  // 寫 cache（含 null，避免持續打 API 查不存在航班）
  _cache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, data });

  if (!data) {
    setResponseStatus(event, 404);
    return { ok: false, message: `Flight ${flightNoUpper} not found`, source: usedSource };
  }
  return { ok: true, data, source: usedSource };
});
