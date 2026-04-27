import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as {
    date?: string;
    terminal?: string;
    direction?: string;
  };

  // 預設查詢今天的資料
  const date = query.date ?? new Date().toISOString().slice(0, 10);
  const terminal = query.terminal ?? 'all';
  const direction = query.direction ?? 'all';

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return {
      data: _mockData(date),
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);

    let q = db.collection('airport_flow')
      .where('date', '==', date)
      .where('terminal', '==', terminal)
      .where('direction', '==', direction);

    const snapshot = await q.get();

    // 建立 0–23 的空陣列，填入資料
    const hours: Array<{ hour: number; forecastCount: number; actualCount: number | null }> =
      Array.from({ length: 24 }, (_, i) => ({ hour: i, forecastCount: 0, actualCount: null }));

    for (const doc of snapshot.docs) {
      const d = doc.data();
      const h = d.hour as number;
      if (h >= 0 && h < 24) {
        hours[h] = {
          hour: h,
          forecastCount: (d.forecastCount as number) ?? 0,
          actualCount: d.actualCount as number | null,
        };
      }
    }

    return {
      data: { date, terminal, direction, hours },
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch (err) {
    console.error('[airport/flow.get] Firestore query failed:', err);
    return {
      data: _mockData(date),
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  }
});

// 無資料時回傳模擬尖峰曲線（供 UI 展示）
function _mockData(date: string) {
  const peak = [0, 0, 0, 50, 120, 280, 450, 520, 480, 400, 380, 350,
    320, 290, 310, 380, 460, 520, 490, 420, 300, 200, 100, 30];
  const hours = peak.map((v, i) => ({ hour: i, forecastCount: v, actualCount: null }));
  return { date, terminal: 'all', direction: 'all', hours };
}
