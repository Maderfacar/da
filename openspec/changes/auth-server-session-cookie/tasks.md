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

> ★核心坑採 **A 方案**（2026-08-15）：擴充 `session-check` 於開機一把回
> `roles+approved+level+permissions+admin2faEnrolled+driverApplication`，store 一次載齊 gate 欄位。
> cookie-only 裝置（`user.value=null`）不再依賴 client Firestore SDK 即可正確 gate。
> 因此 auth.ts 拿掉「admin/driver 仍等 Firebase」過渡限制、role.ts 拿掉「!authResolved return」保護。

- [x] **P2.1** 司機登入流程種 cookie：由 `onAuthStateChanged → _SeedSessionCookie` 單一 seed 點涵蓋（司機 LIFF→customToken→signInWithCustomToken 亦觸發此分支）；開機走 `session-check`（bootstrap）— **免改登入頁**
- [x] **P2.2** admin 登入流程種 cookie（admin 亦走 LINE 取得 admin role，同 seed 點）；2FA gate 在 cookie 路徑仍擋 `/nuxt-api/admin/*`（`resolveIdentity` 內既有邏輯，`lineUid` 改由 cookie 解析、X-Admin-2FA-Session header 不變）
- [x] **P2.3** PIN step-up（[require-pin-session.ts](../../../server/utils/require-pin-session.ts)）與 base cookie 疊合無衝突：`requirePinSession(event, auth)` 的 `auth.lineUid` 由 `getAuthFromEvent`（cookie 或 Bearer）解析，PIN token 仍獨立 header 驗證，兩道正交
- [x] **P2.4** 收斂 `ssr:false` 端 client race：driver/admin 開機一律以 server `session-check`（bootstrap）為準 — auth.ts 移除 needsFirebase 等待、role.ts 移除 authResolved 前置
- [ ] **P2.5**（可選，**本階段不做**）把 `admin_2fa_sessions` token cookie 化（`da_2fa`）：評估結論 → 2FA session 存 localStorage 意即「清儲存＝需重做 2FA」屬合理安全行為，base cookie 已根治「看似登出」；延後不影響 DoD
- [ ] **P2.6** e2e：driver role-gate、admin 2FA gate 在 cookie 路徑全綠；admin/driver 雙身分走各端不被 2FA 誤擋 — 留 Brain AI prod 實測（同 P1.7 慣例）
- [x] **P2.7** 終局檢查 lint / build / test 全綠 → commit + push（prod 三端驗收留 Brain AI）
- [x] **P2.8** 寫 P3 handoff prompt

## Phase 3：入口硬化 — LINE Login server callback

- [x] **P3.1** `server/routes/nuxt-api/auth/line/start.get.ts`：產 `state`（target + clientType + nonce，存 `line_login_states/{state}` Firestore + TTL 10min）→ 302 LINE authorize，`redirect_uri` = 固定 callback（`lineLoginRedirectUri` 共用）
- [x] **P3.2** `server/routes/nuxt-api/auth/line/callback.get.ts`：驗 state（一次性消費，防 CSRF/replay）→ code 換 LINE token（server 帶 secret）→ verify id_token（簽名+aud+iss+nonce）取 sub/name/picture → `provisionLineUser`（與 line-exchange 抽共用 helper 單一真相）→ `createCustomToken` → Firebase REST signInWithCustomToken 換 idToken → `createSessionCookie` → 302 導回 target
- [x] **P3.3** LINE console：登記固定 callback（單一 `/nuxt-api/auth/line/callback`）— **Brain 已完成**（舊 4 條 client callback 過渡期保留，P3.6 清）
- [x] **P3.4** 前端「需要重登」入口改導 `/nuxt-api/auth/line/start`（login/driver-auth 兩頁 `ClickLineLogin` 取代 client `liff.login()`）；`GetFreshLiffToken()` 舊 `liff.login()` 分支保留到驗收通過（P3.6 清）
- [ ] **P3.5** e2e / 手測：PC 外部瀏覽器 + 換機 + 全新用戶 + LINE in-app 開連結，乘客/司機各驗皆不再 `redirect_uri does not match` — 留 Brain AI prod 實測
- [ ] **P3.6**（驗收後另 wave）清理 `GetFreshLiffToken()` redirect 分支 + Bearer 注入殘留 + 舊 liff.login 入口 + 舊 4 條 client callback（交 Brain console 刪）+（若 callback 完全取代）line-exchange
- [x] **P3.7** 終局檢查 lint / build / test 全綠 → commit + push origin main；prod 三端 + PC 驗收留 Brain AI，通過後提醒 rotate Channel secret

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
