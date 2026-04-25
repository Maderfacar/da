## ADDED Requirements

### Requirement: 富文本編輯器組件

系統 SHALL 提供可重用的 Vue 3 富文本編輯器組件 `TinyEditor.vue`（位於 `app/components/`），基於 TinyMCE 8 self-hosted 與 `@tinymce/tinymce-vue` 官方 wrapper 實作，支援 `v-model` 雙向綁定 HTML 字串。

#### Scenario: 以 v-model 綁定 HTML 內容

- **WHEN** 呼叫端以 `<TinyEditor v-model="content" />` 使用組件
- **THEN** 編輯器內容變動時 `content` ref 同步更新為最新 HTML 字串
- **AND** 外部變更 `content` 時編輯器內容隨之更新

#### Scenario: 覆寫預設 init 配置

- **WHEN** 呼叫端傳入 prop `:init-overrides="{ height: 800, plugins: 'lists link' }"`
- **THEN** 組件最終傳給 TinyMCE 的 init 物件為預設配置與 overrides 合併結果（overrides 優先）

#### Scenario: 禁用狀態

- **WHEN** 呼叫端傳入 prop `:disabled="true"`
- **THEN** 編輯器進入唯讀狀態，工具列按鈕失效，內容不可編輯

#### Scenario: 組件於 SSR 環境不崩潰

- **WHEN** Nuxt 進行 SSR 渲染該組件所在頁面
- **THEN** 伺服器端不存取 `window`/`document`，回傳 placeholder 標記（如 `<ClientOnly>` fallback）
- **AND** client 端 hydration 後編輯器正常掛載並初始化

### Requirement: 工具列功能集

編輯器預設工具列 SHALL 包含以下分組功能，透過 TinyMCE 對應 plugin 實現：

- 字型（font family）、字體大小（font size）
- 文字顏色（forecolor）、背景顏色（backcolor）
- 粗體、斜體、底線、刪除線
- 對齊（左 / 中 / 右 / 兩端）
- 縮排（indent）、凸排（outdent）
- 清單（有序、無序）
- 連結（link 插入/編輯）
- 圖片（image 插入、上傳）
- 清除格式（removeformat）
- 復原 / 重做（undo / redo）
- 原始碼檢視（code）

#### Scenario: 使用者套用粗體

- **WHEN** 使用者選取文字後點擊工具列「粗體」按鈕
- **THEN** 選取文字包裹為 `<strong>` 標籤，v-model 更新後的 HTML 含該標籤

#### Scenario: 使用者變更字型

- **WHEN** 使用者選取文字後從字型下拉選單選擇特定字型
- **THEN** 選取文字以內聯樣式或對應元素套用該字型，v-model 同步更新

#### Scenario: 使用者變更文字顏色

- **WHEN** 使用者選取文字後從 forecolor 色盤選擇特定顏色
- **THEN** 選取文字以該顏色套用，HTML 中出現對應 `color` 樣式

#### Scenario: 使用者套用有序清單

- **WHEN** 使用者選取多行文字後點擊「有序清單」
- **THEN** 選取文字包裹為 `<ol><li>...</li></ol>` 結構

#### Scenario: 使用者開啟原始碼檢視

- **WHEN** 使用者點擊工具列「原始碼」按鈕
- **THEN** 開啟對話框顯示當前編輯器內容的 HTML 原始碼，可直接修改並套用回編輯器

### Requirement: 圖片上傳整合

編輯器圖片按鈕 SHALL 支援使用者從本機選擇圖片上傳，並透過預留的 API 端點 `/nuxt-api/tinymce/upload` 取得圖片 URL 後插入編輯器。

#### Scenario: 使用者成功上傳圖片

- **WHEN** 使用者點擊圖片按鈕選擇本機圖片並確認
- **THEN** 前端透過 `images_upload_handler` 以 `multipart/form-data` POST 至 `/nuxt-api/tinymce/upload`
- **AND** API 回應成功（`status.code === success`）並帶有 `data.url`
- **AND** 編輯器於游標位置插入 `<img src="{回傳url}">` 標籤，v-model 同步更新

#### Scenario: API 回傳錯誤

- **WHEN** 使用者上傳圖片但 API 回應失敗（`status.code !== success`）
- **THEN** handler reject Promise 並夾帶 `message` 與 `remove: true`
- **AND** TinyMCE 顯示錯誤提示，暫存的圖片節點不被插入/被移除

#### Scenario: 網路錯誤

- **WHEN** 上傳過程中網路中斷或 API 回應 5xx
- **THEN** handler reject Promise 並顯示錯誤提示，編輯器維持原狀

### Requirement: 圖片上傳 API 骨架

後端 SHALL 提供路由 `server/routes/nuxt-api/tinymce/upload.post.ts`，接受 `multipart/form-data` 上傳，回傳統一響應格式 `{ data: { url: string }, status: { code, message: { zh_tw, en, ja } } }`。

**注意**：本次為骨架實作，不處理實際檔案儲存；API 收到檔案後回傳佔位 URL（如 `https://placeholder.example/{uuid}.{ext}`）以供前端整合測試。

#### Scenario: 上傳圖片骨架呼叫

- **WHEN** 前端 POST `/nuxt-api/tinymce/upload` 夾帶有效圖片檔案欄位
- **THEN** 端點以 `successResponse` 回傳 `{ data: { url: "<placeholder url>" }, status: { code, message: {...} } }`

#### Scenario: 缺少檔案欄位

- **WHEN** 前端 POST 至該端點但未提供檔案
- **THEN** 端點以 `badRequestError` 回傳錯誤（三語言錯誤訊息），不 throw

### Requirement: Demo 頁面

系統 SHALL 提供路徑 `/demo/tinymce-editor` 的 Demo 頁面，展示編輯器使用方式與即時預覽能力。

#### Scenario: 左右分欄佈局

- **WHEN** 使用者訪問 `/demo/tinymce-editor`
- **THEN** 頁面左半顯示 `TinyEditor` 組件、右半顯示即時預覽區塊
- **AND** RWD 行動裝置下改為上下堆疊

#### Scenario: 編輯器變更即時反映至預覽

- **WHEN** 使用者於編輯器輸入或套用格式
- **THEN** 右側預覽區塊即時以 `v-html` 渲染最新 HTML 內容

#### Scenario: 從首頁導航至 Demo

- **WHEN** 使用者在 `app/pages/index.vue` 點擊「TinyMCE Demo」連結
- **THEN** 路由導航至 `/demo/tinymce-editor`

### Requirement: 集中式配置檔

系統 SHALL 提供 `app/utils/tinymce-config.ts`，集中匯出 TinyMCE 預設配置（plugins、toolbar、menubar、height、content_style、base_url、suffix），供 `TinyEditor.vue` 使用。

#### Scenario: 升級調整配置

- **WHEN** 開發者需調整 plugins 或 toolbar
- **THEN** 僅需修改 `tinymce-config.ts`，所有使用 `TinyEditor.vue` 的頁面自動套用新配置

#### Scenario: 資源路徑集中管理

- **WHEN** TinyMCE 升級後資源路徑或 suffix 有變
- **THEN** 僅需調整 `tinymce-config.ts` 中的 `base_url` 與 `suffix` 常數

### Requirement: 靜態資源分發

系統 SHALL 透過 npm postinstall 流程，自動從 `node_modules/tinymce/` 複製所需資源至 `public/tinymce/`，資源路徑 `/tinymce/tinymce.min.js` 可於 runtime 被瀏覽器載入。

#### Scenario: 安裝依賴時自動複製

- **WHEN** 執行 `npm install`
- **THEN** postinstall 階段將 TinyMCE 的 `tinymce.min.js`、`skins/`、`themes/`、`icons/`、`plugins/`、`models/`、`LICENSE.TXT` 複製至 `public/tinymce/`

#### Scenario: public 資源不納入 git

- **WHEN** 開發者執行 `git status`
- **THEN** `public/tinymce/` 已被 `.gitignore` 排除，不會被誤 commit

#### Scenario: build 產物包含資源

- **WHEN** 執行 `npm run build`
- **THEN** 輸出的 Nuxt build 產物包含 `public/tinymce/` 所有檔案，可供 runtime 載入

### Requirement: SSR 安全性

系統 SHALL 保證 TinyMCE 相關程式碼於 Nuxt SSR 階段不存取瀏覽器專屬 API（`window`、`document`、`navigator`），避免 build 或請求時崩潰。

#### Scenario: Nuxt dev 伺服器啟動

- **WHEN** 執行 `npm run dev` 並訪問包含 `TinyEditor` 的頁面
- **THEN** 伺服器不拋出 `window is not defined` 等 SSR 錯誤
- **AND** 頁面正常渲染並於 client 端掛載編輯器

#### Scenario: 生產 build

- **WHEN** 執行 `npm run build`
- **THEN** build 流程成功完成，不出現 SSR 相關錯誤

### Requirement: GPLv2 授權聲明

系統 SHALL 於 `README.md` 標註 TinyMCE 採 GPLv2 授權，並透過 `licenseKey: 'gpl'` 向 TinyMCE 宣告，保留原始 `LICENSE.TXT` 於分發產物中。

#### Scenario: Editor 無授權警告

- **WHEN** TinyMCE 初始化
- **THEN** 因 `licenseKey: 'gpl'` 設定，編輯器不顯示評估版或未授權警告標誌

#### Scenario: README 標註授權

- **WHEN** 使用者檢視專案 README
- **THEN** 可找到 Third-party Licenses 區塊列出 TinyMCE GPLv2

### Requirement: 未來升級預留

系統 SHALL 設計易於升級的架構：TinyMCE 版本資訊、plugins 清單、工具列配置、資源路徑皆集中於 `tinymce-config.ts`；`package.json` 以 `^8.0.0` 鎖定主版本；升級流程僅需 `npm update tinymce @tinymce/tinymce-vue` 與執行 postinstall。

#### Scenario: 小版本升級

- **WHEN** 開發者執行 `npm update tinymce`
- **THEN** 新版本自動複製至 `public/tinymce/`，Demo 頁面功能不受影響

#### Scenario: 主版本升級（8.x → 9.x）

- **WHEN** 開發者刻意升級主版本
- **THEN** 僅需同步調整 `@tinymce/tinymce-vue` 版本與 `tinymce-config.ts` 中因 breaking change 而變動的選項，不需修改組件使用端
