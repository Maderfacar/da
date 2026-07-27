/**
 * 同步 Firebase Auth persistent custom claims（W1 — 認證根治 2026-07-28）
 *
 * 背景 / 為何需要：
 *   - firestore.rules 依 `request.auth.token.roles`（custom claims）判斷 admin/driver 讀取權限。
 *   - 過去只用 `createCustomToken(uid, { roles })` 的一次性 developer claims，登入當下凍結，
 *     之後 admin 在 Firestore 加/撤角色，token claims 不會更新 → client 走 rules 的讀取仍被舊
 *     claims 擋（「新增 admin 卻看不到 admin-only 分頁」的根因）。
 *   - 改用 `setCustomUserClaims`（持久）：任何角色變更後呼叫本 helper 更新持久 claims，
 *     client 端下次 `getIdToken(true)` 強制刷新即拿到新 claims —— 免重登、免重啟 LINE。
 *   - 同時 bump `users/{lineUid}.claimsUpdatedAt`，讓 client 可偵測「claims 比手上 token 新」。
 *
 * 使用點：line-exchange（每次登入）、admin/users/[uid].patch（addRole/removeRole）、
 *         以及一次性回填腳本 scripts/backfill-claims.mjs。
 *
 * server-side `require-auth` 仍以 Firestore 即時讀為準（fail-closed），claims 只是讓 rules 一致。
 */
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

export type Role = 'passenger' | 'driver' | 'admin';

/**
 * 容錯解析 roles：陣列直接濾；字串（Firebase Console 誤存）如 "['passenger','admin']" /
 * "passenger,admin" 也嘗試 parse。只保留合法角色名。
 */
export function parseRolesLoose(raw: unknown): Role[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'string') {
    arr = raw.replace(/[[\]'"\s]/g, '').split(',');
  }
  return arr.filter((r): r is Role => r === 'passenger' || r === 'driver' || r === 'admin');
}

export interface SyncClaimsResult {
  /** true = setCustomUserClaims 成功寫入 */
  ok: boolean;
  /** 實際寫入 claims 的 roles（fallback 後） */
  roles: Role[];
  /** 失敗原因（ok=false 時） */
  reason?: string;
}

/**
 * 把 users/{lineUid}.roles 同步為 Firebase Auth persistent custom claims `{ roles }`，
 * 並 bump `users/{lineUid}.claimsUpdatedAt`。
 *
 * @param opts.roles 已知 roles 時傳入可省一次 Firestore 讀（line-exchange 用）；未傳則讀 Firestore。
 * @returns ok=false 代表 Firebase Auth user 尚不存在（未 line-exchange）或讀取失敗 —— 不 throw，
 *          呼叫端可忽略（下次登入 line-exchange 會補設 claims）。
 */
export async function syncUserClaims(
  auth: Auth,
  db: Firestore,
  lineUid: string,
  opts?: { roles?: Role[] },
): Promise<SyncClaimsResult> {
  let roles = opts?.roles;

  if (!roles) {
    try {
      const snap = await db.collection('users').doc(lineUid).get();
      const data = snap.exists ? snap.data() : undefined;
      roles = parseRolesLoose(data?.roles);
      if (roles.length === 0 && typeof data?.role === 'string') {
        roles = parseRolesLoose([data.role]);
      }
    } catch (err) {
      return { ok: false, roles: [], reason: `firestore read failed: ${String(err)}` };
    }
  }

  if (!roles || roles.length === 0) roles = ['passenger'];

  try {
    await auth.setCustomUserClaims(`line:${lineUid}`, { roles });
  } catch (err) {
    // user-not-found（尚未建 Firebase Auth user）等 → 跳過，不阻擋主流程
    return { ok: false, roles, reason: `setCustomUserClaims failed: ${String(err)}` };
  }

  try {
    await db.collection('users').doc(lineUid).set(
      { claimsUpdatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    // 非致命：claims 已寫成功；timestamp bump 只影響 client stale 偵測其中一條路徑
    console.warn('[syncUserClaims] claimsUpdatedAt bump failed:', err);
  }

  return { ok: true, roles };
}
