/**
 * POST /api/flight/manual
 *
 * 手動 fallback：當 GET /api/flight 4 層 fallback 全 miss、user 仍想 booking 時，
 * 由 user 手動填航廈 + 時間，server 寫入 flight_registry/{flightNo}.manualSchedules
 * 並回傳組好的 FlightInfo，前端拿來繼續走 booking 流程。
 *
 * 設計（spec 2026-05-12）：
 *   - require-auth：booking page 已有 auth middleware，user 必登入
 *   - 寫入 manualSchedules[key]（不污染 TDX / AE schedules）
 *   - submittedByLineUid 紀錄填寫者，方便日後追問題訂單
 *   - silent write：寫 Firestore 失敗仍回 FlightInfo（user 至少能繼續 booking）
 *
 * Response 格式同 GET /api/flight：`{ ok, data?, message?, source }`
 *   - source: 'manual' 表示這次回傳由 user 手填組成
 */

import { GetAirlineNameByIata, GetAirportCityByIata, ParseAirlineIataFromFlightNo } from '@@/utils/airport-registry';
import { SaveManualScheduleToRegistry, type FlightDirection } from '@@/utils/flight-registry';
import { getAuthFromEvent } from '@@/utils/require-auth';
import type { FlightInfo } from '../flight.get';

interface ManualFlightBody {
  flightNo?: string;
  direction?: string;
  date?: string;          // 'YYYY-MM-DD'
  terminal?: string;      // '1' | '2'
  scheduledTime?: string; // 'HH:mm'
}

// 桃園機場 IATA — manual fallback 一律假設 TPE 是 user 端對應的機場
// （T1/T2 即桃園航廈；國內線/松山小港等 case 走 TDX，不會落到 manual）
const TPE_IATA = 'TPE';
const TPE_CITY = '桃園';

const _isValidDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const _isValidHHmm = (s: string): boolean =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const _composeIso = (date: string, hhmm: string): string => {
  const [h, m] = hhmm.split(':').map((n) => n.padStart(2, '0'));
  return `${date}T${h}:${m}:00+08:00`;
};

export default defineEventHandler(async (event) => {
  // 要求登入：避免匿名亂寫污染 registry
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.code);
    return { ok: false, message: auth.message.zh_tw };
  }

  const body = await readBody<ManualFlightBody>(event);
  const flightNoUpper = (body.flightNo ?? '').toUpperCase().replace(/\s/g, '');
  const direction: FlightDirection = body.direction === 'departure' ? 'departure' : 'arrival';
  const date = body.date ?? '';
  const terminal = body.terminal ?? '';
  const scheduledTime = body.scheduledTime ?? '';

  // ── 驗證 ──────────────────────────────────────────────────
  if (!flightNoUpper || flightNoUpper.length < 3 || flightNoUpper.length > 8) {
    setResponseStatus(event, 400);
    return { ok: false, message: 'flightNo invalid' };
  }
  if (body.direction !== 'arrival' && body.direction !== 'departure') {
    setResponseStatus(event, 400);
    return { ok: false, message: 'direction must be arrival or departure' };
  }
  if (!_isValidDate(date)) {
    setResponseStatus(event, 400);
    return { ok: false, message: 'date must be YYYY-MM-DD' };
  }
  if (terminal !== '1' && terminal !== '2') {
    setResponseStatus(event, 400);
    return { ok: false, message: 'terminal must be 1 or 2' };
  }
  if (!_isValidHHmm(scheduledTime)) {
    setResponseStatus(event, 400);
    return { ok: false, message: 'scheduledTime must be HH:mm' };
  }

  // ── 組 FlightInfo + 寫 registry ──────────────────────────────
  const airlineCode = ParseAirlineIataFromFlightNo(flightNoUpper);
  const airlineName = GetAirlineNameByIata(airlineCode) || airlineCode;
  const scheduledIso = _composeIso(date, scheduledTime);

  // direction=arrival → 對方機場是出發地，TPE 是目的地；departure 反之
  // 對方機場 user 沒填，留空（顯示 '—' 由前端 fallback）
  const departureIata = direction === 'arrival' ? '' : TPE_IATA;
  const departureCity = direction === 'arrival' ? '' : TPE_CITY;
  const arrivalIata = direction === 'arrival' ? TPE_IATA : '';
  const arrivalCity = direction === 'arrival' ? TPE_CITY : '';

  const flightInfo: FlightInfo = {
    flightNo: flightNoUpper,
    airline: { iataCode: airlineCode, name: airlineName },
    origin: {
      iataCode: departureIata,
      cityName: departureCity || GetAirportCityByIata(departureIata),
    },
    destination: {
      iataCode: arrivalIata,
      cityName: arrivalCity || GetAirportCityByIata(arrivalIata),
    },
    terminal: terminal as '1' | '2',
    scheduledTime: scheduledIso,
    estimatedTime: scheduledIso,
    status: 'scheduled',
    direction,
  };

  // silent write — 失敗也回 FlightInfo 讓 user 繼續 booking
  await SaveManualScheduleToRegistry({
    flightNo: flightNoUpper,
    airlineCode,
    airlineName,
    date,
    direction,
    schedule: {
      scheduledTime: scheduledIso,
      estimatedTime: scheduledIso,
      status: 'scheduled',
      terminal: terminal as '1' | '2',
      departureIata,
      departureCity,
      arrivalIata,
      arrivalCity,
      submittedByLineUid: auth.lineUid,
    },
  });

  return { ok: true, data: flightInfo, source: 'manual' as const };
});
