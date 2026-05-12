/**
 * 桃園機場 XLS 預報抓取器
 *
 * 流程：
 *   1) 直拼 URL 嘗試下載 https://www.taoyuan-airport.com/uploads/fos/{YYYY_MM_DD}.xls
 *   2) 若 404，cheerio 抓 https://www.taoyuanairport.com.tw/flightforecast 列表頁，找該日對應 a 標籤
 *   3) xlsx 解析「總計 / 第一航廈 / 第二航廈」三區塊全部 5 個流量欄位
 *
 * XLS 實際結構（驗證 2026/05/09，2026/05/12 擴 5 欄）：
 *   第 1 列：標題行（總計 / 起降航機 / 第一航廈 / 第二航廈）
 *   第 2 列：欄位行（時間區間 出發 抵達 轉機離站 到站轉機 過境離站 ...）
 *   第 3-26 列：24 小時資料
 *
 *   Column index 對照（每航廈區塊 5 個流量欄位）：
 *     總計區塊 [0] 時間 [1] 出發 [2] 抵達 [3] 轉機離站 [4] 到站轉機 [5] 過境離站
 *     T1 區塊  [10] 時間 [11] 出發 [12] 抵達 [13] 轉機離站 [14] 到站轉機 [15] 過境離站
 *     T2 區塊  [17] 時間 [18] 出發 [19] 抵達 [20] 轉機離站 [21] 到站轉機 [22] 過境離站
 *
 *   驗證：T1 + T2 各欄位 = 總計各欄位 ✓（含微誤差 ≤ 3）
 *
 *   P28（2026/05/12）：原 fetcher 只讀出發/抵達 2 欄；user 反映「全端進出境合計」對不上
 *   檔案總和，原因是漏抓轉機(11453+11619) + 過境(695)。本次擴 5 欄補齊資料層。
 *
 * 機場下載 URL 有反爬蟲檢測，必帶 User-Agent + Referer headers（n8n workflow 已驗證）。
 */
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';

const LISTING_URL = 'https://www.taoyuanairport.com.tw/flightforecast';
const DIRECT_URL_BASE = 'https://www.taoyuan-airport.com/uploads/fos';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*;q=0.9',
  'Referer': 'https://www.taoyuan-airport.com/',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

// XLS column index 設定（依實測結果，2026/05/12 擴至 5 欄/航廈）
const COL = {
  TOTAL_HOUR: 0,
  TOTAL_DEPARTURE: 1,
  TOTAL_ARRIVAL: 2,
  TOTAL_TRANSIT_DEPARTURE: 3,   // 轉機離站
  TOTAL_TRANSIT_ARRIVAL: 4,     // 到站轉機
  TOTAL_OVERNIGHT_DEPARTURE: 5, // 過境離站
  T1_DEPARTURE: 11,
  T1_ARRIVAL: 12,
  T1_TRANSIT_DEPARTURE: 13,
  T1_TRANSIT_ARRIVAL: 14,
  T1_OVERNIGHT_DEPARTURE: 15,
  T2_DEPARTURE: 18,
  T2_ARRIVAL: 19,
  T2_TRANSIT_DEPARTURE: 20,
  T2_TRANSIT_ARRIVAL: 21,
  T2_OVERNIGHT_DEPARTURE: 22,
} as const;

// fetcher 解析的 schema 版本（cache 不相容時用來判斷重抓）
// v3（2026/05/12）：加入 transit + overnight 流量欄位
export const SCHEMA_VERSION = 3;

export type Terminal = 'all' | 'T1' | 'T2';

// direction 命名：
//   - all                  進出境合計（出發 + 抵達）
//   - arrival              入境（抵達）
//   - departure            出境（出發）
//   - transit-arrival      到站轉機
//   - transit-departure    轉機離站
//   - overnight-departure  過境離站
//   - total                全部流量（出發 + 抵達 + 3 種轉/過境）
export type Direction =
  | 'all'
  | 'arrival'
  | 'departure'
  | 'transit-arrival'
  | 'transit-departure'
  | 'overnight-departure'
  | 'total';

export interface HourRecord {
  hour: number;
  forecastCount: number;
  terminal: Terminal;
  direction: Direction;
}

export interface ForecastResult {
  date: string;
  sourceFile: string;
  hours: HourRecord[];
  fetchedAt: number;
  schemaVersion: number;
}

/**
 * 抓取指定日期的人流預報
 * @param isoDate YYYY-MM-DD
 */
export async function FetchTaoyuanForecast(isoDate: string): Promise<ForecastResult> {
  const dateSlug = isoDate.replace(/-/g, '_');
  const xlsName = `${dateSlug}.xls`;

  // ── 1. 主路徑：直拼 URL 下載 ─────────────────────────────
  const directUrl = `${DIRECT_URL_BASE}/${xlsName}`;
  let buffer = await _DownloadXls(directUrl).catch(() => null);

  // ── 2. Fallback：cheerio 抓網頁找連結 ────────────────────
  if (!buffer) {
    const fallbackUrl = await _FindXlsUrlInListing(isoDate).catch(() => null);
    if (fallbackUrl && fallbackUrl !== directUrl) {
      buffer = await _DownloadXls(fallbackUrl).catch(() => null);
    }
  }

  if (!buffer) {
    throw new Error(`XLS 不存在或下載失敗：${isoDate}`);
  }

  // ── 3. xlsx 解析 ─────────────────────────────────────────
  const hours = _ParseXlsBuffer(buffer);

  return {
    date: isoDate,
    sourceFile: xlsName,
    hours,
    fetchedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  };
}

// ── 下載：raw fetch + browser headers ──────────────────────
async function _DownloadXls(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    method: 'GET',
    headers: BROWSER_HEADERS,
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html') || contentType.includes('text/plain')) {
    throw new Error(`非預期 content-type ${contentType} on ${url}`);
  }

  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength < 2000) {
    throw new Error(`檔案過小（${arrayBuf.byteLength} bytes）on ${url}`);
  }
  return Buffer.from(arrayBuf);
}

// ── cheerio：解析列表頁找該日 XLS 連結 ─────────────────────
async function _FindXlsUrlInListing(isoDate: string): Promise<string | null> {
  const dateSlug = isoDate.replace(/-/g, '_');
  const res = await fetch(LISTING_URL, {
    headers: { ...BROWSER_HEADERS, 'Accept': 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);

  let found: string | null = null;
  $('a[href*=".xls"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (href.includes(dateSlug) || href.includes(isoDate)) {
      found = href.startsWith('http') ? href : new URL(href, LISTING_URL).toString();
      return false;
    }
  });
  return found;
}

// ── xlsx：解析「總計 / T1 / T2」三區塊 ─────────────────────
function _ParseXlsBuffer(buffer: Buffer): HourRecord[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error('XLS 無工作表');

  // 讀為 array-of-arrays（不當 header），避免 __EMPTY key 對映複雜
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  if (!rows.length) throw new Error('XLS 無資料列');

  // 資料列識別：col 0 為「HH:MM ~ HH:MM」格式（如 "00:00 ~ 00:59"）
  const TIME_PATTERN = /^(\d{1,2}):\d{2}\s*[~～-]\s*\d{1,2}:\d{2}$/;

  const out: HourRecord[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const timeCell = row[COL.TOTAL_HOUR];
    if (typeof timeCell !== 'string') continue;
    const match = TIME_PATTERN.exec(timeCell.trim());
    if (!match) continue;
    const hour = Number.parseInt(match[1], 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;

    const totalDep   = _ToNumber(row[COL.TOTAL_DEPARTURE]);
    const totalArr   = _ToNumber(row[COL.TOTAL_ARRIVAL]);
    const totalTrDep = _ToNumber(row[COL.TOTAL_TRANSIT_DEPARTURE]);
    const totalTrArr = _ToNumber(row[COL.TOTAL_TRANSIT_ARRIVAL]);
    const totalOvDep = _ToNumber(row[COL.TOTAL_OVERNIGHT_DEPARTURE]);
    const t1Dep   = _ToNumber(row[COL.T1_DEPARTURE]);
    const t1Arr   = _ToNumber(row[COL.T1_ARRIVAL]);
    const t1TrDep = _ToNumber(row[COL.T1_TRANSIT_DEPARTURE]);
    const t1TrArr = _ToNumber(row[COL.T1_TRANSIT_ARRIVAL]);
    const t1OvDep = _ToNumber(row[COL.T1_OVERNIGHT_DEPARTURE]);
    const t2Dep   = _ToNumber(row[COL.T2_DEPARTURE]);
    const t2Arr   = _ToNumber(row[COL.T2_ARRIVAL]);
    const t2TrDep = _ToNumber(row[COL.T2_TRANSIT_DEPARTURE]);
    const t2TrArr = _ToNumber(row[COL.T2_TRANSIT_ARRIVAL]);
    const t2OvDep = _ToNumber(row[COL.T2_OVERNIGHT_DEPARTURE]);

    const totalSum = totalDep + totalArr + totalTrDep + totalTrArr + totalOvDep;
    const t1Sum = t1Dep + t1Arr + t1TrDep + t1TrArr + t1OvDep;
    const t2Sum = t2Dep + t2Arr + t2TrDep + t2TrArr + t2OvDep;

    // 21 筆 / 小時：3 terminal × 7 direction
    out.push(
      // 總計
      { hour, forecastCount: totalArr,            terminal: 'all', direction: 'arrival'             },
      { hour, forecastCount: totalDep,            terminal: 'all', direction: 'departure'           },
      { hour, forecastCount: totalArr + totalDep, terminal: 'all', direction: 'all'                 },
      { hour, forecastCount: totalTrArr,          terminal: 'all', direction: 'transit-arrival'     },
      { hour, forecastCount: totalTrDep,          terminal: 'all', direction: 'transit-departure'   },
      { hour, forecastCount: totalOvDep,          terminal: 'all', direction: 'overnight-departure' },
      { hour, forecastCount: totalSum,            terminal: 'all', direction: 'total'               },
      // T1
      { hour, forecastCount: t1Arr,               terminal: 'T1',  direction: 'arrival'             },
      { hour, forecastCount: t1Dep,               terminal: 'T1',  direction: 'departure'           },
      { hour, forecastCount: t1Arr + t1Dep,       terminal: 'T1',  direction: 'all'                 },
      { hour, forecastCount: t1TrArr,             terminal: 'T1',  direction: 'transit-arrival'     },
      { hour, forecastCount: t1TrDep,             terminal: 'T1',  direction: 'transit-departure'   },
      { hour, forecastCount: t1OvDep,             terminal: 'T1',  direction: 'overnight-departure' },
      { hour, forecastCount: t1Sum,               terminal: 'T1',  direction: 'total'               },
      // T2
      { hour, forecastCount: t2Arr,               terminal: 'T2',  direction: 'arrival'             },
      { hour, forecastCount: t2Dep,               terminal: 'T2',  direction: 'departure'           },
      { hour, forecastCount: t2Arr + t2Dep,       terminal: 'T2',  direction: 'all'                 },
      { hour, forecastCount: t2TrArr,             terminal: 'T2',  direction: 'transit-arrival'     },
      { hour, forecastCount: t2TrDep,             terminal: 'T2',  direction: 'transit-departure'   },
      { hour, forecastCount: t2OvDep,             terminal: 'T2',  direction: 'overnight-departure' },
      { hour, forecastCount: t2Sum,               terminal: 'T2',  direction: 'total'               },
    );
  }

  if (out.length === 0) {
    throw new Error('XLS 解析失敗：找不到任何時段資料列（XLS 結構可能已變更）');
  }
  return out;
}

function _ToNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
