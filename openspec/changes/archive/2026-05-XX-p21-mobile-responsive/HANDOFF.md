# Hand-off：給下個 Session

## 目前進度（2026-05-09 收工）

- ✅ **P18** Collection Split — drivers / admins 獨立 collection + admin 三層分權（程式碼層完成；migration Stage 10 由使用者操作）
- ✅ **P19** Driver Trip Mission — 五階段狀態流 + 自動定位 + war-room polish（含 G1-G12 stage gate 全綠）
- ✅ **P19 衍生 hotfix** 6 個（auth race / prefix / Nitro path / threshold tuning）
- 📋 **P20** Booking 表單擴充 — spec 已寫，等實作（`openspec/changes/2026-05-XX-p20-booking-extras/`）
- 📋 **P21** Mobile Responsive — spec 已寫，等實作（**下個 session 優先做**）

## 下個 Session 開場做這些

### 第一件事：讀文件

按順序讀（總計 ~10 分鐘）：

1. `CLAUDE.md`（根目錄，強制規範）
2. `docs/decision-log.md` 最近 3 條（P19 + P18 hotfix v2 + P18）
3. `docs/tasks.md` 最後 50 行（P19/P20 區塊 + 版本紀錄）
4. **`openspec/changes/2026-05-XX-p21-mobile-responsive/proposal.md`** — 本次主任務
5. memory 中的 P20 backlog（auto load）

### 第二件事：跟使用者確認 P21 設計細節

`p21 proposal.md` 末尾有 4 個待確認問題，先問完再動手：
1. war-room bottom sheet 開啟方式（浮動按鈕 / 上拉 / 兩者）
2. back-desk layout 在桌機是否仍保 sidebar 還是統一 hamburger
3. admin/orders 手機卡片保留哪些欄位
4. breakpoint 標準（768px / 480px 兩段？）

### 第三件事：實作 P21

Phase 1（HIGH 優先）→ Phase 2（MED）。每階段獨立 commit + push。

### 後續任務（依使用者偏好排序）

- **P20 booking 擴充**：使用者明確說「乘客端收尾查驗時做」。當使用者說「乘客端收尾」「booking 補欄位」「P20」時觸發，spec 已寫於 `openspec/changes/2026-05-XX-p20-booking-extras/`。

## 關鍵已知資訊

### 部署 / 環境

- production: https://da-line-liff-app.vercel.app
- branch 模式：`git push origin <local-branch>:main` fast-forward
- worktree path：`C:\Users\awfulone\Desktop\Projects\cc_da\.claude\worktrees\brave-dirac-2374d4`
- 主目錄 `cc_da/.env.dev` 有 `NUXT_FIREBASE_SERVICE_ACCOUNT_JSON` 可用
- node 版本支援 `--env-file` 載 `.env.dev`
- 對話用繁中、commit message 用 Conventional Commits 繁中、attribution 已禁用

### 兩個 LIFF App 設計（P19 起）

- 乘客 LIFF App endpoint URL = `/home`
- 司機 LIFF App endpoint URL = `/driver/dashboard`
- `store-auth.ts` `_InitLiffFlow` 已 path-based 推導正確 liffId
- 跳過 `app/pages/index.vue` 多重身分優先邏輯

### Driver Status 推導（P19 設計）

- `drivers.status` Firestore 只存 `online` / `busy`
- offline 由 war-room client-side 依 `lastActiveAt > 600s ago` 推導
- busy 觸發點是訂單由 `confirmed → en_route`（按「出發」），**不是接單時**
- completed → 自動切回 online（如無其他執行中訂單）

### 訂單狀態流（P19）

`pending → confirmed → en_route → arrived_pickup → in_transit → completed`（+ cancelled）

driver 改 status 嚴格狀態機，server 端拒絕跳階段。

### 既有資料兼容性

- orders.assignedDriverId 雙格式並存（line:Uxxx 跟 Uxxx），server query 全用 `where('...', 'in', [withPrefix, noPrefix])` 兼容
- drivers doc 既有 `status='offline'` 在 driver 下次 location.put 自動被 server 推導覆寫
- 新訂單 server 強制 normalize 加 prefix

### Nitro file routing 注意事項（P19 踩坑）

- 同層不能有兩個不同 dynamic segment 名稱（如 `[id]/` + `[uid]/`）
- alphabetical 較前的會註冊，較後的整批 ignore → 出 404
- 統一用一個名稱（建議 `[id]`）

## Context 評估

當前 session 已做：
- P18 hotfix v2（middleware/auth race）
- P19 完整 spec + 10 stage 實作
- 6 個 P19 hotfix
- P20 spec
- P21 spec

context 已 70%+，繼續做 P21 implementation 不建議。**請開新 session 接手**。

## 給下個 session 的提醒

- 讀 spec 後**先跟使用者對齊 P21 4 個設計細節**才動手
- 動 SCSS 前先看 `app/assets/styles/scss-tool/rwd.scss` 既有 mixin 沿用
- mobile 改動建議用 `@media (max-width: 768px)` / `@media (max-width: 480px)` 兩段
- 修完每個頁面後請使用者用手機 LIFF 實測，再進下一頁
