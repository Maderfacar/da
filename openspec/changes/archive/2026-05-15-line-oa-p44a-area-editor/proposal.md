# 2026-05-15 — Admin LINE OA Richmenu Area Editor 拖拉互動（P44a）

> **狀態**：Brain AI 預先拍板「直接做完 / 全用 spec 預設」— Q1-Q5 全推預設，直接進 Phase 1 實作。
> **規模**：純前端 / 1.5-2 工作天 / 4 Phase。
> **拆分**：原 P44 由 Q5=5b 拆 P44a area editor + P44b composer；本 change 只做 P44a。

## Why

P38 上 prod 後，admin 設定 richmenu area 只能：

1. **grid quick set**（1×1 / 2×1 / 3×1 / 2×2 / 3×2 / 2×3）— 套用後等分切；但實際 menu 圖很少是均勻 grid（如「左大 + 右上 + 右下」、「上 hero + 下 3 等分」），grid 套了之後仍需手動改 x/y/w/h
2. **手動輸入 x / y / w / h 四個數字** — 對齊 menu 圖內視覺元素全靠肉眼校稿 + 反覆改數字 + 重新整理頁面看 overlay；admin 體感差，且容易出現 area 與底圖視覺元素 mis-align 1-2 px 的小錯
3. **沒有「以視覺方式直接畫 area」的能力** — 與業界圖文選單編輯器（LINE Official Account Manager / Manychat / Botbiz）的最低門檻落差大

P44a 把 area editor 升級為「視覺拖拉建 area + handle 縮放 + snap to grid + 多選 + 對齊輔助線」，讓 admin 用「拖一個方框 → 出來就是 area」的直覺方式設區塊，降低 menu 設計門檻。

## What Changes

### 1. 拖拉建 area（Q3 範圍 3b 基本）

在現有 image preview overlay 上：

- **空白處按下 mouse + drag** → 出現臨時黃色虛線方框（live preview）
- **mouseup** → 自動建立新 `RichmenuArea`（action 預設 `message`、text 預設「區塊 N」），並選中該 area
- **拖到底圖外** → clamp 到底圖邊界
- **拖距 < 20px**（誤觸）→ 取消，不建立
- **超過 AREAS_MAX (20)** → 不建立 + ElMessage warn

### 2. Resize handle 8 把手（Q3 範圍 3b 基本）

當 area 被選中時，4 角 + 4 邊各顯示一個 handle（共 8 個）：

- **角 handle**：拖拉時同時改 width + height（保留對角線錨點）
- **邊 handle**：只改一邊（保留 3 邊錨點）
- **拖移時 clamp**：寬高最小 1 px、不可超出底圖
- **拖移時 snap**（若 Q3 = 3b）：滑到 grid 線距離 < 6 px 時吸附

### 3. 整塊 area 拖移

被選中的 area 在非 handle 區（內部）按 mouse + drag：

- 整塊位移 dx/dy
- clamp 不出底圖
- 也走 snap 邏輯

### 4. Snap to grid + 對齊輔助線（Q3 = 3b）

- **snap 容差**：6 px（preview 端，等比換算成底圖 px）
- **吸附目標**：
  - 底圖外框（x=0 / y=0 / x=imgW / y=imgH）
  - **其他 areas 的邊**（左/右/上/下 共 4 條）
  - **網格線**（依目前 grid 預設 — 若 admin 套過某 grid 則對齊那個 grid，沒套過則對齊「等分為 4×3 cells」的標準輔助線）
- **alignment guide**：吸附當下顯示**粉紅水平/垂直細線**橫貫整張底圖，drag 結束後隱藏

### 5. 多選 + 批次操作（Q3 = 3b）

- **Shift+click area** → 加入選取
- **Ctrl+drag 空白處** → 矩形框選（marquee）所有相交 area
- **多選後拖移** → 一起位移（保持彼此相對位置）
- **多選後刪除**（Delete / Backspace 鍵）→ 一次刪
- **多選不支援 handle 縮放**（資訊互相衝突，第一版只支援單選縮放）

### 6. 既有手動 x/y/w/h 與 grid quick set 保留

- 原本 grid quick set 6 個按鈕 + 手動輸入 x/y/w/h（每個 area card）**完全保留**，作為「進階模式」
- 拖拉互動 = 主要操作；數字輸入 = 微調

### 7. 鍵盤快捷鍵

- **Delete / Backspace**：刪除選中的 area（含多選）
- **Esc**：取消選中（清空 selectedAreas）
- **方向鍵**：選中的 area 整塊位移 1px（Shift+方向鍵 = 10px）

## Out of Scope（明確不做）

- ❌ **圖層合成器**（→ P44b 獨立 wave）
- ❌ **旋轉 / 翻轉 area**（LINE 不支援，area bounds 永遠為 axis-aligned rectangle）
- ❌ **lock area**（避免誤拖）
- ❌ **層級調整**（z-index，LINE area 不重疊原則上不需此功能）
- ❌ **撤銷 / 重做**（Ctrl+Z）— 留尾，目前 admin 改錯走「重新整理回到上次儲存」
- ❌ **拖拉互動行動版**（admin 只在 desktop 操作，行動版維持手動輸入）
- ❌ **碰撞偵測警告**（area 互相重疊在 LINE 規格允許，admin 自己負責）

## 5 個關鍵決策

### Q1：合成器執行端

- **1a Client canvas**：HTML Canvas 2D API，純前端，無 server 依賴
- **1b Server canvas**：sharp / node-canvas，新 endpoint + 處理圖層暫存

**Brain AI 拍板（spec 預設）**：**1a** — P44b 用 client canvas，無 server 依賴；P44a 不涉及合成器但 Q1 預先拍板供 P44b 引用。

### Q2：圖層 schema

- **2a 純 client state**：合成後只存最終 PNG，不存圖層 metadata
- **2b 存圖層結構到 doc**：line_richmenus 加 `layers` field，可後續再編

**Brain AI 拍板（spec 預設）**：**2b** — 後續重編圖層比重做整張 PNG 友善。P44a 不涉及 layers 但 Q2 預先拍板供 P44b 引用。

### Q3：area editor 範圍

- **3a 基本**：只做拖拉 + resize handle
- **3b 中階**：加 snap to grid + 多選 + 對齊輔助線
- **3c 全功能**：加旋轉 / lock / 層級調整

**Brain AI 拍板（spec 預設）**：**3b** — 兼顧易用且不過度。本 P44a 主範圍。

### Q4：預設模板

- **4a 不做**：純空白起手
- **4b 5 個範本**：grid / hero / mixed
- **4c marketplace**：admin 可發佈自訂範本給其他 admin

**Brain AI 拍板（spec 預設）**：**4b** — P44b 提供 5 個範本（grid / hero / mixed 風格）。P44a 不涉及 templates 但 Q4 預先拍板供 P44b 引用。

### Q5：範圍切分

- **5a 同 wave 一次做完**：area editor + 合成器 + 模板（3-4d）
- **5b 拆 P44a / P44b**：各 1.5-2d 獨立 ship

**Brain AI 拍板（spec 預設）**：**5b** — 本 change 只做 P44a；P44b 另起 openspec change。

## Impact

### 影響範圍

- **改動既有檔（1 個）**：`app/components/open/dialog/line-richmenu/Edit.vue`
  - 加 pointer event handlers（pointerdown / pointermove / pointerup）
  - 加 8 個 resize handle DOM
  - 加 alignment guide 浮層
  - 加 marquee 矩形框選浮層
  - 加全域 keyup listener（Delete / Esc / 方向鍵）
- **新增前端 util（1 個）**：`app/composables/use-richmenu-area-editor.ts`
  - 封裝 pointer state（dragMode：'create' / 'move' / 'resize' / 'marquee'）
  - snap 演算法
  - hit-testing（角/邊 handle vs 內部）
  - keyboard handler
- **不動 server / API / firestore rules / indexes**：純前端互動升級

### 風險

| 風險 | 緩解 |
|---|---|
| 與既有 grid quick set / 手動輸入並存可能行為衝突 | grid quick set 按下時清空 areas（既有行為），拖拉建 area = append；手動輸入 x/y/w/h 與拖拉互相同步（雙向 binding 既有） |
| pointer event 在 admin 用 trackpad / touch screen 可能行為怪 | 統一用 Pointer Events API（不分 mouse/touch），測試標的：Mac trackpad / Windows mouse / iPad pen |
| 多選 + Shift 與系統選字衝突 | overlay 容器設 `user-select: none` |
| Snap 容差太大導致 admin 無法精準調 1px | snap 在「目標 line 距離 < 6 px (preview 端)」才作用；想精準時放大瀏覽器或用方向鍵 |
| 既有手動 x/y/w/h 雙向綁仍正確 | reactive form.areas[i].bounds — 拖拉時直接寫回 form.areas[i].bounds，數字輸入也寫回同一處 |

### 估時

| Phase | 內容 | 估時 |
|---|---|---|
| **Phase 0** | openspec spec 三件套（本檔） | 0.25d |
| **Phase 1** | composable `use-richmenu-area-editor.ts` + Edit.vue 拖拉建 area + 8-handle resize | 0.75d |
| **Phase 2** | snap to grid + 多選 + alignment guide + 鍵盤快捷鍵 | 0.75d |
| **Phase 3** | e2e 視覺檢查 + version bump + archive | 0.25d |
| **總計** | | **~2 工作天** |

## Brain AI 拍板紀錄（2026-05-15）

**指令**：「直接做完，有需要拍板的，就直接照你預設即可」。Q1-Q5 全用推 spec 預設。詳見 [design.md §11](design.md#11-決策紀錄)。

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | 1a | Client canvas（純前端） |
| Q2 | 2b | doc 加 layers field |
| Q3 | 3b | drag + resize + snap + 多選 + alignment guide |
| Q4 | 4b | 5 個範本（P44b） |
| Q5 | 5b | 拆 P44a / P44b |

**Phase 1 解鎖** — 可直接開工。
