# Config Contract Gate — Tasks

> 慣例：跑 `pnpm lint && pnpm test && pnpm build` 全綠才 commit + push origin main（直推 prod）。

## Phase A：契約與純函式驗證

- [x] **A.0** OpenSpec change 四份 artifact ✅ 本次
- [x] **A.1** `shared/env-contract.mjs`（新）
  - [x] `ENV_CONTRACTS` — 每項含 `env` / `path` / `kind` / `importance` / `pattern` / `note`
  - [x] `kind`：`json` / `numeric-id` / `hex64` / `url` / `secret` / `text`
  - [x] `validateEnvValues(env)` → `EnvIssue[]`（缺失 + 格式，純函式）
  - [x] `DESTR_HAZARD_CONTRACTS` — `kind === 'numeric-id'` 者，供靜態掃描與執行期檢查共用
  - [x] `validateRuntimeConfigTypes(config)` → 執行期檢查實際型別（build 期看不到 destr 後的樣子）
- [x] **A.2** 單元測試 `shared/env-contract.spec.ts`
  - [x] **迴歸**：`NUXT_LINE_LOGIN_CHANNEL_ID` 經 destr 變成 number → `validateRuntimeConfigTypes` 必須回報
  - [x] 必要缺失 / 格式錯誤 / 正常值三種情境
  - [x] 契約本身自檢：`env` 不重複、`path` 不重複

## Phase B：build gate

- [x] **B.1** `scripts/check-env-contract.mjs`（新）
  - [x] 環境值來源：Vercel（`process.env`）／本機（合併 `.env.dev`，不存在則印提示並放行，不擋新 clone）
  - [x] 硬擋：格式錯誤、核心必要缺失
  - [x] 警告不擋：非核心缺失（`.env.dev` 非 prod 可靠鏡像，見 proposal）
  - [x] **靜態掃描**：`numeric-id` 設定凡直接 `config.<key>` 讀取而未經 `configStr()` 包裹 → 硬擋
  - [x] 輸出只印設定名稱與問題，**永不印值**
- [x] **B.2** `package.json` — `build` 前置執行 gate
- [x] **B.3** 反向驗證（三項皆實測通過）：格式改壞 → 紅；核心設定刪除 → 紅；拿掉 `configStr()` → 紅；還原 → 綠
- [x] **B.4** gate 首次執行即命中一顆真實同類危害：`app/stores/5.store-auth.ts` 把 `firebaseMessagingSenderId`（純數字，destr 後為 number）直接餵給 Firebase `initializeApp`，而 `FirebaseOptions` 要求 string。已修
- [x] **B.5** `configStr` 由 `server/utils/` 移至 `shared/config-str.ts` —— client 端（store）也需要它；`server/utils/runtime-config.ts` 保留為轉出入口，既有 import 不受影響

## Phase C：執行期健檢端點

- [x] **C.1** `server/routes/nuxt-api/_health/config.get.ts`（新）
  - [x] `CRON_SECRET` Bearer 保護（與 cron 端點同範式）
  - [x] 跑 `validateEnvValues` + `validateRuntimeConfigTypes` 於**實際 runtimeConfig**
  - [x] 回傳只含名稱 / 狀態 / 問題種類，**永不回值**
- [x] **C.2** `.github/workflows/login-health.yml` 加一步呼叫健檢端點，有 error 則 workflow 紅
- [x] **C.3** lint / test / build 全綠 → commit + push

## 驗收（Brain AI）

- [ ] **V.1** 手動觸發 GitHub Actions → 看健檢端點回報的 prod 設定實況
- [ ] **V.2** 依 V.1 結果，把確認存在於 prod 的項目由「警告」升級為「硬擋」（一行 importance 改動）
- [ ] **V.3** 確認 `NUXT_LINE_CHANNEL_ID` 是否已設（承諾 2 Phase D 的跨 channel 檢查需要它才會生效）

## 留待後續

- 承諾 3：登入驗證改用標準 OIDC 函式庫，縮小手寫面積
