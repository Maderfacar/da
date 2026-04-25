## Context

本專案為 Nuxt 4 + Vue 3 + TypeScript SSR 應用，尚未具備富文本編輯能力。TinyMCE 8 是純瀏覽器執行的 WYSIWYG 編輯器，直接引入會因存取 `window`/`document` 在 SSR 階段崩潰。本設計需處理：SSR 安全掛載、靜態資源（skins/icons/plugins）分發、Vue 3 整合、後端 API 串接、未來版本升級成本。

**現有架構約束**：
- 全域組件自動註冊於 `app/components/`（`nuxt.config.ts` 已設定）
- 自動匯入 utils（`app/utils/`）
- 後端統一響應格式：`{ data, status: { code, message: { zh_tw, en, ja } } }`
- 前端 API 呼叫透過 `$api` 全局工具，錯誤以 `return` 處理

## Goals / Non-Goals

**Goals**：
- TinyMCE 8 self-hosted 可在 Nuxt 4 dev/build/SSR 環境正常運作
- 提供可重用的 `TinyEditor.vue` 組件（v-model、props 可擴充）
- Demo 頁面驗證基本工具列、圖片上傳、即時預覽
- 集中式配置（`tinymce-config.ts`）降低未來升級成本
- 圖片上傳串接專案統一響應格式的 API 骨架

**Non-Goals**：
- 不實作圖片實體儲存（API 僅回傳 placeholder URL）
- 不做 TinyMCE 工具列 i18n 切換（使用者確認不需）
- 不支援多編輯器實例跨頁共享狀態
- 不處理檔案上傳（非圖片）、不支援 `files_upload_handler`
- 不整合付費 Premium plugins（如 PowerPaste、AI Assistant）

## Decisions

### 決策 1：使用 `@tinymce/tinymce-vue` 官方 wrapper + self-hosted tinymce

**選擇**：同時安裝 `tinymce@^8` 與 `@tinymce/tinymce-vue@^6`（支援 Vue 3 + TinyMCE 8），以 `licenseKey="gpl"` 聲明 GPLv2 授權、`tinymceScriptSrc` 指向 `public/tinymce/tinymce.min.js` 自託管資源。

**替代方案**：
- 直接使用 `tinymce` 原生 API + 自寫 composable（`useTinymce`）：彈性最大但維護成本高、升級時得自行追隨 wrapper 改動
- Cloud 版（需 API Key）：授權風險低但需網路、資源非自託管

**理由**：官方 wrapper 已處理 Vue 3 生命週期、reactive binding、事件轉發；self-hosted 滿足「免費開源 GPLv2」與「不依賴網路」需求。升級 TinyMCE 8.x → 9.x 時只需同步 wrapper 大版號。

### 決策 2：SSR 安全策略 — `<ClientOnly>` + `tinymceScriptSrc` 延遲載入

**選擇**：
- `TinyEditor.vue` 內部對 Editor 組件套 `<ClientOnly>`，fallback 顯示 loading 或空 textarea
- 不在 top-level import `tinymce` 本體（僅 import wrapper 的 Editor 組件；Editor 內部會等 DOM 就緒才插入 `<script>`）

**替代方案**：
- `.client.vue` 後綴：整個組件只在 client 執行，但 SSR 會完全跳過，對 hydration 不友善
- 動態 `import()` 在 `onMounted`：可行但需手寫 loading 狀態、與 wrapper 重複

**理由**：`<ClientOnly>` 是 Nuxt 官方 SSR 規避模式；搭配 `tinymceScriptSrc` 以 `<script>` 標籤延遲載入本體，確保 bundle 不包含 tinymce 核心 JS，首屏更輕量。

### 決策 3：靜態資源分發 — postinstall 複製到 `public/tinymce/`

**選擇**：新增 npm script `postinstall:tinymce`（或擴充現有 `postinstall`），以 Node.js `fs.cp` 從 `node_modules/tinymce/` 複製以下目錄至 `public/tinymce/`：
- `tinymce.min.js`、`tinymce.js`
- `skins/`、`themes/`、`icons/`、`plugins/`、`models/`
- `langs/`（預留未來啟用 i18n 工具列用）

**替代方案**：
- `vite-plugin-static-copy`：需額外套件且僅在 build 期執行，dev 環境需額外處理
- Git commit `public/tinymce/`：版本控管肥大、升級時需手動更新
- 動態 CDN：違反 self-hosted 需求

**理由**：postinstall 方式無需新增 build 工具鏈、資源與 `node_modules/tinymce` 版本自動同步、`public/tinymce/` 放入 `.gitignore`。升級只需 `npm install`。

### 決策 4：集中式配置 `app/utils/tinymce-config.ts`

**選擇**：匯出兩個物件：
```ts
export const tinymceDefaultConfig = { /* plugins, toolbar, menubar, height, ... */ };
export const tinymceBaseUrl = '/tinymce'; // 與 public/tinymce/ 對應
```

組件透過 props 允許呼叫端覆寫 `initOverrides`，最終以 `{ ...tinymceDefaultConfig, ...props.initOverrides }` 傳入 Editor。

**理由**：未來 TinyMCE 升級或業務方需求變動（加/減 plugin、換 toolbar）只動一個檔案，組件使用者無感。

### 決策 5：圖片上傳橋接 — `images_upload_handler` 轉換層

**選擇**：實作 `images_upload_handler(blobInfo, progress)`，內部呼叫 `$api.ApiTinymceUpload()`（POST `/nuxt-api/tinymce/upload`），API 回應 `{ data: { url }, status }`，handler 將 `data.url` 以 `resolve({ url, fileName })` 回傳 TinyMCE。

**替代方案**：
- `images_upload_url`：直接讓 TinyMCE 自動 POST，但 TinyMCE 預期回應格式為 `{ location: "..." }`，與專案統一響應格式 `{ data, status }` 不相容
- 改造 API 回應為 TinyMCE 原生格式：違反專案既有慣例

**理由**：在前端 handler 做轉換，後端保持統一格式；同時 handler 可讀取 `status.code` 做錯誤處理、觸發 `UseAsk` 或 `ElMessage`。

### 決策 6：Demo 頁面即時預覽 — `v-html` 直接渲染

**選擇**：Demo 頁面持有 `const content = ref('')`，`<TinyEditor v-model="content" />` 綁定，右側 `<div class="preview" v-html="content" />`。

**理由**：使用者明確要求「直接渲染 HTML」；TinyMCE 本身有輸出清理機制，風險可控。在 Demo 註解警示 `v-html` 於正式業務使用時需搭配後端 sanitize（如 DOMPurify 或 server-side 白名單）。

### 決策 7：授權聲明

**選擇**：
- 於 `README.md` 新增「Third-party Licenses」區塊標註 TinyMCE GPLv2
- `TinyEditor.vue` 內 `licenseKey: 'gpl'` 明示聲明
- 保留 `node_modules/tinymce/LICENSE.TXT` 原始檔（透過 postinstall 複製至 `public/tinymce/LICENSE.TXT`）

## Risks / Trade-offs

**[風險 1] SSR hydration mismatch**
→ **緩解**：`<ClientOnly>` 完全跳過 SSR 輸出；server 端回傳空 placeholder，client 掛載後才注入編輯器，不做 hydration 比對

**[風險 2] postinstall 腳本跨平台失敗（Windows/Mac/Linux）**
→ **緩解**：使用 Node.js `fs.cp` API（Node ≥ 22 內建，本專案 engines 為 ≥ 24.13.0），避開 shell 指令差異

**[風險 3] TinyMCE 8 版本被 breaking change（8.x 次版升級）**
→ **緩解**：`package.json` 固定 `tinymce: ^8.0.0`（只允許 minor/patch）；集中配置檔隔離；升級由開發者主動 `npm update` 觸發

**[風險 4] GPLv2 copyleft 觸及專案授權**
→ **緩解**：proposal 已評估（SaaS/內部使用不觸發）；README 記載；若未來需商業分發需評估切換替代方案

**[風險 5] `v-html` 於 Demo 的 XSS 風險**
→ **緩解**：Demo 頁註解標示此為展示用途；正式業務使用編輯器產物時需額外 sanitize

**[風險 6] public 資源體積（約 2–3 MB）影響 CI/部署時間**
→ **緩解**：`.gitignore` 排除 `public/tinymce/`；Docker build 的 `npm install` 階段自動重建；CDN 快取 `static/` 路徑

**[風險 7] `@tinymce/tinymce-vue` wrapper 若跟不上 Vue 或 Nuxt 版本**
→ **緩解**：本 wrapper 為官方維護、相容 Vue 3.x；備案為改寫為自訂 composable（約 80–100 行），風險低

## Migration Plan

本次為新增能力，無既有資料遷移需求。部署步驟：

1. `npm install` 觸發 postinstall 腳本，自動複製 TinyMCE 資源至 `public/tinymce/`
2. `npm run build` 驗證 Nuxt 4 build 成功（無 SSR 錯誤）
3. `npm run preview` 於本地驗證 Demo 頁面與圖片上傳 API 骨架
4. 部署後實地操作 Demo 頁驗收

**回滾策略**：移除 `tinymce`、`@tinymce/tinymce-vue` 依賴、刪除 `TinyEditor.vue`、`pages/demo/tinymce-editor.vue`、`server/routes/nuxt-api/tinymce/*`、`app/utils/tinymce-config.ts`、postinstall 腳本；既有功能不受影響。

## Open Questions

- [ ] Demo 頁面是否需加入「清空內容」、「載入範例內容」按鈕？（建議：加入以利驗收測試）
- [ ] 圖片上傳 API 骨架是否需驗證檔案大小/類型？（建議：骨架先預留參數，實作時再補）
- [ ] 是否需為 `TinyEditor.vue` 加入 disabled / readonly props？（建議：一次實作完整以避免後續二次開發）
