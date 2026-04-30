/**
 * GET /nuxt-api/airport-forecast
 *
 * 取得桃園機場每日航班運量整點人數預報。
 * 資料由 n8n 爬取 Taoyuan Airport 官網 XLS 後寫入 Firestore。
 *
 * Query: date (YYYY-MM-DD，預設今日)
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { date?: string };
  const date = query.date ?? new Date().toISOString().slice(0, 10);

  const config = useRuntimeConfig();

  if (!config.firebaseServiceAccountJson) {
    return {
      data: _mockData(date),
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const doc = await db.collection('airport_flow_forecast').doc(date).get();

    if (!doc.exists) {
      return {
        data: _mockData(date),
        status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
      };
    }

    const d = doc.data()!;
    return {
      data: {
        date: d.date as string,
        hours: d.hours as AirportHour[],
        totalForecast: (d.totalForecast as number) ?? 0,
        peakHour: (d.peakHour as number) ?? 0,
        peakCount: (d.peakCount as number) ?? 0,
        sourceFile: (d.sourceFile as string) ?? '',
        updatedAt: d.updatedAt?.toMillis?.() ?? 0,
      },
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch (err) {
    console.error('[airport-forecast/get] Firestore query failed:', err);
    return {
      data: _mockData(date),
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  }
});

interface AirportHour { hour: number; forecastCount: number; terminal?: string }

function _mockData(date: string) {
  const peak = [0, 0, 200, 420, 810, 1450, 1980, 2240, 2100, 1870, 1650, 1520,
    1430, 1380, 1460, 1680, 2010, 2280, 2150, 1920, 1580, 1120, 680, 310];
  const hours: AirportHour[] = peak.map((v, i) => ({ hour: i, forecastCount: v }));
  const total = peak.reduce((s, v) => s + v, 0);
  const peakHour = peak.indexOf(Math.max(...peak));
  return { date, hours, totalForecast: total, peakHour, peakCount: peak[peakHour], sourceFile: '', updatedAt: 0 };
}
