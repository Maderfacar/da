/**
 * 桃園機場 XLS 預報抓取器
 *
 * 流程：
 *   1) 直拼 URL 嘗試下載 https://www.taoyuan-airport.com/uploads/fos/{YYYY_MM_DD}.xls
 *   2) 若 404，cheerio 抓 https://www.taoyuanairport.com.tw/flightforecast 列表頁，找該日對應 a 標籤
 *   3) xlsx 解析得 24 小時 hours[] 結構
 *
 * 機場下載 URL 有反爬蟲檢測，必須帶 User-Agent + Referer headers（n8n workflow 已驗證）。
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

export interface HourRecord {
  hour: number;
  forecastCount: number;
  terminal: 'all';
  direction: 'arrival' | 'departure' | 'all';
}

export interface ForecastResult {
  date: string;
  sourceFile: string;
  hours: HourRecord[];
  fetchedAt: number;
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
  // HTML 通常代表 404 重導頁，視為失敗
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

  // 找包含 dateSlug 的 .xls 連結
  let found: string | null = null;
  $('a[href*=".xls"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (href.includes(dateSlug) || href.includes(isoDate)) {
      found = href.startsWith('http') ? href : new URL(href, LISTING_URL).toString();
      return false; // break each
    }
  });
  return found;
}

// ── xlsx：解析 24 小時 hours[] ─────────────────────────────
function _ParseXlsBuffer(buffer: Buffer): HourRecord[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('XLS 無工作表');

  // sheet_to_json：第一列當 header；缺 header 的欄位 key 為 __EMPTY / __EMPTY_1 ...
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (!rows.length) throw new Error('XLS 無資料列');

  // 動態找出 hour 欄位（值在 0-23 範圍且至少佔 20 列以上）
  const hourKey = _FindHourKey(rows);
  if (!hourKey) throw new Error('XLS 找不到時段欄位（格式可能已變更）');

  // 找到入境/出境兩個數字欄位（n8n 慣例：__EMPTY、__EMPTY_1）
  // 通用解法：找出除了 hourKey 之外、值多為數字的兩個欄位，依出現順序視為 arrival/departure
  const numericKeys = _FindNumericKeys(rows, hourKey);
  if (numericKeys.length < 2) {
    throw new Error(`XLS 找不到入境/出境欄位（找到 ${numericKeys.length} 個數字欄位）`);
  }
  const [keyArr, keyDep] = numericKeys;

  const parsedByHour = new Map<number, { arr: number; dep: number }>();
  for (const row of rows) {
    const hour = Number.parseInt(String(row[hourKey] ?? ''), 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;
    const arr = Number(row[keyArr]) || 0;
    const dep = Number(row[keyDep]) || 0;
    parsedByHour.set(hour, { arr, dep });
  }

  // 24 小時 × 3 方向 = 72 筆
  const out: HourRecord[] = [];
  for (let h = 0; h < 24; h++) {
    const found = parsedByHour.get(h) ?? { arr: 0, dep: 0 };
    out.push({ hour: h, forecastCount: found.arr,             terminal: 'all', direction: 'arrival' });
    out.push({ hour: h, forecastCount: found.dep,             terminal: 'all', direction: 'departure' });
    out.push({ hour: h, forecastCount: found.arr + found.dep, terminal: 'all', direction: 'all' });
  }
  return out;
}

function _FindHourKey(rows: Array<Record<string, unknown>>): string | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  for (const key of keys) {
    const hits = rows.filter((r) => {
      const v = Number.parseInt(String(r[key] ?? ''), 10);
      return !Number.isNaN(v) && v >= 0 && v <= 23;
    }).length;
    if (hits >= 20) return key;
  }
  return null;
}

function _FindNumericKeys(rows: Array<Record<string, unknown>>, exclude: string): string[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]).filter((k) => k !== exclude);
  const scored = keys.map((key) => {
    const numericHits = rows.filter((r) => {
      const v = Number(r[key]);
      return Number.isFinite(v) && v >= 0;
    }).length;
    return { key, score: numericHits };
  });
  // 取 numericHits >= 20 的欄位（依順序）
  return scored.filter((s) => s.score >= 20).map((s) => s.key);
}
