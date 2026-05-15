## Why

目前專案使用 `nuxt@^4.3.1`，距離官方最新版（Nuxt 4.4.x 系列）已有數個小版本差距，包含 Vue Router v5 內建升級、`unrouting` 路由產生器（dev HMR 提速約 28×）、`createUseFetch` / `createUseAsyncData` 工廠、`useAnnouncer` 無障礙 composable、ISR/SWR payload 抽出等改善。長期不升版會累積技術負債，導致未來跨版本升級風險增加，並錯過效能與安全修補。趁現在版本距離仍小，把整個 Nuxt 生態（核心、官方模組、第三方模組、Vue/Vue Router）一次升到最新穩定版，是最低成本的時機。

## What Changes

- 升級 `nuxt`：`^4.3.1` → 最新 4.x 穩定版（預期 `^4.4.x`）
- 升級 Nuxt 官方模組：`@nuxt/eslint`、`@nuxt/fonts`、`@nuxt/icon`、`@nuxtjs/i18n`、`@nuxtjs/color-mode`
- 升級第三方 Nuxt 模組：`@element-plus/nuxt`、`@pinia/nuxt`、`@vueuse/motion`
- 升級 Vue 生態核心：`vue`、`vue-router`（注意 Nuxt 4.4 已內建升級至 Vue Router v5，會移除 `unplugin-vue-router` 依賴）
- 升級主要 runtime / UI 函式庫：`element-plus`、`pinia`
- 升級型別與工具相依：`@types/node`、`sass`、`pug`、`@vue/language-plugin-pug` 等（隨依賴需求調整）
- 同步調整 `nuxt.config.ts` 的 `compatibilityDate`（必要時推進到新日期）以對齊新版預設行為
- **保守策略**：若任一套件升級後出現無法在合理工時內修復的 breaking change，該套件回退到「能編譯通過 + 通過回歸測試」的最小可行版本，並在 `tasks.md` 中記錄降版理由
- **不適用項目**：本專案無資料庫（無 Prisma schema、無 migrations 目錄），原需求中提到的「資料結構自動同步與修復」議題與本次升級無關，已與使用者確認跳過

## Capabilities

### New Capabilities

- `nuxt-platform-version`: 定義專案 Nuxt 平台與相依套件的版本基線、升級流程、回歸測試門檻與降版策略，作為本次與未來版本維護的單一事實來源

### Modified Capabilities

（無；本次為新基線建立，未修改現有 spec 的需求）

## Impact

- **依賴清單**：`package.json` 與 `package-lock.json` 大量套件版本變動
- **設定檔**：`nuxt.config.ts` 可能需更新 `compatibilityDate`、確認 `i18n`、`elementPlus`、`icon`、`colorMode` 設定的型別與行為相容
- **型別系統**：`.nuxt/` 自動產生型別會重建，可能暴露原本被舊型別容忍的隱性錯誤
- **路由系統**：Vue Router v5 與 unrouting 會改變 dev HMR 行為，需驗證動態路由、巢狀路由、國際化前綴策略 (`prefix_except_default`) 是否仍正常
- **i18n**：`@nuxtjs/i18n` v10 → 更新版的 `detectBrowserLanguage`、`redirectOn` 行為需重新驗證
- **Element Plus**：版本更新可能影響 SCSS 主題注入與 `:deep()` 覆寫
- **建置產物**：`npm run build` 與 `npm run lint` 必須通過
- **功能驗證**：需透過 Playwright MCP 對核心使用者旅程做完整回歸測試（首頁載入、路由跳轉、語系切換、彈窗系統、表單驗證、權限檢查、RWD、主題切換）
- **無資料庫副作用**：本次升級不會影響任何持久化資料，亦不需要測試站/正式站的資料同步流程
