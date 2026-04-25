## Why

目前專案缺少富文本編輯能力，無法處理需要 HTML 格式內容輸入的業務場景（公告、文章、產品描述等）。導入業界主流的 TinyMCE 8（self-hosted、GPLv2）作為富文本編輯器基礎元件，並透過 Demo 頁面驗證其在 Nuxt 4 SSR 環境下的相容性，同時預留圖片上傳 API 整合點，為後續業務模組提供可重用的編輯器能力。

## What Changes

- 新增 `tinymce` npm 套件（self-hosted，version ^8.x）與必要的 Nuxt 4 SSR-safe 客戶端掛載機制
- 新增富文本編輯器全局組件 `TinyEditor.vue`（位於 `app/components/`），以 `v-model` 雙向綁定 HTML 字串，支援 props 擴充
- 新增 Demo 頁面 `/demo/tinymce-editor`：左側編輯器、右側即時預覽（直接渲染 HTML）
- 在 `app/pages/index.vue` 加入導向 Demo 頁面的連結
- 預留圖片上傳 API `/nuxt-api/tinymce/upload`（server route 骨架 + 統一響應格式），編輯器圖片上傳按鈕已連線此路徑但先回傳佔位結果
- 加入 TinyMCE 靜態資源（skins、themes、icons、plugins）處理機制，確保 SSR build 不破且 public 路徑可被編輯器載入
- 工具列包含：字型（font family）、字體大小、顏色（文字/背景）、粗體/斜體/底線/刪除線、對齊（左/中/右/兩端）、縮排/凸排、清單（有序/無序）、連結、圖片上傳、清除格式、復原/重做、來源碼檢視

## Capabilities

### New Capabilities

- `rich-text-editor`: 提供可重用的富文本編輯器組件、Demo 驗證頁面、以及圖片上傳 API 骨架，涵蓋 TinyMCE 8 self-hosted 的 Nuxt 4 SSR 安全掛載、工具列配置、v-model 綁定、未來升級預留點

### Modified Capabilities

（無 — 本次為全新能力，不修改現有 spec）

## Impact

**程式碼層**：
- 新增套件：`tinymce` (dependency)
- 新增檔案：
  - `app/components/TinyEditor.vue`（全局自動導入）
  - `app/pages/demo/tinymce-editor.vue`
  - `server/routes/nuxt-api/tinymce/upload.post.ts`
  - `app/utils/tinymce-config.ts`（集中配置，便於未來升級）
- 修改檔案：`app/pages/index.vue`（加入 Demo 連結）
- 可能需修改：`nuxt.config.ts`（vite optimizeDeps、public 資源複製、SSR 排除設定）

**資源層**：
- TinyMCE 靜態資源（約 2–3 MB，含 skins/icons/plugins）需從 `node_modules/tinymce` 複製至 `public/tinymce/`，或透過 vite plugin 處理

**授權層**：
- 專案須保留 TinyMCE GPLv2 授權聲明，並在 README 或 NOTICE 中標註

**未來升級預留**：
- `app/utils/tinymce-config.ts` 集中管理 plugins、toolbar、資源路徑，升級時只動此檔
- 組件透過 props 允許呼叫端覆蓋工具列與 plugins 配置

**風險**：
- SSR 不相容：TinyMCE 為純瀏覽器套件，必須 client-only 渲染（`<ClientOnly>` 或動態 import）
- 靜態資源路徑：若未正確配置 `base_url` / `suffix`，skin/icon 會 404
