// 認證根治 Phase 3：LINE Login server OAuth callback（authorization code flow 終點）。
//
// 全程 server 完成，client 零參與：
//   1. 驗 state（Firestore 一次性消費，防 CSRF / replay）→ 取出 target + clientType + nonce
//   2. code 換 LINE token（server 帶 client_secret，redirect_uri 固定值）
//   3. 驗 id_token（LINE verify endpoint：驗簽名 + aud + iss + exp + nonce）→ 取 sub/name/picture
//   4. 沿用 provisionLineUser（與 line-exchange 單一真相）建置 user → 簽 Firebase custom token
//   5. custom token 換 idToken（Firebase REST signInWithCustomToken）
//   6. createSessionCookie 種 da_session → 302 導回 target（開機 EnsureSessionChecked 命中 cookie）
//
// 失敗一律 302 導回登入頁帶 ?login_error=<code>（不回 JSON envelope；GET 導頁流程）。
// 本端點為 GET，不受 csrf-origin middleware 管；CSRF 防護完全靠 state 驗證。
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { createSessionCookie } from '@@/utils/session-cookie';
import { provisionLineUser } from '@@/utils/line-user-provision';
import {
  consumeLoginState,
  sanitizeTarget,
  lineLoginRedirectUri,
  type LoginClientType,
} from '@@/utils/line-login-state';

const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const FIREBASE_SIGNIN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';
const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' } as const;

const loginPageFor = (clientType: LoginClientType): string =>
  clientType === 'driver' ? '/driver/auth' : '/login';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const q = getQuery(event);

  // 使用者在 LINE 授權頁取消 / provider 回錯
  if (q.error) {
    console.warn('[line-login.callback] fail: provider error', q.error, q.error_description);
    return sendRedirect(event, '/login?login_error=denied', 302);
  }

  const code = typeof q.code === 'string' ? q.code : '';
  const state = typeof q.state === 'string' ? q.state : '';
  if (!code || !state) {
    console.warn('[line-login.callback] fail: missing code/state');
    return sendRedirect(event, '/login?login_error=badreq', 302);
  }

  const channelId = config.lineLoginChannelId as string;
  const channelSecret = config.lineLoginChannelSecret as string;
  const apiKey = config.public.firebaseApiKey as string;
  if (!channelId || !channelSecret || !apiKey || !config.firebaseServiceAccountJson) {
    console.error('[line-login.callback] fail: server config incomplete');
    return sendRedirect(event, '/login?login_error=config', 302);
  }

  let auth: ReturnType<typeof useFirebaseAdmin>['auth'];
  let db: ReturnType<typeof useFirebaseAdmin>['db'];
  try {
    ({ auth, db } = useFirebaseAdmin(config.firebaseServiceAccountJson));
  } catch (err) {
    console.error('[line-login.callback] fail: firebase admin init', err);
    return sendRedirect(event, '/login?login_error=server', 302);
  }

  // ── 1. 驗 state（一次性消費，防 CSRF / replay）─────────────────────────
  const statePayload = await consumeLoginState(db, state);
  if (!statePayload) {
    console.warn('[line-login.callback] fail: invalid/expired/replayed state');
    return sendRedirect(event, '/login?login_error=state', 302);
  }
  const { clientType, nonce } = statePayload;
  const loginPage = loginPageFor(clientType);
  const target = sanitizeTarget(statePayload.target, clientType); // 二次淨化（防禦性）
  const redirectUri = lineLoginRedirectUri(config.public.siteUrl as string | undefined);

  // ── 2. code 換 LINE token ─────────────────────────────────────────────
  const tokenRes = await $fetch<{ access_token?: string; id_token?: string }>(LINE_TOKEN_URL, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }).toString(),
  }).catch((err) => {
    console.error('[line-login.callback] fail: token exchange', err?.data ?? err);
    return null;
  });
  if (!tokenRes?.id_token) {
    return sendRedirect(event, `${loginPage}?login_error=token`, 302);
  }

  // ── 3. 驗 id_token（LINE verify：簽名 + aud + iss + exp + nonce）──────────
  const verified = await $fetch<{ sub?: string; name?: string; picture?: string; iss?: string; aud?: string }>(
    LINE_VERIFY_URL,
    {
      method: 'POST',
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        id_token: tokenRes.id_token,
        client_id: channelId,
        nonce,
      }).toString(),
    },
  ).catch((err) => {
    console.error('[line-login.callback] fail: id_token verify', err?.data ?? err);
    return null;
  });
  if (!verified?.sub || verified.iss !== 'https://access.line.me' || verified.aud !== channelId) {
    console.warn('[line-login.callback] fail: id_token payload invalid');
    return sendRedirect(event, `${loginPage}?login_error=verify`, 302);
  }

  // ── 4. 沿用 line-exchange user 建置 → custom token ────────────────────
  const provisioned = await provisionLineUser(auth, db, {
    sub: verified.sub,
    name: verified.name ?? '',
    picture: verified.picture ?? '',
  });
  if (!provisioned.ok) {
    console.error('[line-login.callback] fail: provision', provisioned.reason);
    return sendRedirect(event, `${loginPage}?login_error=provision`, 302);
  }

  // ── 5. custom token 換 idToken（Firebase REST）────────────────────────
  const signInRes = await $fetch<{ idToken?: string }>(`${FIREBASE_SIGNIN_URL}?key=${apiKey}`, {
    method: 'POST',
    body: { token: provisioned.customToken, returnSecureToken: true },
  }).catch((err) => {
    console.error('[line-login.callback] fail: signInWithCustomToken', err?.data ?? err);
    return null;
  });
  if (!signInRes?.idToken) {
    return sendRedirect(event, `${loginPage}?login_error=session`, 302);
  }

  // ── 6. 種 da_session cookie → 導回 target ─────────────────────────────
  const seeded = await createSessionCookie(event, signInRes.idToken);
  if (!seeded) {
    console.error('[line-login.callback] fail: createSessionCookie');
    return sendRedirect(event, `${loginPage}?login_error=session`, 302);
  }

  console.log(`[line-login.callback] ok clientType=${clientType} lineUid=${provisioned.lineUserId} → ${target}`);
  return sendRedirect(event, target, 302);
});
