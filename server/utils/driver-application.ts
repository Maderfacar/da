/**
 * Driver application read helper
 *
 * 讀 drivers/{uid}.application（P27 migration 後的單一資料源）。
 * 給 driver/apply.post.ts 冷卻檢查用；列表頁直接在 endpoint 內 batch read drivers doc。
 */
import type { Firestore } from 'firebase-admin/firestore';

export type DriverApplicationRaw = Record<string, unknown>;

export async function readDriverApplication(
  db: Firestore,
  lineUid: string,
): Promise<DriverApplicationRaw | null> {
  const driverSnap = await db.collection('drivers').doc(lineUid).get();
  if (!driverSnap.exists) return null;
  const app = driverSnap.data()?.application as DriverApplicationRaw | undefined;
  return app && typeof app === 'object' ? app : null;
}
