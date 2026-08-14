## ADDED Requirements

### Requirement: Server 簽發 httpOnly session cookie
系統 SHALL 於使用者通過身分驗證後，由 server 用一個剛驗過的 Firebase ID token 呼叫 `createSessionCookie` 簽發 session cookie，並以 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`、host-only（不設 Domain）、效期 14 天種下，cookie 名稱 `da_session`。client 端 JavaScript MUST NOT 能讀取此 cookie。

#### Scenario: 登入成功種下 session cookie
- **WHEN** client 取得 Firebase ID token 後呼叫 `POST /nuxt-api/auth/session-login { idToken }`
- **THEN** server 驗證該 idToken、`createSessionCookie` 並回 `Set-Cookie: da_session=…; HttpOnly; Secure; SameSite=Lax; Path=/`
- **AND** 後續同源請求由瀏覽器自動夾帶該 cookie，不需 client 保存或注入 token

#### Scenario: 非法 idToken 不種 cookie
- **WHEN** `session-login` 收到無效 / 過期的 idToken
- **THEN** 回錯誤 envelope、不種 cookie

### Requirement: Server 端 session 驗證與身分解析
系統 SHALL 提供 `getSessionFromEvent(event)`：讀 `da_session` cookie → `verifySessionCookie(raw, checkRevoked=true)` → 經共用的 `resolveIdentity` 解析出 `uid` / `lineUid` / `roles` / `approved` / `level` / `permissions`。`getAuthFromEvent` SHALL 改為「先 cookie、後 `Authorization: Bearer` fallback」，兩條入口共用同一 `resolveIdentity`。roles / approved MUST 仍以 Firestore 即時讀取為權威（claims 僅 fallback），與現況一致。

#### Scenario: cookie 路徑解析身分
- **WHEN** 受保護端點收到帶有效 `da_session` cookie 的請求
- **THEN** `getAuthFromEvent` 經 cookie 驗證回 `ok:true` 且 roles 取自 Firestore 即時值

#### Scenario: 無 cookie 時退回 Bearer（過渡相容）
- **WHEN** 請求無 `da_session` cookie 但帶 `Authorization: Bearer <idToken>`
- **THEN** `getAuthFromEvent` 走既有 Bearer 邏輯，行為與導入本變更前 100% 等價

#### Scenario: 已撤銷的 session 被擋
- **WHEN** 使用者已登出並 `revokeRefreshTokens`，其 cookie 仍被送出
- **THEN** `verifySessionCookie(checkRevoked=true)` 驗證失敗，回 401

### Requirement: 開機以 server 為登入判斷權威
系統 SHALL 提供 `GET /nuxt-api/auth/session-check`，client 於開機呼叫一次以取得權威登入狀態（`signedIn` / `roles` / `approved`）。乘客端 middleware MUST NOT 再以「等待 client Firebase session 復原（最多 12s）」作為登入判斷依據。

#### Scenario: 冷開不再閃登出
- **WHEN** 乘客在清空 localStorage/IndexedDB 的裝置上、但持有有效 `da_session` cookie，冷開受保護頁
- **THEN** `session-check` 回 `signedIn:true`，頁面直接放行，不出現「先閃 `/login` 再跳回」

#### Scenario: 未登入回報明確
- **WHEN** 無 cookie 或 cookie 無效時呼叫 `session-check`
- **THEN** 回 HTTP 200 `{ signedIn:false }`（不洩 detection），middleware 導向對應登入頁

### Requirement: CSRF 防護
系統 SHALL 對所有 `/nuxt-api/*` 的 mutating 請求（POST/PUT/PATCH/DELETE）在中央 middleware 檢查 `Origin` header：帶 Origin 且不在白名單者回 403；無 Origin 的非瀏覽器來源（如 LINE webhook，另有簽章驗證）放行。cookie MUST 設 `SameSite=Lax`。

#### Scenario: 跨站來源被擋
- **WHEN** mutating `/nuxt-api/*` 請求帶不在白名單的 `Origin`
- **THEN** 回 403，不執行狀態變更

#### Scenario: 同源請求正常
- **WHEN** 同源 client 發出 mutating 請求（Origin 在白名單）
- **THEN** 通過 CSRF 檢查，正常處理

### Requirement: 無現存 session 時可乾淨鑄新 session（不 logout）
當使用者無有效 session 但持有有效 LINE 身分憑證時，系統 SHALL 直接用該憑證鑄造新的 Firebase session 與 cookie；session-exchange 傳輸失敗時 SHALL 以有上限退避重試恢復，且 MUST NOT 呼叫 `liff.logout()` 或以登出方式「自癒」。

#### Scenario: 交換失敗以重試恢復
- **WHEN** line-exchange 因傳輸層失敗（timeout / 冷啟 / 導航取消）回 null
- **THEN** 系統保留 LIFF 登入狀態並退避重試（上限次數內），成功即鑄 session
- **AND** 不執行 `liff.logout()`、不進入 `/login → liff.login()` 的重登迴圈

### Requirement: 固定 callback 的 LINE Login（消滅動態 redirect_uri）
需要重新登入時，系統 SHALL 以 server-side LINE Login OAuth（`/nuxt-api/auth/line/start` → 固定 `redirect_uri` 的 `/nuxt-api/auth/line/callback`）完成授權並在 callback 內鑄 session cookie；redirect_uri MUST 為固定、可一次白名單的值，MUST NOT 含每次不同的 `liff.state` 動態查詢。

#### Scenario: 外部瀏覽器 / 換機登入不再報 redirect_uri 錯
- **WHEN** 使用者於 PC 外部瀏覽器或新裝置需要重新登入
- **THEN** 走 `line/start → 固定 callback` 完成授權並種 cookie，不再出現 `redirect_uri does not match`

#### Scenario: callback 於頂層導航種 cookie
- **WHEN** LINE 授權後以頂層 GET 導航回固定 callback
- **THEN** server 換 code、鑄 session 並以 `SameSite=Lax` cookie 種下後 302 導回目標頁

### Requirement: 登出清除 session
系統 SHALL 提供 `POST /nuxt-api/auth/session-logout` 清除 `da_session` cookie，並可選 `revokeRefreshTokens` 使既有 session cookie 失效。

#### Scenario: 登出後受保護端點拒絕
- **WHEN** 使用者呼叫 `session-logout` 後再以舊 cookie 存取受保護端點
- **THEN** 回 401（cookie 已清 / 已撤銷）

### Requirement: 權限模型與第二因子不變
本變更 MUST NOT 改變 roles / approved / admin level / permissions 的判斷語意，亦 MUST NOT 改變 admin 2FA TOTP 與 PIN step-up 機制；2FA / PIN 作為 base session cookie 之上的第二因子疊合，`/nuxt-api/admin/*` 的 2FA gate 於 cookie 路徑同樣生效。

#### Scenario: cookie 路徑下 admin 2FA 仍生效
- **WHEN** admin 帶有效 base session cookie 但無有效 2FA session，存取 `/nuxt-api/admin/*`（非 bypass 名單）
- **THEN** 回 403「需要兩階段驗證」，與現況一致

#### Scenario: admin+driver 雙身分走非 admin 端不被 2FA 誤擋
- **WHEN** 同時具 admin+driver 身分者以 cookie 存取司機端 / 乘客端端點
- **THEN** 不被 admin 2FA gate 攔截
