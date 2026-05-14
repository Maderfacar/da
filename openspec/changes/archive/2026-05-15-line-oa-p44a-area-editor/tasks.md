# P44a — Tasks

## Phase 0：spec ✅
- [x] proposal.md
- [x] design.md
- [x] tasks.md
- [x] Brain AI 拍板（推 spec 預設 Q1-Q5）

## Phase 1：composable + 拖拉建 area + 8-handle resize ✅
- [x] 新增 `app/composables/use-richmenu-area-editor.ts`
  - [x] State：selectedIndices / dragMode / guides / transientRect / marqueeRect / primarySelectedIndex
  - [x] onPointerDownStage（empty 區 → createFlow / Ctrl → marqueeFlow）
  - [x] onPointerDownArea（idx → moveFlow / Shift = additive select）
  - [x] onPointerDownHandle（resizeFlow with handle pos，single-select only）
  - [x] commit 寫回 form.areas（preview px → 底圖 px round）
  - [x] keyboard handler（Delete / Esc / Arrow / Shift+Arrow）
  - [x] 自動 mount window keydown，unmount remove
  - [x] watch areas.length 自動清不存在的 selectedIndices
- [x] Edit.vue area-overlay 加 8 個 handle（single-select 時顯示，4 角 + 4 邊）
- [x] Edit.vue 接 composable + 移除 selectedAreaIdx 改為 selectedIndices.has(idx)
- [x] right-side area card list 支援 Shift+click 加減選
- [x] ClickApplyGrid / ClickAddArea / ClickRemoveArea 改寫支援 selectedIndices

## Phase 2：snap + 多選 + alignment guide + marquee ✅
- [x] composable 加 snap 演算法（候選 = 底圖外框 + 其他 area 4 邊；容差 6 preview px / 換算到底圖 px）
- [x] composable 加 marquee 矩形框選邏輯（相交檢測 AABB）
- [x] Edit.vue 加 alignment guide line DOM（is-v / is-h 兩種）
- [x] Edit.vue 加 marquee 矩形 DOM（dashed indigo）
- [x] Edit.vue 加 transientRect DOM（createFlow 時的虛框）
- [x] Edit.vue 加多選 hint banner（≥ 2 個選中時顯示）
- [x] keyboard 多選 + Shift 加減選
- [x] 多選後拖移保持相對位置（moveSnapshots Map 機制）

## Phase 3：build / archive ✅
- [x] `pnpm install` + `pnpm exec nuxt prepare`
- [x] `pnpm lint` 綠
- [x] `pnpm build` 綠
- [x] version v0.3.25 → v0.3.26
- [x] HANDOFF.md
- [x] archive openspec change
- [x] commit + push main

## 留尾（非阻塞）
- 真機手測 e2e（admin 開 `/admin/line-management` → 編 richmenu → 拖拉 / resize / snap / multi-select 各路線各 1 次）— Brain AI 視覺驗收
- 撤銷 / 重做（Ctrl+Z）：本 wave 不做，目前 admin 改錯走重新整理
- 行動裝置 fallback：本 wave 不做，desktop only
