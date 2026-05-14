# P44a — Area Editor 拖拉互動：設計

## 1. 互動規格（state machine）

```
idle
 ├── pointerdown on empty bg
 │     └── (if Ctrl) → marqueeFlow
 │     └── (else)    → createFlow
 ├── pointerdown on area body
 │     └── (if Shift) selectedSet.add(idx) → idle
 │     └── (else)    selectedSet = {idx}, → moveFlow
 ├── pointerdown on handle (8 個之一)
 │     └── (only single select) → resizeFlow
 └── keydown
       ├── Delete/Backspace → 刪除 selectedSet
       ├── Esc              → selectedSet.clear()
       └── Arrow keys       → 整塊位移（Shift = 10px）

createFlow / moveFlow / resizeFlow / marqueeFlow
 ├── pointermove → 更新 transient state + 顯示 alignment guide（若 snap）
 └── pointerup   → commit 進 form.areas (createFlow append; move/resize replace)
                  → guide 隱藏
                  → mode = idle
```

## 2. composable API（use-richmenu-area-editor.ts）

```typescript
interface RichmenuAreaEditorParams {
  imageSize: Ref<RichmenuSize | null>;
  previewScale: Ref<number>;        // 底圖 px → preview px
  areas: Ref<RichmenuArea[]>;       // 雙向綁 form.areas
  maxAreas: number;
  snapThresholdPx?: number;          // preview 端 px，default 6
}

interface RichmenuAreaEditorReturn {
  // 狀態
  selectedIndices: Readonly<Ref<Set<number>>>;
  dragMode: Readonly<Ref<'idle' | 'create' | 'move' | 'resize' | 'marquee'>>;
  guides: Readonly<Ref<Array<{ orientation: 'h' | 'v'; pos: number }>>>; // preview px
  transientRect: Readonly<Ref<{ x: number; y: number; w: number; h: number } | null>>; // preview px
  marqueeRect: Readonly<Ref<{ x: number; y: number; w: number; h: number } | null>>;

  // 操作
  onPointerDownStage: (e: PointerEvent) => void;
  onPointerDownArea: (e: PointerEvent, idx: number) => void;
  onPointerDownHandle: (e: PointerEvent, idx: number, handle: HandlePosition) => void;
  selectArea: (idx: number, additive?: boolean) => void;
  clearSelection: () => void;
  deleteSelected: () => void;
}

type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
```

## 3. Snap 演算法

```
snapEdges(rect, allOtherAreas, imageSize, snapPx):
  candidates = []

  // 自身 4 邊（x 軸 / y 軸）
  selfEdges = [rect.x, rect.x + rect.width, rect.y, rect.y + rect.height]

  // 對齊目標
  targetsX = [0, imageSize.width, ...flatMap(otherAreas, a => [a.x, a.x + a.w])]
  targetsY = [0, imageSize.height, ...flatMap(otherAreas, a => [a.y, a.y + a.h])]

  // 對每個 self edge 找最近 target，若距離 < snapPx → 推 candidates
  // 同時記錄要顯示的 guide line

  return { adjustedRect, guides }
```

snap 規則：
- **createFlow / resizeFlow**：snap 套用在被拖的邊（左 / 右 / 上 / 下，依 handle 決定）
- **moveFlow**：snap 套用在 4 邊；先取所有候選距離最小的 axis 套用，避免一拖整 rect 跳

## 4. Resize handle DOM 與 hit-test

8 個 handle 共用 `.area-handle` class，內部 BEM modifier 標位置：

```
.area-overlay
  .area-handle.is-nw   位置 left:-4px top:-4px
  .area-handle.is-n    位置 left:calc(50%-4px) top:-4px
  .area-handle.is-ne   位置 right:-4px top:-4px
  .area-handle.is-e    位置 right:-4px top:calc(50%-4px)
  .area-handle.is-se   位置 right:-4px bottom:-4px
  .area-handle.is-s    位置 left:calc(50%-4px) bottom:-4px
  .area-handle.is-sw   位置 left:-4px bottom:-4px
  .area-handle.is-w    位置 left:-4px top:calc(50%-4px)
```

只在 `selectedIndices.size === 1` 時顯示。cursor 對應：
- nw / se → nwse-resize
- ne / sw → nesw-resize
- n / s → ns-resize
- e / w → ew-resize

handle 上 `pointerdown` `stopPropagation` 後呼叫 `onPointerDownHandle(e, idx, handlePos)`。

## 5. 預覽 px ↔ 底圖 px 轉換

- 滑鼠座標一律以 `getBoundingClientRect()` 的 preview overlay 為基準（取 e.clientX - rect.left）
- 拖拉計算全程用 preview px → commit 寫回 form.areas 時 / previewScale 轉成底圖 px → `Math.round()` 取整
- snap 容差 `snapThresholdPx = 6`（preview 端）

## 6. 視覺設計

- **resize handle**：8×8 px 白底 + 1px amber($d4860a) 邊框 + cursor 對應 + hover scale 1.3
- **alignment guide line**：1px solid #ec4899 (rose-500)，橫貫底圖，opacity 0.7，只在 drag 中顯示
- **marquee 框**：1px dashed #6366f1 (indigo-500) + 半透明填色 rgba(99,102,241,0.08)
- **transientRect**（createFlow 中的臨時方框）：1px dashed amber + 半透明 amber 填色

## 7. 與既有 UI 整合點

- `selectedAreaIdx` (number) 改為 `selectedIndices` (Set<number>)：所有現用 `selectedAreaIdx === idx` 改為 `selectedIndices.has(idx)`；既有「最後選中」可用 `[...selectedIndices].at(-1)` 作為主編輯 idx
- area card list（右側）展開 single-select 主編輯 idx 的 detail；多選時顯示 placeholder「已選 N 個區塊（Delete 刪除）」
- 既有 grid quick set 按鈕保留，互動為「整片清空 areas → 套用 grid」
- 既有手動 x/y/w/h 仍為唯一精準控制方式；拖拉建 area / resize / move 都會即時更新 form.areas[i].bounds，雙向綁不破壞

## 8. 鍵盤快捷鍵 dispatch

- 監聽 window keydown，**只在 dialog focus 範圍內**才作用（透過 `dialogRef.contains(document.activeElement)` 或單純看 dialog open state）
- focus 在 `<input>` / `<textarea>` 時 Delete / Backspace 不攔截
- Esc 在任何情境都先 clear selection；如 selectedIndices 為空再考慮關閉 dialog（第一版只 clear，不關 dialog 避免 admin 誤關）

## 9. 風險 / fallback

- **iOS Safari Pointer Events**：第一版 admin 只在 desktop；行動裝置 fallback 為「只能用手動輸入 x/y/w/h」
- **超大 area 數量（接近 max 20）pointer overlap 嚴重**：handle hit-area 8px 容易誤點隔壁；解法 = 若 hover 到多個 area 重疊位置，z-index 取最上層（後加的）；admin 自己拖開重疊以區分
- **previewScale 為 0** （imageSize 尚未載入）：composable 早 return；UI 不啟用拖拉

## 10. 測試範圍

純前端視覺互動，不寫 unit test（既有 vitest 沒覆蓋 Vue SFC）；手測：

| 場景 | 預期 |
|---|---|
| 上傳圖後空白 drag 一個 200×200 框 | 出新 area，list 加 1 個 card，selected |
| 對選中 area 拖 SE 角 | 寬高同時變，左上角錨點不動 |
| 對選中 area 拖 N 邊 | 高變，上邊跟手指走，下邊不動 |
| 拖時靠近底圖左邊 5px | 顯示粉紅垂直 guide，鬆手後 x 對齊 0 |
| Shift+click 多選 2 area，按 Delete | 兩個都刪 |
| Ctrl+drag 在空白處框選 3 個 area | 3 個都加入 selected，cards 顯示「已選 3」 |
| 多選後拖移整塊 | 3 個保持相對位置一起移動 |
| selectedIndices 空時按方向鍵 | 不動 |
| 手動改 area card 的 x/y/w/h | overlay 同步更新 |
| grid quick set 套用 2×2 | areas 變 4 個，selectedIndices 重設為 {0} |

## 11. 決策紀錄

### 2026-05-15 — Brain AI 拍板（推 spec 預設）

| Q | 拍板 | 為什麼 |
|---|---|---|
| Q1 | 1a Client canvas | 純前端足夠；避免 sharp/node-canvas server 依賴與 Vercel cold start 包複雜化 |
| Q2 | 2b doc 加 layers field | 後續可重編比重做整圖友善；存 layer metadata 不會明顯增 doc size（每 menu 5-10 layer 就到頭） |
| Q3 | 3b 中階範圍 | snap + 多選 + alignment guide 是業界 menu 編輯器 baseline；3a 太陽春，3c 旋轉 / lock LINE area 規格不支援沒意義 |
| Q4 | 4b 5 個範本 | marketplace 過度設計；空白起手對 admin 不友善 |
| Q5 | 5b 拆 P44a / P44b | 同 wave 一次做完範圍太大（4d），拆兩 wave 各 1.5-2d 可獨立 ship 且漸進交付 |

**Brain AI 指令節錄**：「直接做完，有需要我拍板的，就直接照你預設即可。要問我 allow 或 permission 的直接都 allow」。
