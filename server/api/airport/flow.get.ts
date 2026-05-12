/**
 * GET /api/airport/flow
 *
 * admin/traffic 取桃園機場每日人流預報。
 *
 * 流程（取代 n8n + Gist）：
 *   1) 讀 Firestore airport_flow/{date} cache
 *   2) cache miss → 呼叫 fetcher 抓桃園機場 XLS → xlsx 解析 → 寫 Firestore → 回傳
 *   3) 寫入時順手清理 7 天前的舊 doc（保留近期 2-3 筆即可）
 *
 * Query: date (YYYY-MM-DD)、terminal ('all' | 'T1' | 'T2')、
 *        direction ('all' | 'arrival' | 'departure' | 'transit-arrival' | 'transit-departure' | 'overnight-departure' | 'total')
 *
 * 回傳：data.isMock 為 true 時，data.mockReason 標明走 fallback 的原因，方便前端 banner 顯示精準提示。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { FetchTaoyuanForecast, SCHEMA_VERSION, type HourRecord, type Direction } from '@@/utils/airport-xls-fetcher';

const VALID_DIRECTIONS: Direction[] = [
  'all', 'arrival', 'departure',
  'transit-arrival', 'transit-departure', 'overnight-departure', 'total',
];

type MockReason = 'firebase-not-configured' | 'xls-not-found' | 'parse-failed' | 'unknown-error';

const COLLECTION = 'airport_flow';
const CLEANUP_KEEP_DAYS = 7;

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { date?: string; terminal?: string; direction?: string };
  const date = query.date ?? new Date().toISOString().slice(0, 10);
  const terminal = query.terminal ?? 'all';
  const direction = query.direction ?? 'all';

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    console.warn('[airport/flow.get] firebaseServiceAccountJson 未設定');
    return _mockResponse(date, 'firebase-not-configured');
  }

  let hours: HourRecord[];
  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection(COLLECTION).doc(date);

    // ── 1. 讀 Firestore cache（schemaVersion < 當前則視為 miss）──
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() as { hours?: HourRecord[]; schemaVersion?: number };
      const cacheVersion = data?.schemaVersion ?? 1;
      if (cacheVersion >= SCHEMA_VERSION && Array.isArray(data?.hours) && data.hours.length > 0) {
        hours = data.hours;
        return _filterAndRespond(date, hours, terminal, direction);
      }
      if (cacheVersion < SCHEMA_VERSION) {
        console.info(`[airport/flow.get] cache schema ${cacheVersion} < ${SCHEMA_VERSION}，重抓 ${date}`);
      }
    }

    // ── 2. cache miss → 抓桃園機場 XLS ──────────────────────
    console.info(`[airport/flow.get] cache miss ${date}，開始抓 XLS...`);
    const result = await FetchTaoyuanForecast(date);
    hours = result.hours;

    // ── 3. 寫 Firestore + 清理舊 doc ────────────────────────
    await ref.set({
      date: result.date,
      sourceFile: result.sourceFile,
      hours: result.hours,
      fetchedAt: result.fetchedAt,
      schemaVersion: result.schemaVersion,
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.info(`[airport/flow.get] 已寫入 Firestore airport_flow/${date}（${hours.length} 筆）`);

    // 清理 7 天前的 doc（不阻塞回應）
    void _CleanupOldDocs(db).catch((err) => {
      console.warn('[airport/flow.get] cleanup 失敗（不影響本次請求）:', err);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('XLS 不存在')) {
      console.warn(`[airport/flow.get] ${date} XLS 不存在（機場可能尚未上傳）`);
      return _mockResponse(date, 'xls-not-found');
    }
    if (msg.includes('解析') || msg.includes('XLS') || msg.includes('Sheet')) {
      console.error(`[airport/flow.get] XLS 解析失敗 ${date}:`, msg);
      return _mockResponse(date, 'parse-failed');
    }
    console.error(`[airport/flow.get] 未知錯誤 ${date}:`, err);
    return _mockResponse(date, 'unknown-error');
  }

  return _filterAndRespond(date, hours, terminal, direction);
});

// ── 篩選 + 回應 ──────────────────────────────────────────
function _filterAndRespond(date: string, hours: HourRecord[], terminal: string, direction: string) {
  // 航廈篩選（目前資料只有 'all'，指定 T1/T2 fallback all）
  let terminalFiltered = terminal === 'all'
    ? hours
    : hours.filter((h) => h.terminal === terminal);

  if (terminalFiltered.length === 0) {
    terminalFiltered = hours.filter((h) => h.terminal === 'all');
  }

  // 方向篩選（P28：7 個 direction；未知值 fallback 'all'）
  const safeDirection: Direction = (VALID_DIRECTIONS as string[]).includes(direction)
    ? direction as Direction
    : 'all';
  const directionFiltered: HourRecord[] = terminalFiltered.filter((h) => h.direction === safeDirection);

  // 依小時彙總（24 筆，缺值補 0）
  const out = Array.from({ length: 24 }, (_, i) => {
    const matched = directionFiltered.filter((h) => h.hour === i);
    const forecastCount = matched.reduce((sum, h) => sum + (h.forecastCount ?? 0), 0);
    return { hour: i, forecastCount, actualCount: null };
  });

  return {
    data: { date, hours: out, isMock: false },
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  };
}

// ── Firestore 清理：刪除 7 天前的 airport_flow doc ─────────
async function _CleanupOldDocs(db: FirebaseFirestore.Firestore): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CLEANUP_KEEP_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const snap = await db.collection(COLLECTION).where('date', '<', cutoffStr).limit(20).get();
  if (snap.empty) return;

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.info(`[airport/flow.get] 清理 ${snap.size} 筆 ${cutoffStr} 之前的舊 doc`);
}

// ── Mock fallback ─────────────────────────────────────────
function _mockResponse(date: string, reason: MockReason) {
  return {
    data: { ..._mockData(date), mockReason: reason },
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  };
}

function _mockData(date: string) {
  const peak = [0, 0, 0, 50, 120, 280, 450, 520, 480, 400, 380, 350,
    320, 290, 310, 380, 460, 520, 490, 420, 300, 200, 100, 30];
  const hours = peak.map((v, i) => ({ hour: i, forecastCount: v, actualCount: null }));
  return { date, hours, isMock: true };
}
