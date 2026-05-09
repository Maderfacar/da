# P21 Mobile Responsive — admin / driver 端手機版面修復

## Why

使用者在 P19 收尾後 LIFF 手機實測，發現 admin 端在手機 viewport（< 768px）下版面被擠死，主畫面被側邊面板 / 強制水平捲動 / 兩欄擠死的元件覆蓋：

> admin/war-room 整個地圖版面被「即時作戰室」以及 4 個按鈕以及司機列表擋住。這部份是不是可以改成 toggle 的小視窗？

driver 端整體 mobile-first 設計尚可，但 dashboard / profile 的 stats 三欄 grid 在窄螢幕擠死。

PC 上操作沒問題，但專案是 LINE LIFF 起家，**手機才是主要使用情境**。

## What Changes

### 三大類問題（依嚴重度）

| 嚴重度 | 問題類型 | 受影響頁面 |
|--------|---------|-----------|
| **HIGH** | 固定寬度兩欄壓縮主畫面 | admin/war-room（panel 300px）、admin/traffic（aside 260px）、back-desk layout（左抽屜 280px） |
| **HIGH** | 強制水平捲動 | admin/orders（table min-width 680px） |
| **MED** | 多欄 grid 擠死 | admin/drivers（3 欄 grid）、driver/dashboard（stats 3 欄）、driver/profile（stats 3 欄）、admin/settings（tab 行無 flex-wrap） |
| **LOW** | 細節 padding / font 已 mobile-first 但可微調 | admin/notifications、driver/pending、driver/layout |

### 設計方向（依 user 提示）

**war-room 改 toggle bottom sheet drawer**：
- 預設地圖全螢幕（手機 100vw × 100vh）
- 右下浮動按鈕「司機列表 N」+ 數字
- 點擊展開 bottom sheet drawer（70vh 高），含 filter / driver list / 訂單摘要
- 按 backdrop 或下拉手勢收回

**back-desk layout drawer 改 hamburger overlay**：
- 預設隱藏，hamburger 按鈕觸發
- 抽屜推出 overlay 整個 viewport（半透明 backdrop + 0-320px 抽屜）
- 點擊 backdrop 關閉

**admin/orders 表格改卡片堆疊**：
- @max-width 768px 改 block layout
- 每筆訂單一張卡片（訂單號 / 行程類型 / 用車時間 / 司機 / 費用 / 狀態 / 操作按鈕）
- 移除強制 min-width

**stats 多欄 grid 加斷點**：
- admin/drivers 3 欄 → 2 欄 @max 768px → 1 欄 @max 480px
- driver/dashboard 3 欄 → 已 OK 不需改（但實測若擠則同上）
- driver/profile 3 欄 → 2 欄 @max 768px

### 設計系統補充

考慮新增共用 mobile breakpoint mixins 到 `app/assets/styles/scss-tool/rwd.scss`：
- `@media (max-width: 480px)` 小手機
- `@media (max-width: 768px)` 大手機 / 直立平板
- `@media (max-width: 1024px)` 平板橫向

實際先看 [app/assets/styles/scss-tool/rwd.scss](app/assets/styles/scss-tool/rwd.scss) 既有 mixin，沿用既有命名。

## Capabilities

### Modified Capabilities

- `admin-back-desk-layout`：手機改 hamburger overlay
- `admin-war-room`：手機改 toggle bottom sheet drawer
- `admin-traffic` / `admin-orders` / `admin-drivers` / `admin-settings`：響應式佈局修復
- `driver-dashboard` / `driver-profile`：stats grid 響應式

## Impact

- 純 CSS / template 結構改動，**server / API / 資料層完全不動**
- 既有 PC 體驗**不變**（用 @media 在 mobile 才生效）
- 風險：war-room toggle drawer 互動模式跟 desktop 不一致，需確保兩種模式都好用
- driver 端整體影響小（主要是 stats grid）

## 範圍劃分（建議分兩階段做）

**Phase 1（HIGH 優先）**：
- admin/war-room toggle bottom sheet
- admin/orders 表格→卡片
- admin/traffic 雙欄→單欄
- back-desk layout hamburger overlay

**Phase 2（MED）**：
- admin/drivers / admin/settings 響應式微調
- driver/dashboard / driver/profile stats grid 響應式
- 細節 padding / font-size 微調

可拆兩個 commit，Phase 1 ship 後立即驗證手機體驗，再做 Phase 2。

## 待新 session 確認的設計細節

1. **war-room bottom sheet 開啟方式**：浮動按鈕 vs 上拉手勢 vs 兩者皆可？
2. **back-desk layout 在桌機是否仍保留 280px sidebar**？還是統一改 hamburger（簡化維護）？
3. **admin/orders 卡片版本欄位簡化**：手機卡片內保留哪些欄位？（建議：訂單號 + 用車時間 + 司機名 + 費用 + 狀態 + 操作）
4. **breakpoint 標準**：採用 768px / 480px 兩段？還是更細？
