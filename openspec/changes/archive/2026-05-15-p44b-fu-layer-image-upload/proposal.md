# 2026-05-15 — P44b-FU：Richmenu 圖層合成器自訂圖片上傳

> **狀態**：Brain AI 反饋「選完範本後只有色塊可選，不能對單一區塊給底圖」— P44b 簡化 scope 留尾的補完版。
> **規模**：~0.4 工作天 / 3 Phase。

## Why

P44b 上 prod 後實測，admin 反饋：

1. **5 個範本只用 rectangle / text 圖層** — 視覺單調（純色塊 + 標籤），無法呈現品牌風格
2. **Inspector「圖片屬性」區塊已有 imageUrl 欄位，但只能貼外部 URL** — admin 不會手動架圖床，缺實用價值
3. **既有「+ 色塊 / + 文字」兩按鈕不夠** — 缺「+ 圖片」入口，admin 看不到怎麼加圖
4. **P44b spec 簡化 scope 明確留尾**：「不支援自訂 image upload 圖層（避免 Storage 新 endpoint 風險）— admin 反饋後再開」

現在 admin 反饋來了，補上。

## What Changes

### 1. 新 endpoint：`POST /admin/line-richmenus/[id]/upload-layer-image`

- 接 multipart `file`：PNG / JPEG / WebP，≤ 2 MB
- 存 Storage 路徑：`line-richmenus/{channel}/{id}/layers/{timestamp}.{ext}`
- 回 signed URL（1 年效期，與既有 image 同策略）
- 權限：canBroadcast
- audit log：`line.richmenu.update` payload `{ fields: ['layer-image'], bytes, mime }`
- 不驗 2500×1686 / 2500×843（layer 圖會被 canvas 縮放）
- 不寫回 doc（layer.imageUrl 由 client 拿到 URL 後在前端 patchLayer 設）

### 2. Composer UI：「+ 圖片」按鈕

`RichmenuComposer.vue` sidebar 加第三個按鈕「+ 圖片」：
- 觸發 file picker（隱藏 `<input type="file">`）
- 選檔後 upload → 拿 URL → `addLayer({ type: 'image', imageUrl, imageFit: 'cover' })`
- 顯示 uploading 狀態
- 上傳失敗 ElMessage

### 3. Inspector：圖片屬性區塊加「上傳檔案」按鈕

當選中 image layer 時，inspector 既有 `imageUrl` text input 旁加「📁 上傳替換」按鈕：
- 觸發 file picker
- 上傳後直接 patchLayer({ imageUrl: 新 URL })

### 4. 不改範本（5 個範本仍維持 rectangle + text）

範本內**不預先加 image layer**（保持簡單，admin 想加圖就用「+ 圖片」按鈕）。

## Out of Scope

- ❌ **改 5 個範本加 image 預設圖層**：之後依使用反饋再決定
- ❌ **layer image 多選批次上傳**：第一版單檔上傳
- ❌ **拖拉到 canvas 上傳**：第一版只走按鈕 file picker
- ❌ **image crop / 旋轉編輯**：直接用 imageFit cover/contain/fill 處理
- ❌ **舊圖清理機制**：第一版上傳後不清 storage 上的舊圖（admin 換圖後舊圖留著；P44b-FU2 視 Storage 量再決定要不要做）

## 3 個關鍵決策

| Q | 選項 | 預設 |
|---|---|---|
| Q1 size limit | A) 2 MB / B) 1 MB（同 menu 圖） / C) 5 MB | **A 2 MB** — layer 圖容許比 menu 圖大（會縮放） |
| Q2 mime 支援 | A) PNG / JPEG / B) +WebP / C) +SVG | **B** — WebP 對 logo / icon 省 30-60% |
| Q3 Storage 路徑 | A) `line-richmenus/{channel}/{id}/layers/{ts}.ext` 與 menu 圖 sibling / B) 新 collection `richmenu_layer_images/...` | **A** — 與既有 menu 圖同 namespace 易管 |

## Impact

### 影響範圍

- **新增 1 endpoint**：`server/routes/nuxt-api/admin/line-richmenus/[id]/upload-layer-image.post.ts`
- **新增 1 protocol method**：`UploadLineRichmenuLayerImage(id, file)` → 加進 admin/line-richmenu/index.ts
- **改動 RichmenuComposer.vue**：
  - sidebar 加「+ 圖片」按鈕 + hidden file input
  - Inspector image 區塊加「📁 上傳替換」按鈕 + hidden file input
  - Uploading state ref
- **無 firestore schema 變動**：layer.imageUrl field 已存在
- **無 firestore rules 變動**：Storage rules（如有）需確認允許 admin 寫；line-richmenus storage path 已有規則涵蓋
- **無 indexes 變動**

### 風險

| 風險 | 緩解 |
|---|---|
| Storage 越疊越多舊圖 | 第一版不清；未來 cron job 掃孤兒檔案 |
| Admin 上傳大圖 + 大量 layer → canvas 合成爆記憶體 | client canvas API 在 2500×1686 + 10 layer × 2MB 圖在 desktop Chrome 實測沒問題；極端情況 admin 自負 |
| Signed URL 1 年後失效 → menu 圖層失效 | 與 menu 圖同問題；同樣留 P50+ backlog（refresh / 永久 token） |
| TinyEditor announcement / template cover 上傳也是同模式 | 已驗證可行，本 endpoint 結構複用既有 [id]/upload-image.post.ts 模板 |

### 估時

| Phase | 內容 | 估時 |
|---|---|---|
| **Phase 0** | spec | 0.05d |
| **Phase 1** | server endpoint + protocol method | 0.15d |
| **Phase 2** | Composer UI + Inspector 上傳 | 0.15d |
| **Phase 3** | build + push | 0.05d |
| **總計** | | **~0.4 工作天** |

## Brain AI 拍板紀錄

**指令**：直接做完。Q1-Q3 全用推 spec 預設。

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | A | 2 MB size limit |
| Q2 | B | PNG / JPEG / WebP |
| Q3 | A | Storage 路徑與 menu 圖 sibling |
