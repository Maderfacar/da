# Auth Server Session Cookie — 認證架構根治（server httpOnly session cookie）

> Brain AI（架構師）與 Claude（Execution AI）2026-08-14 鎖定方向。
> 範圍：把三端認證從「client 持有 Firebase ID token + 前端 SPA 判斷登入」遷移到「server 簽發 httpOnly session cookie + server 端判斷登入；LINE 只在首次登入認人」。
> 交付形態：**1 個地基（Phase 0）+ 3 個切換階段（Phase 1/2/3）**，每階段可獨立上 prod、可 rollback。

## Why

乘客端「時不時卡登入畫面 / 頁面開不了 / 重複出現登入畫面」是**體質問題，不是單一 bug**。2026-08-14 陳識翔（`U5813df1cc07f1f5c884035f61ccfaae9`）換手機重登，07:25–07:51 連續 6+ 次 `auth.liff.init.failed: redirect_uri does not match`、一次都進不去；查 `client_error_logs` 重建出這條死鏈：

1. **session 真相放在前端、且依賴 LINE in-app webview 儲存活著**。現況：每個受保護 API 都靠 client 在 `Authorization: Bearer` 塞 **Firebase ID token**（[require-auth.ts](../../../server/utils/require-auth.ts)），token 靠瀏覽器儲存的 Firebase session 復原。LINE webview 的 IndexedDB/localStorage 不可靠（`b73caca` 就是為避 IndexedDB hang 才改 `browserLocalPersistence`），儲存一被清就「看似登出」。
2. **登入判斷在 client、有 12s race**。[middleware/auth.ts](../../../app/middleware/auth.ts) 是 client-only、`await WaitForAuthResolved()` 最多 12s；server 第一個 byte 不知道你登沒登入 → 「先閃登出 → 踢 `/login` → hydrate 完才發現其實有登入」。
3. **line-exchange 這座橋一 hiccup 就斷**。[line-exchange.post.ts](../../../server/routes/nuxt-api/auth/line-exchange.post.ts) 全程 try-catch 回 HTTP 200 envelope，唯一會讓 client `$fetch` throw 的是**傳輸層失敗**（function timeout / 冷啟 / 背景 fetch 被導航取消）。
4. **失敗自癒反而砍材料**。[5.store-auth.ts:619-632](../../../app/stores/5.store-auth.ts) 的 B 方案 `liff.logout() + reload`，把手上唯一能鑄 session 的 LIFF access token 也清掉，reload 後停在裸網域無 LIFF context → `liff.login()` 退化成一般 OAuth，其 `redirect_uri` = 端點根 + **動態 `?liff.state=`**，永遠無法白名單化 → `redirect_uri does not match` 無限迴圈。session-less 的裝置因此永遠出不來。

**根因一句話：把「登入的真相」放在前端、綁在 LINE webview 的儲存上，並用一座易斷的橋每次重建。** 加白名單、補畫面都是補丁，治不好這個類別的病。

## What Changes

### 終態架構（市面成熟做法）

> Session 放在 **server 簽發的 httpOnly cookie**，登入判斷在 **server 端**做；第三方登入（LINE）只在「第一次登入那一刻」用來認人，之後就退出熱路徑。

對應 Firebase 官方 SSR 建議：**Firebase Auth Session Cookies**（`createSessionCookie` / `verifySessionCookie`），沿用既有 Firebase Admin，不引新框架。

- **Session = httpOnly + Secure + SameSite=Lax cookie**，瀏覽器每個 request 自動帶，JS 讀不到、不靠 localStorage/IndexedDB → 消滅成因 1。
- **登入判斷在 server**（讀 cookie / `session-check`）→ 消滅成因 2 的 client race。
- **LINE 只認一次**：認完人 → server 鑄 cookie → 之後每次開頁靠 cookie，不再每次 `liff.init` / 重換 token / 依賴 LINE 儲存 → 消滅成因 3、4。
- **Phase 3 用固定 callback 的 LINE Login server-side OAuth** → 動態 `redirect_uri` 死路結構性消失。

### 已鎖定的決策（不需再拍板）

| 項目 | 決策 |
|------|------|
| Session 機制 | **Firebase Session Cookie**（`createSessionCookie`，非自建 JWT、非換 Auth.js/Lucia） |
| Cookie 屬性 | `HttpOnly; Secure; SameSite=Lax; Path=/`；host-only（不設 Domain，不跨子網域）；名稱 `da_session` |
| 效期 | 14 天（Firebase 上限）；`session-check` 在門檻內可續簽 |
| CSRF 防護 | `SameSite=Lax` + 對所有 mutating（POST/PUT/PATCH/DELETE）nuxt-api 端點做 **Origin 白名單檢查**（中央 Nitro middleware） |
| roles 權威 | **不變**，維持 Firestore 即時 SSOT（admin 加/撤角色即時生效） |
| 2FA / PIN | **不變機制**，作為 base session 之上的第二因子疊合（Phase 2 收斂） |
| 過渡相容 | `getAuthFromEvent` 改「先 cookie、後 Bearer fallback」，Bearer 路徑 Phase 1–2 期間保留，Phase 3 後清 |
| 影響順序 | 乘客先切（痛點最大）→ 司機/admin → 入口硬化 |

### 新增 / 修改（總覽，逐階段細節見 tasks.md）

| 檔案 | 動作 | 階段 |
|------|------|------|
| `server/utils/session-cookie.ts`（新） | `createSession`/`verifySession`/`clearSession` 封裝 `createSessionCookie`/`verifySessionCookie` + cookie 屬性常數 | P0 |
| `server/utils/require-auth.ts`（改） | 抽出 `resolveIdentity(decoded, event)`（roles/level/permissions/2FA 共用）；`getAuthFromEvent` 先 `getSessionFromEvent`（cookie）後 Bearer fallback | P0 |
| `server/utils/session-auth.ts`（新） | `getSessionFromEvent(event)` → 讀 cookie → `verifySessionCookie` → `resolveIdentity` | P0 |
| `server/middleware/csrf-origin.ts`（新） | mutating 請求 Origin 白名單檢查（fail-closed 403） | P0 |
| `server/routes/nuxt-api/auth/session-login.post.ts`（新） | body `{ idToken }` → verify → `createSessionCookie` → setCookie | P0 |
| `server/routes/nuxt-api/auth/session-logout.post.ts`（新） | 清 cookie（+ 可選 revoke refresh tokens） | P0 |
| `server/routes/nuxt-api/auth/session-check.get.ts`（新） | 讀 cookie → 回 `{ signedIn, roles, approved, ... }`（開機權威判斷） | P0 |
| `app/stores/5.store-auth.ts`（改） | 成功換 customToken → `signInWithCustomToken` → `getIdToken` → 打 `session-login`；移除 `liff.logout()` 自癒（改重試換發）；開機改問 `session-check` | P1 |
| `app/middleware/auth.ts` / `role.ts`（改） | 以 `session-check` 的 server 真相取代 12s Firebase race | P1 |
| `app/protocol/fetch-api/methods.ts`（改） | `credentials: 'include'`；Bearer 注入降為過渡 fallback | P1 |
| `app/pages/driver/auth/*` / admin 登入流程（改） | 同套 cookie；與 2FA/PIN session 疊合 | P2 |
| `server/routes/nuxt-api/auth/line/start.get.ts`、`line/callback.get.ts`（新） | LINE Login server-side OAuth（固定 redirect_uri）→ 鑄 cookie → 導回 | P3 |
| `firestore.rules`（可能改） | 若 2FA/session 相關 collection 需調整讀寫（多維持 admin SDK 繞 rules） | P2/P3 |

## Impact

### Affected specs
- 新建：`auth-session`

### Affected code
- 新增：`server/utils/session-cookie.ts`、`server/utils/session-auth.ts`、`server/middleware/csrf-origin.ts`、`server/routes/nuxt-api/auth/session-{login,logout,check}.*`、`server/routes/nuxt-api/auth/line/{start,callback}.get.ts`（P3）
- 修改：`server/utils/require-auth.ts`（抽 resolveIdentity + cookie-first）、`app/stores/5.store-auth.ts`、`app/middleware/auth.ts`、`app/middleware/role.ts`、`app/protocol/fetch-api/methods.ts`、driver/admin 登入頁

### 明確保證不影響
- **roles / approved / admin level / permissions 判斷邏輯**：仍 Firestore 即時 SSOT（[require-auth.ts](../../../server/utils/require-auth.ts) 現有語意保留）。
- **2FA TOTP / PIN step-up 機制**：機制不變，只在 base session 之上疊合。
- **計價引擎、訂單、派單、LINE 通知**：完全不碰。
- **既有 Bearer-based 端點**：過渡期雙路徑並存（cookie-first、Bearer fallback），不破壞現有 client。

## 安全性（誠實揭露）

- ✅ **淨提升**：Firebase ID token 現在 JS 讀得到（XSS 可偷）；改 httpOnly cookie 後 JS 讀不到，堵 XSS 偷 token。
- ⚠️ **新引入 CSRF**：cookie 自動帶 → 需防跨站偽造。解法：`SameSite=Lax` + mutating 端點 Origin 白名單檢查（見 design）。這是成熟做法標配、非未知數。
- ✅ **撤銷更快**：`verifySessionCookie(checkRevoked)` + logout `revokeRefreshTokens`，被盜可即時失效（現況要等 1h token TTL）。
- ⚠️ **LINE webview cookie 非絕對不掉**：部分版本關閉後清 cookie；但第一方 httpOnly cookie 比現況的 IndexedDB/localStorage 耐用，**且就算掉了，重登是一次乾淨、100% 成功的 server 往返**（Phase 3 固定 callback），不是掉進去出不來。

## 誠實澄清：階段是遷移排法，不是「業界規定 3 階段」
- **終態架構** = 市面成熟標準；
- **「1 地基 + 3 階段」= 為你們這個「已上線、不能停機」的系統排的平滑遷移**（每階段獨立可上、可 rollback）。全新專案第一天就直接這樣蓋、沒有階段。

## 不在本變更（後續可選）
- **多 IdP**（Google / Apple / Phone OTP）—— 見 `project-multi-channel-auth-notify`，另案。
- **完全移除乘客端 Firebase 客戶端 SDK**（Phase 3 後理論可行）—— 本變更保留，降風險。
- **把 2FA / PIN session 也 cookie 化統一**（可選優化，非阻塞）。
- **SSR 端 gate 頁面**（cookie 在 server 讀取後直接 SSR 擋）—— 本變更先用 client `session-check`，SSR gate 留後續。

## 待 Brain AI 審核 / 決策
- Cookie 效期 14 天是否合適（vs 更短 + 更積極續簽）。
- Phase 3 是否保留 LIFF 深連結入口（in-chat mini-app）並列，或完全改走 server callback。
- CSRF 是否只做 Origin 檢查，或加 double-submit token（Origin 檢查對純同源 fetch 已足夠）。
