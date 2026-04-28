/**
 * GET /api/flight?flightNo=CI102&direction=arrival
 * 模擬 Aviation Edge 格式，查詢桃園機場航班資訊
 * direction: 'arrival'（接機）| 'departure'（送機），預設 arrival
 *
 * 正式串接時替換 _mockFlights 為 Aviation Edge API 呼叫：
 *   GET https://aviation-edge.com/v2/public/timetable?key={KEY}&iataCode=TPE&type=arrival&flight_iata={flightNo}
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

// ── Mock 資料（模擬 Aviation Edge 格式）────────────────────────────────────────
const _mockFlights: Record<string, Omit<FlightInfo, 'flightNo' | 'scheduledTime' | 'estimatedTime'>> = {
  // China Airlines — 第一航廈
  CI102: { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'NRT', cityName: '東京' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '1', status: 'active',    direction: 'arrival' },
  CI100: { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'HND', cityName: '東京' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '1', status: 'scheduled', direction: 'arrival' },
  CI001: { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'LAX', cityName: '洛杉磯' }, terminal: '1', status: 'scheduled', direction: 'departure' },
  CI3:   { airline: { iataCode: 'CI', name: '中華航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'JFK', cityName: '紐約' },    terminal: '1', status: 'delayed',   direction: 'departure' },
  // EVA Air — 第二航廈
  BR12:  { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'LAX', cityName: '洛杉磯' },   destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'active',    direction: 'arrival' },
  BR6:   { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'SFO', cityName: '舊金山' },   destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'delayed',   direction: 'arrival' },
  BR9:   { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'LHR', cityName: '倫敦' },   terminal: '2', status: 'scheduled', direction: 'departure' },
  BR832: { airline: { iataCode: 'BR', name: '長榮航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'NRT', cityName: '東京' },  terminal: '2', status: 'active',    direction: 'departure' },
  // Japan Airlines — 第二航廈
  JL99:  { airline: { iataCode: 'JL', name: '日本航空' }, origin: { iataCode: 'HND', cityName: '東京' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'landed',    direction: 'arrival' },
  JL97:  { airline: { iataCode: 'JL', name: '日本航空' }, origin: { iataCode: 'KIX', cityName: '大阪' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'scheduled', direction: 'arrival' },
  // Cathay Pacific — 第二航廈
  CX400: { airline: { iataCode: 'CX', name: '國泰航空' }, origin: { iataCode: 'HKG', cityName: '香港' },     destination: { iataCode: 'TPE', cityName: '台北' }, terminal: '2', status: 'active',    direction: 'arrival' },
  CX401: { airline: { iataCode: 'CX', name: '國泰航空' }, origin: { iataCode: 'TPE', cityName: '台北' },     destination: { iataCode: 'HKG', cityName: '香港' }, terminal: '2', status: 'scheduled', direction: 'departure' },
};

function _buildTime(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
  return d.toISOString();
}

export default defineEventHandler((event) => {
  const query = getQuery(event) as { flightNo?: string; direction?: string };
  const flightNo = (query.flightNo ?? '').toUpperCase().replace(/\s/g, '');

  if (!flightNo) {
    setResponseStatus(event, 400);
    return { ok: false, message: 'flightNo is required' };
  }

  const mock = _mockFlights[flightNo];
  if (!mock) {
    setResponseStatus(event, 404);
    return { ok: false, message: `Flight ${flightNo} not found` };
  }

  // 動態產生時間（避免靜態時間在展示時顯示過去）
  const timeOffsets: Record<typeof mock.status, [number, number]> = {
    scheduled: [90, 90],   // [排班偏移, 預估偏移]（分鐘）
    active:    [30, 35],
    landed:    [-10, -8],
    delayed:   [60, 110],  // 預估晚 50 分鐘
    cancelled: [120, 120],
  };
  const [schedOffset, estOffset] = timeOffsets[mock.status];

  const result: FlightInfo = {
    flightNo,
    ...mock,
    scheduledTime: _buildTime(schedOffset),
    estimatedTime: _buildTime(estOffset),
  };

  return { ok: true, data: result };
});
