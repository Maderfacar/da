/**
 * Server-side 身分驗證 helper（P14 上線安全修復）
 *
 * 從 Authorization: Bearer 標頭取 Firebase ID token，verifyIdToken 後回傳 caller 身分。
 *
 * 用法：
 *   import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
 *   const auth = await getAuthFromEvent(event);
 *   if (!auth.ok) return authFailResponse(auth);
 *   if (!auth.roles.includes('admin')) return forbiddenError(...);
 *
 * 取值來源（P17 後修正）：
 *   - roles：**永遠從 Firestore 即時讀**（admin 加/撤銷角色立即生效，不等 1 小時 token TTL）；
 *     claims 只在 Firestore 讀失敗時 fallback（容錯舊 token）。
 *     原因：custom token claims 是 sign-in 當下的快照，admin 之後在 Firestore 加 'admin' role
 *     不會自動更新 claims；若 require-auth 信任 claims 會造成「明明 Firestore 已是 admin
 *     但 server 仍認為不是」的錯誤拒絕。
 *   - approved：同上，永遠從 Firestore 即時讀。
 *
 * 成本：每個 protected request +1 Firestore read（已內建在 approved 那次 read，零增量）。
 *
 * 詳見 docs/decision-log.md 2026/05/09 P14 條目（含本次修正）。
 */
import type { H3Event } from 'h3';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

type Role = 'passenger' | 'driver' | 'admin';

export interface AuthOk {
  ok: true;
  /** Firebase Auth UID（'line:Uxxxx' 格式，與 firebaseUser.uid 一致） */
  uid: string;
  /** 去掉 'line:' prefix 的 LINE userId（與 Firestore users/{lineUid} document key 一致） */
  lineUid: string;
  roles: Role[];
  approved: boolean;
}

export interface AuthFail {
  ok: false;
  code: 401 | 403 | 500;
  message: { zh_tw: string; en: string; ja: string };
}

export type AuthResult = AuthOk | AuthFail;

const VALID_ROLES = new Set<Role>(['passenger', 'driver', 'admin']);

const filterRoles = (raw: unknown): Role[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Role => typeof r === 'string' && VALID_ROLES.has(r as Role));
};

export async function getAuthFromEvent(event: H3Event): Promise<AuthResult> {
  const authHeader = getHeader(event, 'authorization') ?? '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) {
    return { ok: false, code: 401, message: { zh_tw: '未授權', en: 'Unauthorized', ja: '未承認' } };
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return { ok: false, code: 500, message: { zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' } };
  }

  try {
    const { auth, db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const decoded = await auth.verifyIdToken(idToken);

    const lineUid = decoded.uid.startsWith('line:') ? decoded.uid.slice(5) : decoded.uid;

    // P17 修正：Firestore 為 source of truth，claims 僅作 fallback
    // （admin 在 Firestore 加 'admin' role 後立即生效，不等 1 小時 token refresh）
    let roles: Role[] = [];
    let approved = false;
    let firestoreOk = false;
    try {
      const snap = await db.collection('users').doc(lineUid).get();
      if (snap.exists) {
        const data = snap.data() ?? {};
        approved = (data.approved as boolean) ?? false;
        roles = filterRoles(data.roles);
        firestoreOk = true;
      }
    } catch (err) {
      // Firestore 讀失敗不阻擋 auth flow，下面 fallback 到 claims
      console.error('[getAuthFromEvent] Firestore read failed:', err);
    }

    // Firestore 讀失敗或文件不存在 → fallback 到 custom token claims（舊 token 容錯）
    if (!firestoreOk || roles.length === 0) {
      const claimRoles = filterRoles((decoded as { roles?: unknown }).roles);
      if (claimRoles.length > 0) {
        roles = claimRoles;
      }
    }

    return { ok: true, uid: decoded.uid, lineUid, roles, approved };
  } catch (err) {
    // verifyIdToken 失敗：token 過期 / 無效 / 簽名錯
    console.error('[getAuthFromEvent] verifyIdToken failed:', err);
    return { ok: false, code: 401, message: { zh_tw: '登入憑證無效', en: 'Invalid auth token', ja: '認証トークンが無効です' } };
  }
}

/** 將 AuthFail 轉換為標準 UnifiedResponse（呼叫方直接 return）。 */
export function authFailResponse(fail: AuthFail) {
  return { data: {}, status: { code: fail.code, message: fail.message } };
}
