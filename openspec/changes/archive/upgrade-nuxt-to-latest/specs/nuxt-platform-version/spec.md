## ADDED Requirements

### Requirement: Nuxt 核心版本基線

專案 SHALL 使用 Nuxt 4.x 系列的最新穩定版本作為框架核心，並由 `package.json` 的 `dependencies.nuxt` 欄位明確宣告。版本號 SHALL 採用 caret range（`^4.x.y`）以允許 patch 更新但禁止跨 minor 自動升級。

#### Scenario: 安裝後 Nuxt 為最新 4.x 穩定版

- **WHEN** 開發者執行 `npm install` 後檢查 `node_modules/nuxt/package.json`
- **THEN** 安裝的 Nuxt 版本 MUST 屬於官方 GitHub releases 中當前最新的 4.x 穩定版（4.4.x 或更高的 4.x minor），且 NOT 為 alpha / beta / rc / nightly 標記版本

#### Scenario: 不允許跨大版本自動升級

- **WHEN** 開發者執行 `npm install` 而無 `--legacy-peer-deps` 旗標
- **THEN** Nuxt 版本 MUST 維持在 4.x 系列，MUST NOT 自動升級到 Nuxt 5.x

### Requirement: Vue 生態與 Nuxt 相容

`vue`、`vue-router` 版本 SHALL 與所選 Nuxt 版本官方標示的相容範圍一致。當 Nuxt 4.4 已內建升級至 Vue Router v5 時，`vue-router` 版本 MUST 對齊此要求。

#### Scenario: vue-router 對齊 Nuxt 內建版本

- **WHEN** Nuxt 版本為 4.4.x 或以上
- **THEN** `package.json` 中 `vue-router` 的 caret range MUST 涵蓋 Nuxt 內建相容的 vue-router 版本，且執行 `npm ls vue-router` MUST NOT 報告 peer dependency 衝突

#### Scenario: vue 與 nuxt 無 peer 衝突

- **WHEN** 開發者執行 `npm install`
- **THEN** stdout MUST NOT 出現 `ERESOLVE` 或 `peer dep` 衝突訊息（warning 可接受，error 不可）

### Requirement: 模組生態同步升級

下列 Nuxt 模組與 UI 函式庫 SHALL 與 Nuxt 核心保持版本相容：`@nuxt/eslint`、`@nuxt/fonts`、`@nuxt/icon`、`@nuxtjs/i18n`、`@nuxtjs/color-mode`、`@element-plus/nuxt`、`element-plus`、`@pinia/nuxt`、`pinia`、`@vueuse/motion`。每個模組 SHALL 升級到能與所選 Nuxt 版本共存的最新穩定版。

#### Scenario: element-plus 與 @element-plus/nuxt 配對

- **WHEN** `@element-plus/nuxt` 升級到新版
- **THEN** `element-plus` MUST 同步升級到該模組 README / peer dependencies 標示的相容範圍內

#### Scenario: pinia 與 @pinia/nuxt 配對

- **WHEN** `@pinia/nuxt` 升級
- **THEN** `pinia` MUST 同步升級到相容版本，且 `app/stores/` 下所有 store 在 dev server 啟動時 MUST 不丟出 `[Pinia]` 警告

### Requirement: 升級後建置與檢查通過

升級任何套件版本後，執行 `npm run lint` 與 `npm run build` 都 SHALL 成功（exit code 0），且 build 產物 SHALL 包含完整的 SSR/SSG 輸出。

#### Scenario: lint 通過

- **WHEN** 升級完成後執行 `npm run lint`
- **THEN** exit code MUST 為 0，且 stdout/stderr MUST NOT 包含 `error` 級別訊息

#### Scenario: build 通過

- **WHEN** 升級完成後執行 `npm run build`
- **THEN** exit code MUST 為 0
- **AND** `.output/` 目錄 MUST 被產生
- **AND** build log MUST NOT 出現 `[error]` 或 `Error:` 區塊

### Requirement: nuxt.config.ts 行為相容

升級後，`nuxt.config.ts` 中已配置的下列功能 SHALL 保持原有行為：i18n `prefix_except_default` 路由策略、Element Plus SCSS 主題注入、`@nuxt/icon` 自訂集合 `my-icon`、Pug 模板支援、SCSS 全域 mixin/variable 自動注入、ColorMode `classSuffix: ''`。

#### Scenario: i18n 路由前綴策略不變

- **WHEN** 開發者於 dev 環境訪問 `/`
- **THEN** 頁面 MUST 渲染預設語系 (zh) 內容且 URL 不含 `/zh` 前綴
- **AND** 訪問 `/en` 與 `/ja` MUST 分別渲染對應語系

#### Scenario: Element Plus SCSS 主題注入有效

- **WHEN** 任一頁面引用 Element Plus 元件
- **THEN** 元件 MUST 正確套用 SCSS 主題（顏色、字體、間距視覺一致），且 `:deep()` 樣式覆寫 MUST 仍生效

#### Scenario: 自訂圖示集合可用

- **WHEN** 任一元件使用 `<NuxtIcon name="my-icon:xxx" />`
- **THEN** 圖示 MUST 正確渲染，且 build 階段 MUST 將其納入 client bundle scan 結果

### Requirement: 完整回歸測試通過

升級完成後 SHALL 透過 Playwright MCP 對核心使用者旅程執行完整回歸測試，所有測試步驟 MUST 通過且 MUST NOT 在瀏覽器 console 觀察到任何 `[Vue warn]: Hydration` 或 `[Vue warn]: Failed to resolve component` 訊息。

#### Scenario: 首頁載入無 hydration error

- **WHEN** Playwright 啟動 dev server 並導向 `/`
- **THEN** `browser_console_messages` 結果 MUST NOT 包含 `Hydration` 警告或 `error` 級別訊息

#### Scenario: 三語系切換正確

- **WHEN** Playwright 依序訪問 `/`、`/en`、`/ja`
- **THEN** 每個 URL 渲染的內容 MUST 對應正確語系，且 `<html lang>` 屬性 MUST 與該語系一致

#### Scenario: 業務彈窗系統可用

- **WHEN** Playwright 觸發任一 `OpenDialog*` 業務彈窗的開啟操作
- **THEN** 彈窗 MUST 正確渲染，且關閉操作 MUST 觸發 `StoreOpen` 的 `OnClose` 流程

#### Scenario: Element Plus 表單元件正常

- **WHEN** Playwright 在表單頁填寫 `ElInput`、選擇 `ElSelect` 並觸發提交
- **THEN** `ElInput` 的 `maxlength` 與 `inputmode` 行為 MUST 正確，`ElSelect` 的 `clearable` + `value-on-clear` 行為 MUST 正確

#### Scenario: API 請求與 401 重導

- **WHEN** Playwright 觸發一個未授權的 `$api.*` 呼叫
- **THEN** 系統 MUST 攔截 401 並自動跳轉到登入頁

#### Scenario: 主題切換生效

- **WHEN** Playwright 觸發 color-mode 切換
- **THEN** `<html>` 上的 class 屬性 MUST 同步更新，且 SCSS 變數對應的視覺樣式 MUST 立即改變

#### Scenario: RWD 響應式

- **WHEN** Playwright 用 `browser_resize` 將視窗從桌面寬度縮小到行動寬度
- **THEN** `StoreTool` 的 RWD 偵測值 MUST 正確切換，且頁面布局 MUST 套用對應的響應式樣式

### Requirement: 保守降版策略

若某套件升級後在合理工時內無法修復 breaking change，該套件 SHALL 被降回能與 Nuxt 4.4.x 共存且通過所有驗收測試的最高版本。降版決策 SHALL 在 `tasks.md` 留下原因紀錄。

#### Scenario: 降版有書面理由

- **WHEN** 任一套件最終版本低於該套件當前最新穩定版
- **THEN** `tasks.md` MUST 包含一個項目記錄該套件名稱、目標版本、實際版本、降版原因

#### Scenario: 降版後仍通過驗收

- **WHEN** 任一套件被降版
- **THEN** 降版後重跑 `npm run lint`、`npm run build` 與 Playwright 完整回歸測試 MUST 全部通過

### Requirement: compatibilityDate 維持原值

本次升級 SHALL NOT 變動 `nuxt.config.ts` 中的 `compatibilityDate` 欄位，除非升級後 Nuxt 在啟動時明確警告 `compatibilityDate` 過舊或某項所需新行為必須依賴新日期。任何 `compatibilityDate` 變更 SHALL 在 `tasks.md` 記錄理由。

#### Scenario: 預設情況不變動 compatibilityDate

- **WHEN** 升級完成後檢視 `nuxt.config.ts`
- **THEN** `compatibilityDate` MUST 仍為 `'2025-07-15'`，除非有明確記錄的變更理由
