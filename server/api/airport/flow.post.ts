/**
 * POST /api/airport/flow
 * n8n 將抓取的桃園機場人流預測資料寫入 Firestore airport_flow collection
 *
 * Firestore 資料結構 — collection: airport_flow
 * ┌─────────────────┬────────────────────────────────────────────┐
 * │ 欄位            │ 說明                                       │
 * ├─────────────────┼────────────────────────────────────────────┤
 * │ date            │ 'YYYY-MM-DD'                               │
 * │ hour            │ 0–23                                       │
 * │ terminal        │ 'T1' | 'T2' | 'all'                       │
 * │ direction       │ 'arrival' | 'departure' | 'all'            │
 * │ forecastCount   │ 預計人流（人次）                             │
 * │ actualCount     │ 實際人流（選填，可後續 PATCH 更新）           │
 * │ source          │ 資料來源說明（如 'n8n-taoyuan-scraper'）     │
 * │ createdAt       │ serverTimestamp                            │
 * └─────────────────┴────────────────────────────────────────────┘
 *
 * n8n 呼叫方式：
 *   URL:  POST https://da-line-liff-app.vercel.app/api/airport/flow
 *   Header: Authorization: Bearer <NUXT_INTERNAL_API_KEY>
 *   Body (JSON): 單筆或陣列皆可
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface FlowRecord {
  date: string;
  hour: number;
  terminal?: string;
  direction?: string;
  forecastCount: number;
  actualCount?: number;
  source?: string;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  // ── 1. 驗證內部 API Key ───────────────────────────────────
  const authHeader = getHeader(event, 'authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (config.internalApiKey && token !== config.internalApiKey) {
    setResponseStatus(event, 401);
    return { ok: false, message: 'Unauthorized' };
  }

  // ── 2. 解析 body（單筆或陣列）────────────────────────────
  const raw = await readBody<FlowRecord | FlowRecord[]>(event);
  const records: FlowRecord[] = Array.isArray(raw) ? raw : [raw];

  if (!records.length) {
    setResponseStatus(event, 400);
    return { ok: false, message: 'Empty payload' };
  }

  for (const r of records) {
    if (!r.date || typeof r.hour !== 'number' || typeof r.forecastCount !== 'number') {
      setResponseStatus(event, 400);
      return { ok: false, message: 'Missing required fields: date, hour, forecastCount' };
    }
  }

  if (!config.firebaseServiceAccountJson) {
    return { ok: true, inserted: 0, message: 'Firebase not configured (dry-run)' };
  }

  // ── 3. 批次寫入 Firestore ─────────────────────────────────
  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const batch = db.batch();

    for (const r of records) {
      // 以 date + hour + terminal + direction 作為 document ID（冪等，n8n 重送不會重複）
      const docId = `${r.date}_${String(r.hour).padStart(2, '0')}_${r.terminal ?? 'all'}_${r.direction ?? 'all'}`;
      const ref = db.collection('airport_flow').doc(docId);
      batch.set(ref, {
        date: r.date,
        hour: r.hour,
        terminal: r.terminal ?? 'all',
        direction: r.direction ?? 'all',
        forecastCount: r.forecastCount,
        actualCount: r.actualCount ?? null,
        source: r.source ?? 'n8n',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();
    return { ok: true, inserted: records.length };
  } catch (err) {
    console.error('[airport/flow.post] Firestore batch write failed:', err);
    setResponseStatus(event, 500);
    return { ok: false, message: 'Firestore write failed' };
  }
});
