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
import { verify2faSession } from '@@/utils/admin-2fa-session';

type Role = 'passenger' | 'driver' | 'admin';
type AdminLevel = 'super' | 'admin' | 'assistant';

/**
 * P18：admin 細粒度權限 overrides。第一版未寫入，hasPermission 全部依 level 對應表判斷；
 * 預留欄位給未來「自訂 admin 權限」需求使用。
 */
export interface AdminPermissions {
  canManageAdmins?: boolean;
  canManageDrivers?: boolean;
  canManageOrders?: boolean;
  canBroadcast?: boolean;
  canViewFinance?: boolean;
  canManageFleet?: boolean;
}

export interface AuthOk {
  ok: true;
  /** Firebase Auth UID（'line:Uxxxx' 格式，與 firebaseUser.uid 一致） */
  uid: string;
  /** 去掉 'line:' prefix 的 LINE userId（與 Firestore users/{lineUid} document key 一致） */
  lineUid: string;
  roles: Role[];
  approved: boolean;
  /** P18：admin 三層分權；非 admin 為 undefined */
  level?: AdminLevel;
  /** P18：admin 細粒度權限 overrides；非 admin 或未設定為 undefined */
  permissions?: AdminPermissions;
}

export interface AuthFail {
  ok: false;
  code: 401 | 403 | 500 | 503;
  message: { zh_tw: string; en: string; ja: string };
}

export type AuthResult = AuthOk | AuthFail;

const VALID_ROLES = new Set<Role>(['passenger', 'driver', 'admin']);
const VALID_ADMIN_LEVELS = new Set<AdminLevel>(['super', 'admin', 'assistant']);

const filterRoles = (raw: unknown): Role[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Role => typeof r === 'string' && VALID_ROLES.has(r as Role));
};

const isAdminLevel = (raw: unknown): raw is AdminLevel =>
  typeof raw === 'string' && VALID_ADMIN_LEVELS.has(raw as AdminLevel);

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
    //
    // 2026-06-15 MEDIUM 2 修：區分「Firestore I/O 失敗」與「user doc 不存在」
    //   - I/O 失敗（network / quota / outage）→ fail-closed 回 503，避免 RBAC 繞過
    //   - doc 不存在（新用戶剛 sign-in 尚未寫入 users doc）→ fallback 到 claims（合法狀態）
    //
    // 為何 fail-closed：原版「失敗就降級 claims」會在 Firestore outage 時讓「剛被撤 admin
    // role」的攻擊者繼續以 admin 通過驗證（claims snapshot 還含 admin）。Admin 端拒絕永遠安全。
    let roles: Role[] = [];
    let approved = false;
    let firestoreReachable = true;
    let userDocExists = false;
    try {
      const snap = await db.collection('users').doc(lineUid).get();
      userDocExists = snap.exists;
      if (snap.exists) {
        const data = snap.data() ?? {};
        approved = (data.approved as boolean) ?? false;
        roles = filterRoles(data.roles);
      }
    } catch (err) {
      console.error('[getAuthFromEvent] Firestore read failed:', err);
      firestoreReachable = false;
    }

    if (!firestoreReachable) {
      return {
        ok: false,
        code: 503,
        message: {
          zh_tw: '伺服器暫時無法驗證身分，請稍後再試',
          en: 'Identity verification temporarily unavailable, please retry',
          ja: '本人確認が一時的にご利用いただけません。しばらくしてから再度お試しください',
        },
      };
    }

    // Firestore 可達但 doc 不存在 / roles 欄位空 → fallback 到 custom token claims（容錯舊 token + 新 sign-in race）
    if (!userDocExists || roles.length === 0) {
      const claimRoles = filterRoles((decoded as { roles?: unknown }).roles);
      if (claimRoles.length > 0) {
        roles = claimRoles;
      }
    }

    // P18：roles 含 admin 時加讀 admins/{lineUid}，取 level + permissions overrides
    // 失敗（doc 不存在或 Firestore 出錯）→ level 為 undefined，後續 hasPermission 一律 false
    let level: AdminLevel | undefined;
    let permissions: AdminPermissions | undefined;
    let totpEnrolledAt: unknown = null;
    if (roles.includes('admin')) {
      try {
        const adminSnap = await db.collection('admins').doc(lineUid).get();
        if (adminSnap.exists) {
          const adminData = adminSnap.data() ?? {};
          if (isAdminLevel(adminData.level)) level = adminData.level;
          const rawPerms = adminData.permissions;
          if (rawPerms && typeof rawPerms === 'object') {
            permissions = rawPerms as AdminPermissions;
          }
          totpEnrolledAt = adminData.totpEnrolledAt ?? null;
        }
      } catch (err) {
        console.error('[getAuthFromEvent] admins doc read failed:', err);
      }
    }

    // Admin 2FA TOTP gate：若 admin 已綁定 TOTP，所有 /nuxt-api/admin/* 必須帶 valid X-Admin-2FA-Session
    // BYPASS：2fa enrollment / login / session-check 自己（avoid chicken-egg）。disable 走正常 gate。
    if (roles.includes('admin') && totpEnrolledAt) {
      const reqPath = (event.path ?? '').split('?')[0];
      const isBypass =
        reqPath.startsWith('/nuxt-api/admin/2fa/setup')
        || reqPath.startsWith('/nuxt-api/admin/2fa/verify-enrollment')
        || reqPath.startsWith('/nuxt-api/admin/2fa/verify-login')
        || reqPath.startsWith('/nuxt-api/admin/2fa/session-check');
      if (!isBypass) {
        const sessionToken = getHeader(event, 'x-admin-2fa-session') ?? '';
        const session = sessionToken ? await verify2faSession(db, sessionToken).catch(() => null) : null;
        if (!session || session.adminUid !== lineUid) {
          return {
            ok: false,
            code: 403,
            message: {
              zh_tw: '需要兩階段驗證',
              en: 'TOTP_REQUIRED',
              ja: '2段階認証が必要です',
            },
          };
        }
      }
    }

    return { ok: true, uid: decoded.uid, lineUid, roles, approved, level, permissions };
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
