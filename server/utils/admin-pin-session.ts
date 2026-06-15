/**
 * Admin 敏感操作 PIN session token 管理。
 *
 * 結構參考 [admin-2fa-session.ts](./admin-2fa-session.ts)，差別：
 *   - TTL 5 min（短期 step-up，每次敏感操作後幾分鐘內可再做）
 *   - collection: admin_pin_sessions/{token}
 *   - verify 不只看 expiry 還比對 adminUid（避免 super 借用其他 admin token）
 */
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';

const SESSION_TTL_MS = 5 * 60 * 1000;
const COLLECTION = 'admin_pin_sessions';

/** mint token + 寫 Firestore；回傳 token 字串 */
export async function mintPinSession(db: Firestore, adminUid: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await db.collection(COLLECTION).doc(token).set({
    adminUid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + SESSION_TTL_MS),
  });
  return token;
}

/**
 * 驗證 token：存在 + 未過期 + adminUid 一致 → true；否則 false。
 * 不刪過期 doc（lazy purge）。
 */
export async function verifyPinSession(
  db: Firestore,
  token: string,
  expectedAdminUid: string,
): Promise<boolean> {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  const snap = await db.collection(COLLECTION).doc(token).get();
  if (!snap.exists) return false;
  const data = snap.data();
  if (!data || typeof data.adminUid !== 'string') return false;
  if (data.adminUid !== expectedAdminUid) return false;
  const expiresAt = data.expiresAt;
  if (expiresAt && typeof expiresAt.toMillis === 'function') {
    if (expiresAt.toMillis() < Date.now()) return false;
  }
  return true;
}
