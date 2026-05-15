# HANDOFF — P44b-FU 圖層合成器自訂圖片上傳（2026-05-15）

v0.3.29。直接動手，Q1-Q3 全推 spec 預設。

## 觸發原因

Brain AI 反饋：「admin 編輯 richmenu 選擇圖層合成器時，選完樣本後，只有色塊可以選擇，不能針對單一區塊給底圖嗎？」

P44b 簡化 scope 明確留尾「不支援自訂 image upload 圖層 — admin 反饋後再開」，現在補完。

## 拍板（推 spec 預設）

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | A | 2 MB size limit（layer 圖容許比 menu 圖大，會縮放） |
| Q2 | B | PNG / JPEG / WebP（WebP 對 logo / icon 省 30-60%） |
| Q3 | A | Storage 路徑 `line-richmenus/{channel}/{id}/layers/{ts}.ext`（與 menu 圖 sibling） |

## 程式碼

### 新增（1）
- [server/routes/nuxt-api/admin/line-richmenus/[id]/upload-layer-image.post.ts](server/routes/nuxt-api/admin/line-richmenus/[id]/upload-layer-image.post.ts) — 新 endpoint，不驗 LINE menu 尺寸；只驗 PNG/JPEG/WebP + ≤ 2 MB；存 Storage `layers/` 子目錄；回 signed URL；audit log `line.richmenu.update` payload `fields=['layer-image']`

### 改動（2）
- [app/protocol/fetch-api/api/admin/line-richmenu/index.ts](app/protocol/fetch-api/api/admin/line-richmenu/index.ts) — 加 `UploadLineRichmenuLayerImage(id, file)` method + `UploadLineRichmenuLayerImageRes` type
- [app/components/admin/line-management/RichmenuComposer.vue](app/components/admin/line-management/RichmenuComposer.vue) —
  - sidebar 加「+ 圖片」按鈕（與「+ 色塊 / + 文字」並列）+ 隱藏 file input
  - Inspector 圖片屬性區塊加「📁 上傳替換」按鈕（位於既有 URL input 之上）
  - `uploadingLayerImage` ref + `_uploadLayerImageFile` 共用 helper
  - 兩個 handler：`OnAddImageChange`（新增 image layer）/ `OnReplaceImageChange`（替換選中 layer 的 imageUrl）
  - SCSS 加 `.RichmenuComposer__image-source`

### 不變
- canvas render image layer 完全沿用（既有 `drawImageWithFit` + `imageFit: cover/contain/fill`）
- 5 個範本不變（保持簡單，admin 自加圖層）
- doc schema 不變（layer.imageUrl 既有 field）
- firestore rules 不變
- composer 拖移 / 屬性編輯 / 合成上傳流程不變

## 部署狀態

✅ 無 firestore rules 變動
✅ 無 indexes 變動
✅ 無 Vercel env 變動
✅ Storage path `line-richmenus/{channel}/{id}/layers/{ts}.ext` 與既有 menu 圖規則涵蓋

## 真機驗收 checklist

1. /admin/settings → richmenu → 編輯 → 切「🎨 圖層合成器」tab
2. 選範本「2×2 grid + 標籤」 → 套用
3. 點 sidebar「+ 圖片」按鈕 → 跳出 file picker
4. 選一張 PNG / JPEG / WebP（≤ 2 MB）→ 上傳成功 ElMessage + canvas 出新 image layer
5. 拖移該 image layer 到底圖右上角
6. 改 imageFit 為 contain → preview 即時變化
7. 在 layer list 點該 image layer → Inspector 顯示「📁 上傳替換」按鈕
8. 點「📁 上傳替換」→ 選新圖 → patchLayer 替換 imageUrl
9. 上傳超 2 MB 的圖 → 警告
10. 上傳 SVG / GIF → 警告

## 留尾（非阻塞）
- 舊圖清理（admin 換圖後 Storage 上的舊檔不清）— Storage 量大才做 cron 掃
- image crop / 旋轉 UI — 用 imageFit cover/contain/fill 已夠
- 拖拉檔案到 canvas 上傳 — UX 加分但非必要
- 多檔批次上傳 — 同上
- 範本內預先加 image 圖層 — admin 反饋後再決定
