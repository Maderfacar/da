# HANDOFF — P44a Admin LINE Richmenu Area Editor 拖拉互動（2026-05-15）

> 程式碼層完工 — Phase 0-3 全部綠並準備 push main。`pnpm lint` + `pnpm build` 皆通過。
> 真機手測由 Brain AI 視覺驗收。

## 實作摘要

| Phase | 內容 | 狀態 |
|---|---|---|
| 0 | openspec spec 三件套 + Brain AI 拍板 Q1-Q5 全用推 spec 預設 | ✅ |
| 1 | composable + 拖拉建 area + 8-handle resize + 整塊位移 | ✅ |
| 2 | snap to grid + alignment guides + 多選 + Ctrl+drag marquee + 鍵盤快捷鍵 | ✅ |
| 3 | build 驗證 + version bump + archive | ✅ |

## 拍板紀錄（design.md §11）

5 個 Q 全用推 spec 預設（2026-05-15「直接做完 / 預設即可」拍板）：

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | 1a | Client canvas（P44b 用，純前端） |
| Q2 | 2b | line_richmenus doc 加 layers field（P44b 用） |
| Q3 | 3b | drag + resize + snap + 多選 + alignment guide |
| Q4 | 4b | 5 個預設範本（P44b 用） |
| Q5 | 5b | 拆 P44a / P44b 兩 wave 獨立 ship |

## 部署狀態

✅ **純前端 / 無 firestore / 無 env 變動 / 無 server endpoint 改動**
✅ 本 wave 不需 firebase deploy。
⏳ **真機手測**（Brain AI 視覺驗收清單見下方）。

## 程式碼總覽

### 新增（1 個）
- [app/composables/use-richmenu-area-editor.ts](app/composables/use-richmenu-area-editor.ts) — 整套互動邏輯封裝
  - State：selectedIndices / primarySelectedIndex / dragMode / guides / transientRect / marqueeRect
  - 操作：onPointerDownStage / onPointerDownArea / onPointerDownHandle / onPointerMove / onPointerUp / onPointerCancel
  - 公開：selectArea / clearSelection / deleteSelected
  - Snap：preview 端 6px 容差，候選 = 底圖外框 + 其他 area 4 邊
  - keyboard：Delete / Backspace / Esc / 方向鍵（Shift+Arrow = 10px）；input/textarea 焦點時不攔截

### 改動（1 個）
- [app/components/open/dialog/line-richmenu/Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue)
  - 接入 `useRichmenuAreaEditor`
  - 移除 `selectedAreaIdx`，改用 `selectedIndices`（Set<number>）
  - image-preview 加 ref + Pointer Events handlers + 固定 width/height
  - area-overlay：8 個 resize handle 子元素（single-select 時顯示），cursor: move
  - 新增 DOM：`.transient`（createFlow 虛框）/ `.marquee`（Ctrl+drag）/ `.guide.is-v/is-h`（對齊輔助線）
  - area card list：Shift+click 加減選；多選 ≥ 2 時顯示 hint banner
  - ClickApplyGrid / ClickAddArea / ClickRemoveArea 對齊 selectedIndices

### 版本
v0.3.25 → v0.3.26（[version.ts](version.ts)）

## 留尾

### Brain AI 真機手測 checklist

| 場景 | 預期 |
|---|---|
| 上傳 2500×1686 圖後在空白處 drag 200×200 框 | 出現新 area，list 顯示 "區塊 1" card，selected |
| 對選中 area 拖 SE 角 | 寬高同時變，左上角錨點不動 |
| 對選中 area 拖 N 邊 | 高度改變、上邊跟手指走、下邊不動 |
| 拖時靠近底圖左邊 5px | 顯示粉紅垂直 guide line，鬆手後 x 對齊 0 |
| Shift+click 多選 2 area，按 Delete | 兩個都刪 |
| Ctrl+drag 在空白處框選 3 個 area | 3 個都加入 selected，顯示 hint banner「已選 3 個區塊」 |
| 多選後拖移整塊 | 3 個保持相對位置一起移動 |
| 選中 area 按 ArrowRight | area x +1（Shift+ArrowRight 為 +10） |
| 手動改 area card 的 x/y/w/h | overlay 同步更新 |
| grid quick set 套用 2×2 | areas 變 4 個，selectedIndices = {0} |

### 後續 Wave

- **P44b**：圖層合成器 + 5 個預設模板 + line_richmenus doc 加 layers field（Q1=1a / Q2=2b / Q4=4b 落地）
- **撤銷 / 重做**：本 wave 不做，留尾觀察 admin 實際使用後再評估
- **行動裝置**：admin 端只在 desktop，行動裝置維持只能用手動 x/y/w/h（不開放拖拉）
