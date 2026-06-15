/**
 * Admin 端 2FA Session token 管理
 *
 * 流程：
 *   1. admin 登入後通過 TOTP 驗證（verify-enrollment 或 verify-login）→ mint2faSession
 *   2. client 把 token 存 localStorage 'da_admin_2fa_session'
 *   3. 後續所有 /nuxt-api/admin/* 請求帶 header X-Admin-2FA-Session: {token}
 *   4. server 端 getAuthFromEvent 對所有有 totpEnrolledAt 的 admin 強制校驗該 token
 *
 * 設計取捨：
 *   - 用 Firestore collection admin_2fa_sessions/{token}；TTL 12h（瀏覽器歷史會話 ≈ 一天工作日）
 *   - token = crypto.randomBytes(32).toString('hex')，64 hex char
 *   - 過期不主動刪 doc（lazy purge；後續視量決定 Cloud Scheduler 清理）
 *   - 不存 IP / UA 綁定（首版簡化；攻擊面有限因為要先通過 TOTP）
 */
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COLLECTION = 'admin_2fa_sessions';

/** 產 token + 寫 Firestore；回傳 token 字串給 client */
export async function mint2faSession(db: Firestore, adminUid: string): Promise<string> {
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
 * 驗證 token：存在 + 未過期 → 回 { adminUid }；否則 null
 * 不刪過期 doc（lazy purge），讓 caller 自己判定
 */
export async function verify2faSession(
  db: Firestore,
  token: string,
): Promise<{ adminUid: string } | null> {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const snap = await db.collection(COLLECTION).doc(token).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data || typeof data.adminUid !== 'string') return null;
  const expiresAt = data.expiresAt;
  if (expiresAt && typeof expiresAt.toMillis === 'function') {
    if (expiresAt.toMillis() < Date.now()) return null;
  }
  return { adminUid: data.adminUid };
}
