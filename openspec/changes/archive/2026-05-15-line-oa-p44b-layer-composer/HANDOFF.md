# HANDOFF — P44b Admin LINE Richmenu 圖層合成器（2026-05-15）

> 程式碼層完工 — Phase 0-3 全部綠並準備 push main。`pnpm lint` + `pnpm build` 皆通過。
> 真機手測由 Brain AI 視覺驗收。

## 實作摘要

| Phase | 內容 | 狀態 |
|---|---|---|
| 0 | openspec spec 三件套 + Brain AI 拍板 Q1-Q4 全用推 spec 預設（含簡化 scope） | ✅ |
| 1 | doc schema 加 layers / layersTemplate + validators + PATCH endpoint + protocol types | ✅ |
| 2 | 5 個範本 + composer composable + RichmenuComposer.vue + Edit.vue tab toggle + 合成上傳整合 | ✅ |
| 3 | build 驗證 + version bump + archive | ✅ |

## 拍板紀錄（design.md §11）

4 個 Q 全用推 spec 預設（2026-05-15「直接做完 / 預設即可」拍板）：

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | 1a | Client canvas（純前端，無 server-side 合成） |
| Q2 | 2b | line_richmenus doc 加 layers field（opt-in） |
| Q3 | （P44a）3b | drag + resize + snap + 多選 + alignment guide |
| Q4 | 4b | 5 個內建範本（不做 marketplace） |

實作期間簡化決策（spec design.md §11 已記）：
- **不支援自訂 image upload 圖層**（避免 Storage 新 endpoint 風險與 doc 1 MiB 上限）
- **canvas 互動簡化**：只 click + 拖移；resize / multi-select / marquee 由 P44a area editor 負責

## 部署狀態

✅ **無 firestore rules / indexes 變動**：layers 為 doc 內 array，既有 rule 允許 admin 寫即可
✅ **無 Vercel env 變動**：純 client canvas + 既有 upload-image endpoint
✅ **schema opt-in**：既有 line_richmenus doc 沒 layers field 不影響
⏳ **真機手測**（Brain AI 視覺驗收清單見下方）

## 程式碼總覽

### 新增（3 個）

- [app/utils/richmenu-templates.ts](app/utils/richmenu-templates.ts) — 5 個內建範本（grid-2x2-iconLabel / hero-plus-3 / header-plus-2x2 / compact-3btn(2500×843) / bg-plus-6grid）+ getTemplate / listTemplates / cloneTemplate helper
- [app/composables/use-richmenu-composer.ts](app/composables/use-richmenu-composer.ts) — 圖層合成器 composable
  - Layer CRUD：addLayer / removeLayer / duplicateLayer / moveLayerUp / moveLayerDown / patchLayer / selectLayer / applyTemplate
  - Canvas render：rectangle（含 radius / border）/ text（align + vAlign + font weight/family/size）/ image（cover/contain/fill）
  - Preview 自動 redraw（watch layers + imageSize → requestAnimationFrame coalesce）
  - composeBlob：hidden full-size canvas + document.fonts.ready + toBlob(PNG/JPEG) + 1MB 檢查
  - 拖移：preview canvas 內 pointer 互動（hit-test from top z-order）
- [app/components/admin/line-management/RichmenuComposer.vue](app/components/admin/line-management/RichmenuComposer.vue) — 主 UI
  - Header：範本下拉 + 套用 + 尺寸切換 + PNG/JPEG 選擇 + 「合成並上傳」按鈕
  - Sidebar：圖層 list（含 z-order ▲▼ / 複製 / 刪除 / type icon）+ 加色塊/文字按鈕
  - Stage：canvas preview（pointer 拖移）+ 選中 outline + 大小 hint
  - Inspector：type-aware 屬性編輯（共通 x/y/w/h/opacity + text 屬性 + rectangle 屬性 + image 屬性）

### 改動（4 個）

- [server/utils/line-richmenu-doc.ts](server/utils/line-richmenu-doc.ts)
  - 加 `RichmenuLayer` interface + `RichmenuLayerType`
  - `LineRichmenuDoc` 加 `layers?` / `layersTemplate?`
  - DTO `LineRichmenuDto` 同步加
  - `toRichmenuDto` 序列化加 layers / layersTemplate
  - 新 validators：`validateLayers(raw, size)` / `validateLayersTemplate(raw)`
  - 常數：`LAYERS_MAX = 50` / `LAYER_TEXT_MAX = 200` / `LAYER_TEMPLATE_KEY_MAX = 60`
- [server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts](server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts)
  - body 加 `layers?` / `layersTemplate?`
  - 接 validateLayers / validateLayersTemplate
  - audit log payload 加 `layersCount`
  - active richmenu 也允許改 layers（純 admin metadata，不影響 LINE）
- [app/protocol/fetch-api/api/admin/line-richmenu/type.d.ts](app/protocol/fetch-api/api/admin/line-richmenu/type.d.ts)
  - 加 `RichmenuLayer` / `RichmenuLayerType`
  - `LineRichmenuDto` 加 `layers?` / `layersTemplate?`
  - `PatchRichmenuBody` 加 `layers?` / `layersTemplate?`
- [app/components/open/dialog/line-richmenu/Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue)
  - import `RichmenuLayer` type
  - form 加 `layers` / `layersTemplate`
  - 加 `imageMode: 'upload' | 'compose'` 切換
  - ApiLoadDetail 載入 layers / layersTemplate；若 layers 非空自動切到 compose mode
  - ClickSave 一併 PATCH layers / layersTemplate
  - template 加圖片來源 tab toggle + 條件 render composer
  - SCSS 加 `.is-active` modifier 給 `.is-toggle` button

### 版本
v0.3.26 → v0.3.27（[version.ts](version.ts)）

## 留尾

### Brain AI 真機手測 checklist

| 場景 | 預期 |
|---|---|
| 開新 richmenu，填名稱 + lang，切「圖層合成器」tab | 顯示 composer（含空 canvas + 範本下拉） |
| 範本下拉選「grid-2×2 + 標籤」→ 套用 | canvas 顯示 4 等分（amber/slate 各 2 塊）+ 4 個 label；layer list 出 8 個 layer；form.areas = 4 |
| 點某 text layer → inspector 顯示文字/字級/顏色 | 屬性可改 → preview 即時更新 |
| 在 canvas 內拖某色塊 | 該 layer x/y 即時改 + preview 重畫 |
| 「合成並上傳」按 PNG 模式 | server 收 PNG 上傳，imageUrl 更新；切回「上傳成品圖」tab 看到 area overlay |
| 合成超 1MB | 警告 + 顯示 JPEG 重試按鈕 |
| 切到「compact-3btn」範本 | imageSize 變 2500×843，confirm 後切換 |
| 編 layer + 儲存 dialog | doc layers / layersTemplate field 寫入；下次再開 dialog 自動切回 compose mode |
| publish 後重開編輯（active 模式） | image 換不了（既有限制），但 layers 可改（純 admin metadata） |
| 編輯既有沒 layers 的 doc | 預設 upload mode；切 compose tab 也可從空開始建 |

### 後續 Wave

- **自訂 image upload 圖層**（Storage 寫入新 endpoint）— admin 反饋後再開
- **範本 marketplace** — 不做（Q4=4b 拍板）
- **canvas 撤銷 / 重做** — 觀察
- **圖層 rotation / scale / mask** — 觀察（LINE area 不支援所以不太需要）
- **多行文字 / 自動 wrap** — 觀察（admin label 通常短）
