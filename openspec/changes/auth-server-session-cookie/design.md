# Design — Auth Server Session Cookie

## 架構總覽

現況（脆）：
```
LINE/LIFF token ──(line-exchange)──▶ Firebase customToken ──▶ signInWithCustomToken
                                                                     │
                          Firebase session 存瀏覽器(localStorage) ◀──┘
                                     │  每次開頁靠 JS 復原 → 取 idToken
        client middleware(12s race) ─┤
                                     ▼
        每個 API：Authorization: Bearer <idToken>  ──▶ require-auth.verifyIdToken
```

終態（穩）：
```
LINE 認一次 ──▶ server createSessionCookie ──▶ Set-Cookie: da_session (HttpOnly)
                                                     │  瀏覽器每 request 自動帶
   client 開機問 session-check(server 真相) ─────────┤
                                                     ▼
   每個 API：cookie 自動帶  ──▶ getSessionFromEvent.verifySessionCookie ──▶ resolveIdentity(Firestore roles)
```

**核心轉變：認證的權威從「client 記得住 token」變成「server 讀得到 cookie」。**

## 資料流與元件

### 1. Session cookie 封裝 `server/utils/session-cookie.ts`（新）

```ts
import type { H3Event } from 'h3';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export const SESSION_COOKIE_NAME = 'da_session';
export const SESSION_MAX_AGE_SEC = 14 * 24 * 60 * 60; // Firebase 上限 14 天

const cookieOpts = () => ({
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SEC,
  // 不設 domain → host-only，不外洩到子網域
});

/** 用一個「剛驗過的」Firebase ID token 換 session cookie 並種下 */
export async function createSession(event: H3Event, idToken: string): Promise<void> {
  const config = useRuntimeConfig();
  const { auth } = useFirebaseAdmin(config.firebaseServiceAccountJson);
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_SEC * 1000 });
  setCookie(event, SESSION_COOKIE_NAME, cookie, cookieOpts());
}

/** 驗 session cookie；回 decoded 或 null（checkRevoked 擋已撤銷） */
export async function verifySession(event: H3Event): Promise<import('firebase-admin/auth').DecodedIdToken | null> {
  const raw = getCookie(event, SESSION_COOKIE_NAME);
  if (!raw) return null;
  const config = useRuntimeConfig();
  const { auth } = useFirebaseAdmin(config.firebaseServiceAccountJson);
  try {
    return await auth.verifySessionCookie(raw, true); // checkRevoked=true
  } catch {
    return null;
  }
}

export function clearSession(event: H3Event): void {
  setCookie(event, SESSION_COOKIE_NAME, '', { ...cookieOpts(), maxAge: 0 });
}
```

**為什麼是 Firebase Session Cookie 而非自建 JWT**：沿用既有 Admin SDK（零新依賴，符合 [feedback-build-before-push] 避免 cold start 風險）；內建撤銷檢查；roles 仍走 Firestore 不受 cookie 快照影響。

### 2. `resolveIdentity` 抽取 + cookie-first（`server/utils/require-auth.ts` 改）

現況 `getAuthFromEvent` 把「verifyIdToken → Firestore roles → admins level/permissions → 2FA gate」綁在一起。抽出**共用核心**，讓 cookie 與 Bearer 兩條入口共用同一套身分解析與 2FA gate，杜絕雙路徑語意分岔：

```ts
// 共用：拿到 decoded（不論來自 idToken 或 session cookie）→ 解析完整身分
async function resolveIdentity(event: H3Event, decoded: DecodedIdToken): Promise<AuthResult> {
  // …現有 lineUid / Firestore roles(SSOT) / 503 fail-closed / claims fallback
  //   / admins level+permissions / admin 2FA gate（X-Admin-2FA-Session）邏輯原封搬進來…
}

export async function getSessionFromEvent(event: H3Event): Promise<AuthResult> {
  const decoded = await verifySession(event);         // cookie
  if (!decoded) return { ok: false, code: 401, message: /* 未授權 */ };
  return resolveIdentity(event, decoded);
}

export async function getAuthFromEvent(event: H3Event): Promise<AuthResult> {
  // 過渡期：先 cookie，後 Bearer fallback
  if (getCookie(event, SESSION_COOKIE_NAME)) return getSessionFromEvent(event);
  const idToken = /* Authorization: Bearer 既有邏輯 */;
  if (!idToken) return { ok: false, code: 401, ... };
  const decoded = await auth.verifyIdToken(idToken);
  return resolveIdentity(event, decoded);
}
```

- **零行為變更保證**：所有現有端點 `getAuthFromEvent` 呼叫點不動；沒有 cookie 時走原本 Bearer 路徑，語意 100% 等價。
- 2FA gate 因為在 `resolveIdentity` 內，cookie 路徑一樣受 `/nuxt-api/admin/*` 2FA 保護。

### 3. 端點

| Method | Path | 權限 | 用途 |
|--------|------|------|------|
| POST | `/nuxt-api/auth/session-login` | 需 body `{ idToken }` | verify idToken → `createSession` → 200 + 精簡 profile |
| POST | `/nuxt-api/auth/session-logout` | cookie | `clearSession` + 可選 `revokeRefreshTokens(uid)` |
| GET | `/nuxt-api/auth/session-check` | cookie（可無） | 回 `{ signedIn, roles, approved, lineUid, level? }`；供開機權威判斷 |

- `session-login` 的 CSRF 防護內建於**「攻擊者拿不到受害者的新鮮 idToken」**：body 必須帶合法 idToken，跨站攻擊者無法取得 → 天然防 CSRF。
- 全部走 `@@/utils/response` envelope（`return` 非 `throw`，三語）。
- `session-check` 讀 cookie 失敗一律回 `{ signedIn: false }`（不洩 detection），HTTP 200。
- `session-login`/`logout` 沿用 IP rate limit（複用 `@@/utils/rate-limit`）。

### 4. CSRF：Origin 白名單中央 middleware（`server/middleware/csrf-origin.ts` 新）

```ts
const ALLOWED_ORIGINS = [
  'https://da-line-liff-app.vercel.app',
  // 自定義網域上線時補
];
export default defineEventHandler((event) => {
  const method = event.method;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  if (!event.path.startsWith('/nuxt-api/')) return;
  const origin = getHeader(event, 'origin') ?? '';
  // 同源 fetch 一定帶 Origin；LINE webview 同源亦帶
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return forbiddenError({ zh_tw: '來源不合法', en: 'Invalid origin', ja: '不正なオリジン' });
  }
});
```

- `SameSite=Lax` 已擋掉大部分跨站；Origin 檢查是 defense-in-depth，對純同源 fetch 的本專案零摩擦。
- **例外**：`session-login`（無 cookie 也可打，靠 idToken 防護）與 LINE `callback`（GET，不在 mutating 清單）不受影響。
- Webhook（LINE messaging）等非瀏覽器來源無 Origin header → 判斷「有 Origin 才檢查」放行（webhook 另有簽章驗證）。

## Client 端改造（Phase 1 乘客）

### 5. 登入成功即種 cookie（`app/stores/5.store-auth.ts`）

`_ExchangeLiffTokenBackground` 成功拿到 `customToken` 後：
```ts
await signInWithCustomToken(getAuth(app), customToken);
const idToken = await getAuth(app).currentUser!.getIdToken();
await $fetch('/nuxt-api/auth/session-login', { method: 'POST', body: { idToken }, credentials: 'include' });
// 之後 API 靠 cookie；client 不再需要保住 Firebase session 供 API 認證
```

### 6. 移除自毀式自癒，改「重試換發」

[5.store-auth.ts:619-632](../../../app/stores/5.store-auth.ts) 的 `liff.logout() + reload` **刪除**。改為：line-exchange 傳輸失敗時，對 `_ExchangeLiffTokenBackground` 做**有上限退避重試（3 次，間隔 0.5/1/2s）**，全程**保留 LIFF 登入**（token 還有效）。這才是「沒 session 就乾淨鑄一個新的」的正解。

### 7. 開機判斷改問 server（`app/middleware/auth.ts`）

現況 `await WaitForAuthResolved()`（等 Firebase，最多 12s）→ 改為開機一次 `GET /nuxt-api/auth/session-check`（快、可短快取），以 **server 回的 `signedIn` 為權威**：
```ts
// pseudo：store 開機呼叫一次 session-check，設 isSignIn / roles
if (!authStore.bootChecked) await authStore.EnsureSessionChecked(); // 內部打 session-check
if (!authStore.isSignIn) return navigateTo(loginPath, { replace: true });
```
- 消除「先閃登出」的 12s race：server 直接說了算。
- Firebase client SDK 仍在（Phase 1 用來把 customToken 換 idToken 種 cookie），但**不再是登入判斷的權威**。

### 8. `methods.ts`：`credentials: 'include'` + Bearer 降級

所有 `$api` 請求加 `credentials: 'include'`（cookie 自動帶）。Bearer 注入**保留為過渡 fallback**（cookie 尚未種 / 舊 client），Phase 2 全端切換完成後於清理 wave 移除。`X-Admin-2FA-Session` header 維持不變。

## Phase 2：司機 + Admin 切換

- driver / admin 登入成功同樣 `session-login` 種 cookie；`ssr:false` 的 client race 靠 `session-check` 收斂。
- **2FA / PIN 疊合**：base session cookie 只證明「你是誰」；admin 進 `/nuxt-api/admin/*` 仍需 **2FA session（`X-Admin-2FA-Session`）** 作第二因子（`resolveIdentity` 內既有 gate 不動）；PIN step-up（[require-pin-session.ts](../../../server/utils/require-pin-session.ts)）維持敏感操作前彈窗。
- **可選優化（非阻塞）**：把 `admin_2fa_sessions` 的 token 也放進 httpOnly cookie（`da_2fa`），與 base session 一致管理；本階段先維持既有 header 機制降風險。

## Phase 3：入口硬化 — LINE Login server-side OAuth（消滅動態 redirect_uri）

用 server 端 LINE Login OAuth 取代 client `liff.login()` 作為「需要重新登入」時的授權路徑：

```
使用者按登入
   │
   ▼  GET /nuxt-api/auth/line/start?target=/booking
   │    server 產 state(含 target + CSRF nonce, 存短期) + 導向 LINE authorize
   │    redirect_uri = https://da-line-liff-app.vercel.app/nuxt-api/auth/line/callback  ← 固定、唯一、白名單一次搞定
   ▼
LINE 授權 → GET /nuxt-api/auth/line/callback?code=..&state=..
   │    server：驗 state → 用 code 換 LINE token（server-side）→ 驗 id_token/取 userId
   │    → 沿用 line-exchange 的 user 建置 → createCustomToken → 換 idToken → createSession(cookie)
   ▼  302 導回 target（已帶 cookie）
```

- **redirect_uri 固定**（無 `?liff.state=` 動態值）→ `redirect_uri does not match` **結構性消失**，PC / 外部瀏覽器 / 換機全適用。
- 白名單只需這一條固定 callback（passenger）+ driver 對應一條。
- **LIFF 深連結是否保留並列**：留給 Brain 決策（見 proposal）。若保留，深連結只用來「拿一次 identity」後仍走本 callback 種 cookie。
- 此階段後，乘客端理論上可移除 client `liff.login()` / `GetFreshLiffToken()` 的 redirect 分支（本變更先保留、Phase 3 驗收後另 wave 清）。

## Rollback 策略（每階段獨立）

| 階段 | 上線內容 | Rollback 方式 |
|------|----------|---------------|
| P0 | 純新增端點 + `getAuthFromEvent` cookie-first（Bearer fallback 保留） | cookie 路徑異常 → 前端不打 `session-login` 即可，全站自動退回 Bearer；server 端可 revert 為只走 Bearer |
| P1 | 乘客種 cookie + 開機 session-check + 移除 logout 自癒 | revert 乘客 client 為 Bearer-only + 恢復舊自癒（不建議）；cookie 端點留著不害事 |
| P2 | 司機/admin 切 cookie | 按端 revert；2FA/PIN gate 全程未動，安全性不降 |
| P3 | LINE Login server callback | 保留舊 `liff.login()` 路徑並列到驗收通過；rollback = 入口切回 liff.login |

## 安全性設計要點（逐項）

| 項目 | 做法 |
|------|------|
| XSS 偷 token | `HttpOnly` → JS 讀不到 cookie |
| 傳輸竊聽 | `Secure` + 全站 HTTPS（Vercel） |
| CSRF | `SameSite=Lax` + mutating 端點 Origin 白名單（§4）；`session-login` 靠 idToken 天然防 |
| Session 撤銷 | `verifySessionCookie(checkRevoked=true)`；logout `revokeRefreshTokens` |
| 角色即時性 | roles/approved 仍 Firestore SSOT（`resolveIdentity` 保留）；撤 admin 立即生效 |
| Cookie 外洩範圍 | host-only（不設 Domain），不與其他子網域共享 |
| 2FA/PIN | 疊在 base session 之上，gate 不動 |

## 風險與緩解

| 風險 | 緩解 |
|------|------|
| LINE in-app webview 關閉後清 cookie | 第一方 httpOnly cookie 已是該環境最耐用選項；掉了 → Phase 3 固定 callback 讓重登「一次點擊、100% 成功」；可另評估 `session-check` 內主動續簽 |
| 雙路徑（cookie/Bearer）語意分岔 | 兩者共用 `resolveIdentity`；加 e2e 對兩路徑跑同一組 role-gate 斷言 |
| SameSite=Lax 影響 OAuth callback 種 cookie | callback 是**頂層 GET 導航** → Lax cookie 正常種；避免用跨站 POST callback |
| `verifySessionCookie` 每 request 成本 | 與現況 `verifyIdToken` 同量級（皆 Admin SDK 本地驗簽 + Firestore roles read，零增量） |
| 冷啟 Firebase Admin init | 沿用既有 `useFirebaseAdmin` 單例；不引新依賴 |
| 過渡期 client 尚未種 cookie | Bearer fallback 兜底，無斷點 |

## 測試（Vitest + Playwright e2e）

- 單元：`session-cookie` 的 attribute 常數；`resolveIdentity` 對 cookie / Bearer 兩來源產出一致 AuthResult；CSRF middleware 對 allowed/blocked origin、GET 略過、webhook 無 Origin 放行。
- 端點：`session-login` 合法 idToken → Set-Cookie；`session-check` 有/無 cookie；`session-logout` 清 cookie。
- e2e（Playwright，對齊 [project-auth-e2e-matrix]）：乘客冷開 → 種 cookie → reload 後仍登入（不閃 /login）；模擬 localStorage 清空後 cookie 仍認得；admin 端 2FA gate 在 cookie 路徑仍擋。
- 全程沿用專案慣例（既有 600+ tests 持續綠；build 必跑，涉及 server middleware/head）。
