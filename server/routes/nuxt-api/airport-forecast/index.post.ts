/**
 * POST /nuxt-api/airport-forecast
 *
 * 供 n8n workflow 寫入桃園機場每日航班運量預報資料。
 * Authorization: Bearer <NUXT_INTERNAL_API_KEY>
 *
 * Body:
 * {
 *   date: string          // YYYY-MM-DD
 *   sourceFile: string    // 原始 XLS 檔名，e.g. "2026_05_01.xls"
 *   hours: Array<{
 *     hour: number        // 0-23
 *     forecastCount: number
 *     terminal?: string
 *   }>
 * }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface PostBody {
  date: string;
  sourceFile?: string;
  hours: Array<{ hour: number; forecastCount: number; terminal?: string }>;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  // ── 驗證 Internal API Key ────────────────────────────────
  const authHeader = getHeader(event, 'authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!config.internalApiKey || token !== config.internalApiKey) {
    return {
      data: null,
      status: { code: 403, message: { zh_tw: '禁止存取', en: 'Forbidden', ja: 'アクセス拒否' } },
    };
  }

  // ── 讀取 Body ────────────────────────────────────────────
  const body = await readBody<PostBody>(event);

  if (!body?.date || !Array.isArray(body?.hours)) {
    return {
      data: null,
      status: { code: 400, message: { zh_tw: '缺少必要欄位', en: 'Missing required fields', ja: '必須フィールドが不足しています' } },
    };
  }

  // 驗證日期格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return {
      data: null,
      status: { code: 400, message: { zh_tw: '日期格式錯誤（應為 YYYY-MM-DD）', en: 'Invalid date format (expected YYYY-MM-DD)', ja: '日付形式が正しくありません（YYYY-MM-DD）' } },
    };
  }

  if (!config.firebaseServiceAccountJson) {
    return {
      data: null,
      status: { code: 500, message: { zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase が設定されていません' } },
    };
  }

  // ── 計算統計值 ────────────────────────────────────────────
  const hours = body.hours.map((h) => ({
    hour: Number(h.hour),
    forecastCount: Number(h.forecastCount),
    terminal: h.terminal ?? '',
  }));

  const total = hours.reduce((s, h) => s + h.forecastCount, 0);
  const peak = hours.reduce((max, h) => (h.forecastCount > max.forecastCount ? h : max), hours[0] ?? { hour: 0, forecastCount: 0 });

  // ── 寫入 Firestore ────────────────────────────────────────
  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);

    await db.collection('airport_flow_forecast').doc(body.date).set({
      date: body.date,
      hours,
      totalForecast: total,
      peakHour: peak.hour,
      peakCount: peak.forecastCount,
      sourceFile: body.sourceFile ?? '',
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.info(`[airport-forecast/post] 已寫入 ${body.date}，${hours.length} 筆時段，總人次 ${total}`);

    return {
      data: { date: body.date, totalForecast: total, peakHour: peak.hour },
      status: { code: 200, message: { zh_tw: '寫入成功', en: 'OK', ja: '書き込み成功' } },
    };
  } catch (err) {
    console.error('[airport-forecast/post] Firestore write failed:', err);
    return {
      data: null,
      status: { code: 500, message: { zh_tw: '資料庫寫入失敗', en: 'Database write failed', ja: 'データベース書き込みに失敗しました' } },
    };
  }
});
