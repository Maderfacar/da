/**
 * Driver application read helper（P27 Stage A）
 *
 * P27 把 driverApplication 從 users/{uid} 搬到 drivers/{uid}.application。
 * Stage A 期間需要 dual-read：先試新位置（drivers），找不到 fallback 舊位置（users）。
 * Migration script 跑完 + Stage D deploy 後可移除此 fallback。
 *
 * 使用：
 *   const app = await readDriverApplication(db, lineUid);
 *   if (!app) return; // 沒申請過
 *
 * 注意：
 *   - Timestamp 物件保持 raw（呼叫端負責序列化），對齊既有 admin/users/index.get.ts 行為
 *   - 文件不存在或 application/driverApplication 欄位為 undefined → 回 null
 */
import type { Firestore } from 'firebase-admin/firestore';

export type DriverApplicationRaw = Record<string, unknown>;

export async function readDriverApplication(
  db: Firestore,
  lineUid: string,
): Promise<DriverApplicationRaw | null> {
  // Primary: drivers/{uid}.application（新位置，P27 後）
  const driverSnap = await db.collection('drivers').doc(lineUid).get();
  if (driverSnap.exists) {
    const app = driverSnap.data()?.application as DriverApplicationRaw | undefined;
    if (app && typeof app === 'object') return app;
  }

  // Fallback: users/{uid}.driverApplication（舊位置，Stage A migration window 兼容）
  const userSnap = await db.collection('users').doc(lineUid).get();
  if (userSnap.exists) {
    const app = userSnap.data()?.driverApplication as DriverApplicationRaw | undefined;
    if (app && typeof app === 'object') return app;
  }

  return null;
}

/**
 * Batch read 版本：給 admin/users/index.get.ts 列表頁用
 * 一次取多個 driver 的 application；兩個 collection 各打一次 batch getAll。
 *
 * @returns Map<lineUid, application> — 只含找得到的；找不到的 key 不會出現
 */
export async function batchReadDriverApplications(
  db: Firestore,
  lineUids: string[],
): Promise<Map<string, DriverApplicationRaw>> {
  const result = new Map<string, DriverApplicationRaw>();
  if (lineUids.length === 0) return result;

  // Primary batch: drivers/{uid}.application
  const driverRefs = lineUids.map((uid) => db.collection('drivers').doc(uid));
  const driverSnaps = await db.getAll(...driverRefs);
  const missingFromDrivers: string[] = [];
  driverSnaps.forEach((snap, i) => {
    if (snap.exists) {
      const app = snap.data()?.application as DriverApplicationRaw | undefined;
      if (app && typeof app === 'object') {
        result.set(lineUids[i]!, app);
        return;
      }
    }
    missingFromDrivers.push(lineUids[i]!);
  });

  // Fallback batch: users/{uid}.driverApplication（只對沒在 drivers 找到的 uid）
  if (missingFromDrivers.length > 0) {
    const userRefs = missingFromDrivers.map((uid) => db.collection('users').doc(uid));
    const userSnaps = await db.getAll(...userRefs);
    userSnaps.forEach((snap, i) => {
      if (snap.exists) {
        const app = snap.data()?.driverApplication as DriverApplicationRaw | undefined;
        if (app && typeof app === 'object') {
          result.set(missingFromDrivers[i]!, app);
        }
      }
    });
  }

  return result;
}
