/**
 * GET /nuxt-api/airport-forecast
 *
 * 取得桃園機場每日航班運量整點人數預報。
 * 資料由 n8n 爬取官網 XLS 後寫入 GitHub Gist，此端點直接讀取 Gist raw JSON。
 *
 * Query: date (YYYY-MM-DD，目前忽略，Gist 固定存最新一日)
 */

interface AirportHour { hour: number; forecastCount: number; terminal?: string }

interface GistData {
  date: string;
  sourceFile: string;
  hours: AirportHour[];
  updatedAt: string;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { date?: string };
  const date = query.date ?? new Date().toISOString().slice(0, 10);
  const config = useRuntimeConfig();

  const gistUrl = config.airportForecastGistUrl;

  if (gistUrl) {
    try {
      const raw = await $fetch<GistData>(gistUrl, {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      });

      if (raw?.hours?.length) {
        const total = raw.hours.reduce((s, h) => s + h.forecastCount, 0);
        const peak = raw.hours.reduce(
          (max, h) => (h.forecastCount > max.forecastCount ? h : max),
          raw.hours[0],
        );
        return {
          data: {
            date: raw.date || date,
            hours: raw.hours,
            totalForecast: total,
            peakHour: peak.hour,
            peakCount: peak.forecastCount,
            sourceFile: raw.sourceFile || '',
            updatedAt: raw.updatedAt ? new Date(raw.updatedAt).getTime() : 0,
          },
          status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
        };
      }
    } catch (err) {
      console.error('[airport-forecast/get] Gist fetch failed:', err);
    }
  }

  // Fallback: 模擬資料（Gist 尚未設定或讀取失敗時）
  return {
    data: _mockData(date),
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  };
});

function _mockData(date: string) {
  const peak = [0, 0, 200, 420, 810, 1450, 1980, 2240, 2100, 1870, 1650, 1520,
    1430, 1380, 1460, 1680, 2010, 2280, 2150, 1920, 1580, 1120, 680, 310];
  const hours: AirportHour[] = peak.map((v, i) => ({ hour: i, forecastCount: v }));
  const total = peak.reduce((s, v) => s + v, 0);
  const peakHour = peak.indexOf(Math.max(...peak));
  return { date, hours, totalForecast: total, peakHour, peakCount: peak[peakHour], sourceFile: '', updatedAt: 0 };
}
