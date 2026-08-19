// 認證根治 Phase 3：LINE Login server OAuth 入口（authorization code flow 起點）。
//
// 取代 client liff.login()（redirect_uri = 端點根 + 動態 ?liff.state= → 永遠無法白名單化
// → redirect_uri does not match 死鏈）。本端點產生一次性 state 後 302 轉 LINE authorize，
// redirect_uri 固定為 /nuxt-api/auth/line/callback（與 LINE console 登記值一致）。
//
// query：
//   - clientType：passenger | driver（決定 callback 導回失敗頁與 target 端別預設）
//   - target：登入成功後導回的站內路徑（淨化擋 open redirect；缺省用端別預設）
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import {
  createLoginState,
  sanitizeTarget,
  normalizeClientType,
  lineLoginRedirectUri,
} from '@@/utils/line-login-state';
import { configStr } from '@@/utils/runtime-config';

const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const q = getQuery(event);
  const clientType = normalizeClientType(q.clientType);
  const loginPage = clientType === 'driver' ? '/driver/auth' : '/login';

  const channelId = configStr(config.lineLoginChannelId); // 見 @@/utils/runtime-config（destr 型別陷阱）
  if (!channelId || !config.firebaseServiceAccountJson) {
    console.error('[line-login.start] server config incomplete (channelId / firebase admin)');
    return sendRedirect(event, `${loginPage}?login_error=config`, 302);
  }

  const target = sanitizeTarget(q.target, clientType);

  let state: string;
  let nonce: string;
  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    ({ state, nonce } = await createLoginState(db, { target, clientType }));
  } catch (err) {
    console.error('[line-login.start] createLoginState failed:', err);
    return sendRedirect(event, `${loginPage}?login_error=state`, 302);
  }

  const redirectUri = lineLoginRedirectUri(config.public.siteUrl as string | undefined);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: 'openid profile',
    nonce,
  });

  console.log(`[line-login.start] clientType=${clientType} target=${target}`);
  return sendRedirect(event, `${LINE_AUTHORIZE_URL}?${params.toString()}`, 302);
});
