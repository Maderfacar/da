/**
 * Server-side Firebase Session Cookie 封裝（認證根治 Phase 0）
 *
 * 目的：把「登入的真相」從前端 Firebase session（localStorage/IndexedDB，LINE in-app
 * webview 不可靠）移到 server 簽發的 httpOnly cookie。瀏覽器每個 request 自動夾帶，
 * JS 讀不到、不靠前端儲存復原 → 消滅「儲存被清＝看似登出」與前端 12s hydration race。
 *
 * 機制：Firebase Admin `createSessionCookie` / `verifySessionCookie`（沿用既有 Admin SDK，
 * 零新依賴）。roles/approved 仍由 require-auth 的 resolveIdentity 走 Firestore 即時 SSOT。
 */
import type { H3Event } from 'h3';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export const SESSION_COOKIE_NAME = 'da_session';
/** Firebase session cookie 上限 14 天 */
export const SESSION_MAX_AGE_SEC = 14 * 24 * 60 * 60;

/** dev（http://localhost）不能設 Secure cookie，否則瀏覽器丟棄 → 本機測不到 */
const isProd = (): boolean => process.env.NODE_ENV === 'production';

const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SEC,
  // 刻意不設 domain → host-only cookie，不外洩到其他子網域
});

/**
 * 用一個「剛驗過的」Firebase ID token 換 session cookie 並種下。
 * 回 true 成功 / false 失敗（caller 決定是否回錯誤；不 throw）。
 */
export async function createSessionCookie(event: H3Event, idToken: string): Promise<boolean> {
  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) return false;
  try {
    const { auth } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SEC * 1000, // Firebase 要求毫秒
    });
    setCookie(event, SESSION_COOKIE_NAME, sessionCookie, sessionCookieOptions());
    return true;
  } catch (err) {
    console.error('[session-cookie] createSession failed:', err);
    return false;
  }
}

/**
 * 驗證 session cookie，回 decoded（含 uid / claims）或 null。
 * checkRevoked=true → 已 revokeRefreshTokens 的 session 會被擋（即時失效）。
 */
export async function verifySessionCookie(event: H3Event): Promise<DecodedIdToken | null> {
  const raw = getCookie(event, SESSION_COOKIE_NAME);
  if (!raw) return null;
  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) return null;
  try {
    const { auth } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    return await auth.verifySessionCookie(raw, true);
  } catch {
    // 過期 / 無效 / 已撤銷
    return null;
  }
}

/** 清除 session cookie（登出）。 */
export function clearSessionCookie(event: H3Event): void {
  setCookie(event, SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 });
}
