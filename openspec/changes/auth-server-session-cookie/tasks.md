# Auth Server Session Cookie — Tasks

> 逐階段切分，每階段一支（或多支）獨立 commit + push origin main（直推 prod），可獨立 rollback。
> 慣例：每支跑 `pnpm lint:fix && pnpm build && pnpm test` 全綠才提交（build 必跑，涉及 server middleware / cookie / head）。

## Phase 0：Session cookie 地基（純新增，零行為變更）

- [ ] **P0.1** OpenSpec change 四份 artifact（proposal / design / tasks / spec）✅ 本次
- [ ] **P0.2** `server/utils/session-cookie.ts`（新）
  - [ ] `SESSION_COOKIE_NAME='da_session'` / `SESSION_MAX_AGE_SEC=14d` / `cookieOpts()`（HttpOnly/Secure/SameSite=Lax/Path=/、無 Domain）
  - [ ] `createSession(event, idToken)` → `auth.createSessionCookie` + `setCookie`
  - [ ] `verifySession(event)` → `auth.verifySessionCookie(raw, true)`，失敗回 null
  - [ ] `clearSession(event)` → maxAge=0
- [ ] **P0.3** `server/utils/require-auth.ts`（改，**行為等價重構**）
  - [ ] 抽出 `resolveIdentity(event, decoded)`：把現有 lineUid / Firestore roles(SSOT) / 503 fail-closed / claims fallback / admins level+permissions / 2FA gate 原封搬進去
  - [ ] `getAuthFromEvent`：有 cookie → `getSessionFromEvent`；否則走原 Bearer 邏輯 → `resolveIdentity`
  - [ ] 確認所有現有呼叫點語意不變（無 cookie 時 100% 等價舊行為）
- [ ] **P0.4** `server/utils/session-auth.ts`（新）— `getSessionFromEvent(event)` = `verifySession` → `resolveIdentity`
- [ ] **P0.5** `server/middleware/csrf-origin.ts`（新）— mutating(`POST/PUT/PATCH/DELETE`) 且 `/nuxt-api/*`、有 Origin 才檢查、不在白名單回 403；webhook（無 Origin）與 GET 放行
  - [ ] 確認 LINE webhook 端點路徑不被誤擋（無 Origin → 放行；另有簽章驗證）
- [ ] **P0.6** 端點三支（`server/routes/nuxt-api/auth/`）
  - [ ] `session-login.post.ts` — body `{ idToken }` → `verifyIdToken` → `createSession` → `successResponse({ ok:true })` + IP rate limit
  - [ ] `session-logout.post.ts` — `clearSession` + 可選 `revokeRefreshTokens`
  - [ ] `session-check.get.ts` — `getSessionFromEvent`（cookie 可無）→ `{ signedIn, roles, approved, lineUid, level? }`；無 cookie 回 `{ signedIn:false }` 200
- [ ] **P0.7** 單元測試：`resolveIdentity` cookie/Bearer 一致；CSRF middleware allowed/blocked/GET/no-origin；端點 3 支 happy + edge
- [ ] **P0.8** 終局檢查 lint / build / test 全綠 → commit + push（純新增，不影響現有 client）
- [ ] **P0.9** prod 驗證：`curl` `session-check`（無 cookie）回 `{signedIn:false}`；既有 Bearer 端點行為不變（回歸抽樣）
- [ ] **P0.10** 寫 P1 handoff prompt（單塊 code block、無嵌套 fence）

## Phase 1：乘客端切換

- [x] **P1.1** `app/stores/5.store-auth.ts`：`_SeedSessionCookie` 於 `onAuthStateChanged(user)` 種 cookie（單一 seed 點，涵蓋 session 復原 + `signInWithCustomToken` 新建；LIFF token 過期但 Firebase session 在的回訪用戶也種得到）
- [x] **P1.2** 移除 B 方案 `liff.logout()+reload`，改**有上限退避重試**（3 次 0.5/1/2s，全程保留 LIFF 登入）
- [x] **P1.3** `store-auth` 加 `EnsureSessionChecked()`：開機打一次 `session-check`（sticky），以 server `signedIn` 設 `_sessionSignedIn`/`roles`/`approved`/`level`；`isSignIn` 改為「Firebase user 或 cookie session」二擇一
- [x] **P1.4** `app/middleware/auth.ts`：先 `EnsureSessionChecked()`；乘客路徑 cookie 命中即放行免等 Firebase，admin/driver 仍等 `WaitForAuthResolved`（2FA/approved gate 靠 Firebase user，P2 前不放寬）
- [x] **P1.5** `app/middleware/role.ts`：頂部 `await EnsureSessionChecked()` 使 roles/approved 與 server（Firestore 即時 SSOT）一致
- [x] **P1.6** `app/protocol/fetch-api/methods.ts`：全請求 `credentials:'include'`（含 xhrFileUpload `withCredentials`）；Bearer 保留為過渡 fallback
- [ ] **P1.7** e2e（Playwright）：乘客冷開 → 種 cookie → reload 不閃 `/login`；清 localStorage 後 cookie 仍認；模擬 line-exchange 傳輸失敗 → 重試成功、不 logout、不迴圈 — 留 Brain AI prod 實測
- [x] **P1.8** 終局檢查 lint / build / test 全綠 → commit + push
- [ ] **P1.9** prod 驗證：乘客換機 / 登出後重登不再迴圈；DevTools 見 `da_session` HttpOnly cookie；reload 保持登入 — 留 Brain AI
- [x] **P1.10** 寫 P2 handoff prompt

## Phase 2：司機 + Admin 切換（疊合 2FA / PIN）

- [ ] **P2.1** 司機登入流程（`app/pages/driver/auth/*` + store）成功後種 cookie；開機走 `session-check`
- [ ] **P2.2** admin 登入流程種 cookie；確認 **2FA gate 在 cookie 路徑仍擋** `/nuxt-api/admin/*`（`resolveIdentity` 內既有邏輯）
- [ ] **P2.3** 確認 PIN step-up（[require-pin-session.ts](../../../server/utils/require-pin-session.ts)）與 base cookie 疊合無衝突
- [ ] **P2.4** 收斂 `ssr:false` 端 client race：driver/admin 開機一律 server `session-check` 為準
- [ ] **P2.5**（可選）把 `admin_2fa_sessions` token 也 cookie 化（`da_2fa`）統一管理 — 評估後決定是否納入本階段
- [ ] **P2.6** e2e：driver role-gate、admin 2FA gate 在 cookie 路徑全綠；admin/driver 雙身分走各端不被 2FA 誤擋
- [ ] **P2.7** 終局檢查 → commit + push；prod 三端驗收
- [ ] **P2.8** 寫 P3 handoff prompt

## Phase 3：入口硬化 — LINE Login server callback

- [ ] **P3.1** `server/routes/nuxt-api/auth/line/start.get.ts`：產 `state`（target + CSRF nonce，存短期 Firestore / signed）→ 302 LINE authorize，`redirect_uri` = 固定 callback
- [ ] **P3.2** `server/routes/nuxt-api/auth/line/callback.get.ts`：驗 state → code 換 LINE token（server）→ 驗 id_token/取 userId → 沿用 line-exchange user 建置 → `createCustomToken` → 換 idToken → `createSession` → 302 導回 target
- [ ] **P3.3** LINE console：登記固定 callback（passenger + driver 各一條）— **交 Brain 設定**（Claude 不碰 LINE console）
- [ ] **P3.4** 前端「需要重登」入口改導 `line/start`（取代 client `liff.login()`）；保留舊 `liff.login()` 路徑並列到驗收通過
- [ ] **P3.5** e2e / 手測：PC 外部瀏覽器 + 換機 + 全新用戶登入皆不再 `redirect_uri does not match`
- [ ] **P3.6**（驗收後另 wave）清理 `GetFreshLiffToken()` redirect 分支 + Bearer 注入殘留 + 舊 liff.login 入口
- [ ] **P3.7** 終局檢查 → commit + push；prod 三端 + PC 驗收

## 驗收標準（Definition of Done）

- 乘客換機 / 登出後重登**一次成功、不迴圈、不白畫面**（消滅本次事件的死鏈）。
- session 存 `da_session` httpOnly cookie；清 localStorage/IndexedDB 後仍保持登入。
- 開機登入判斷來自 server `session-check`，無「先閃登出」race。
- roles/approved 仍 Firestore 即時 SSOT；admin 2FA / PIN gate 在 cookie 路徑全數生效。
- CSRF：mutating 端點對非白名單 Origin 回 403；同源正常。
- Phase 3 後：PC / 外部瀏覽器 / 全新用戶登入無 `redirect_uri does not match`。
- 每階段 lint / build / test 全綠；prod 驗收通過再進下一階段。

## 過渡與相容備註

- P0 純新增，**不影響任何現有 client**（cookie 不在 → 全走既有 Bearer）。
- P1–P2 期間 cookie 與 Bearer 雙路徑並存，共用 `resolveIdentity` 保證語意一致。
- Bearer 注入殘留與 client `liff.login()` 分支於 P3 驗收後的清理 wave 移除，不在前面階段動，降風險。
