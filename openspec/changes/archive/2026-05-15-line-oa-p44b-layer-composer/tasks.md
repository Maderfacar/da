# P44b — Tasks

## Phase 0：spec ✅
- [x] proposal.md
- [x] design.md
- [x] tasks.md
- [x] Brain AI 拍板（推 spec 預設 Q1-Q4 + 簡化 scope）

## Phase 1：schema + doc + 後端 ✅
- [x] `server/utils/line-richmenu-doc.ts` 加 RichmenuLayer interface + LineRichmenuDoc.layers? + DTO 同步
- [x] `server/utils/line-richmenu-doc.ts` 加 validateLayers(raw, size) + validateLayersTemplate helper
- [x] `server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts` body 支援 layers / layersTemplate（包含 audit log payload 紀錄 layersCount）
- [x] `app/protocol/fetch-api/api/admin/line-richmenu/type.d.ts` 加 RichmenuLayer / RichmenuLayerType / 擴 LineRichmenuDto / PatchRichmenuBody

## Phase 2：前端 composer ✅
- [x] `app/utils/richmenu-templates.ts` — 5 個範本定義 + helper（getTemplate / listTemplates / cloneTemplate）
  - grid-2x2-iconLabel / hero-plus-3 / header-plus-2x2 / compact-3btn(2500×843) / bg-plus-6grid
- [x] `app/composables/use-richmenu-composer.ts` — layer CRUD + canvas render（rectangle/text/image w/ fit） + composeBlob（PNG/JPEG + 1MB 檢查） + 拖移
- [x] `app/components/admin/line-management/RichmenuComposer.vue` — 主 UI（sidebar layer list + stage canvas + inspector）
- [x] DialogLineRichmenuEdit 圖片 section 加 tab toggle「上傳成品圖 / 圖層合成器」
- [x] 合成並上傳：composeBlob → ApiUploadLineRichmenuImage → 同 ClickSave 一併 PATCH layers + layersTemplate
- [x] 1MB 警告 + JPEG fallback（admin 確認後重試）

## Phase 3：build / archive ✅
- [x] `pnpm lint` 綠
- [x] `pnpm build` 綠
- [x] version v0.3.26 → v0.3.27
- [x] HANDOFF.md
- [x] archive openspec change
- [x] commit + push main

## 留尾（非阻塞）
- 自訂 image upload 圖層（Firebase Storage 寫入新 endpoint）— admin 反饋後再開
- 範本 marketplace（admin 發布自訂範本）— Q4=4c 不在本 wave
- canvas 圖層撤銷 / 重做 — 觀察
- 圖層 rotation / scale / mask — 觀察
- 多行文字 / 自動 wrap — 觀察（admin 標籤通常短行可接受）

## 留尾（非阻塞）
- 自訂 image upload 圖層（Firebase Storage 寫入）— admin 反饋後再開
- 範本 marketplace（admin 發布自訂範本）— Q4=4c 不在本 wave
- canvas 圖層撤銷 / 重做 — 觀察
- 圖層 rotation / scale / mask — 觀察
