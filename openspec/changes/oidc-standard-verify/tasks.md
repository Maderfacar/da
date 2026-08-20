# OIDC Standard Verify — Tasks

> 慣例：`pnpm lint && pnpm test && pnpm build` 全綠才 commit + push origin main（直推 prod）。
> ⚠️ 本變更動的是登入熱路徑。合併後**必須實機驗一次手機瀏覽器登入**才算完成。

## Phase A：驗證抽成純函式 + 測試（不接線）

- [x] **A.0** OpenSpec change 四份 artifact ✅ 本次
- [x] **A.1** `pnpm add jose`（直接相依）→ 確認 `pnpm build` 綠（動相依必跑 build）
- [x] **A.2** `server/utils/line-id-token.ts`（新）
  - [x] `LINE_ISSUER` / `LINE_JWKS_URL` / `LINE_ID_TOKEN_ALG = 'ES256'` 常數
  - [x] 模組層 `createRemoteJWKSet`（跨 invocation 快取；20 把金鑰輪替，需依 kid 自動刷新）
  - [x] `verifyLineIdToken({ idToken, channelId, nonce })` → `{ ok, sub, name, picture } | { ok:false, reason }`
  - [x] `reason` 為列舉（`fetch` / `signature` / `claims` / `nonce` / `internal`），供告警 metadata 區分
- [x] **A.3** 單元測試 `server/utils/line-id-token.spec.ts`（21 個）
  - [x] 為此在 `verifyLineIdToken` 加了可注入的 `keyResolver` 參數 —— 讓單測能以本地自簽金鑰
        驗**完整流程**（含 configStr 正規化與 nonce 比對）而不打網路，而非只能繞過去測 jose
  - [x] 自簽 ES256 金鑰組出合法 token → 驗證通過並取出 sub/name/picture
  - [x] **迴歸**：`aud` 不符 → 失敗（今晚炸的就是這個比對）
  - [x] `iss` 不符 / 已過期 / 簽章錯 / nonce 不符 → 各自對應 reason
  - [x] channelId 傳入 number（模擬 destr 型別陷阱）→ 實測與字串版**完全一致**（`toEqual`）

## Phase B：接線（行為等價）

- [x] **B.1** `callback.get.ts` 改用 `verifyLineIdToken`，移除 `LINE_VERIFY_URL` 呼叫與手寫 aud/iss 比對
- [x] **B.2** 失敗埋點沿用現有 `auth.login.fail`，`stage='verify'`，`reason` 帶新的列舉值
- [x] **B.3** 確認 `configStr` 仍套用於 channelId（承諾 1 的靜態掃描會強制此事）
- [x] **B.4** lint / test / build 全綠 → commit + push

## 驗收（Brain AI）

- [ ] **V.1** ⚠️ **手機瀏覽器無痕實機登入一次** —— 本變更動的是登入熱路徑，這是唯一的真實驗收
- [ ] **V.2** LINE 內（LIFF）開一次，確認未受影響（本變更不動該路徑，但屬同一登入系統）
- [ ] **V.3** 查 prod log 確認 `auth.login.ok` 仍有 `route='browser-oauth'` 紀錄

## 回滾

單一 commit、範圍限於驗證那一段。若 prod 登入異常，`git revert` 即回到呼叫 verify 端點的版本。
成功率告警（3 次失敗即 critical）會在 3 次失敗內發現異常。

## 實作期間的發現（記錄用）

- **單測抓到一個真的分類缺陷**：原本「所有非 jose 錯誤」一律歸為 `fetch`，於是
  「呼叫參數型別錯」會被回報成網路問題 —— 正是這個列舉要避免的事。已新增 `internal`
  分類，網路層才歸 `fetch`。
- **jose 錯誤類別的繼承陷阱**：`JWTClaimValidationFailed` 等皆繼承 `JOSEError`，泛用判斷
  必須放在具體類別之後，否則會吃掉它們；`JWTExpired` 不繼承 `JWTClaimValidationFailed`，
  兩者都要檢（已實測確認，非憑印象）。
