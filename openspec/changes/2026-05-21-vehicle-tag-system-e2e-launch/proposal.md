# Phase 1G — 車輛標籤系統 E2E + 上線（2026-05-21）

> 整體計畫**最後 1 phase**。前置：1A-1F 全部完成（commit 累積在分支上、未 push）。
> 本 phase 把累積的 commits 全面驗證 → 部署 firestore rules → push main → prod 驗證。

## Why

1A-1F 累積 6+ 個 commits 在本地分支（依拍版「最後一次 push prod 直接線上驗證」）。push 前必須：
1. 整個鏈路 E2E 跑一次（避免哪個 phase 漏接）
2. firestore.rules 一次性 deploy（1A 加 tags / tag_audit_logs，本 phase 也可順便清整 rules）
3. pricing 與其他 shared 單元測試補強
4. edge case 修補（race condition / Soft Match 不回應 / dispatchAt 重複 / bid 撤回後重 bid 等）
5. 寫 prod 驗證清單給 Brain AI 真機跑

## What Changes

### 機制總覽

1. **E2E 全鏈路** Playwright 測：
   - admin 建標籤 → admin 載入種子 → driver 自編 vehicleProfile → admin 審核 → 公開頁可看 → passenger booking 勾偏好 → 訂單建立含 preferences → admin 發單 → driver 喊單 → admin 指派（完全 / 部分命中兩支） → passenger Soft Match 接受 → 訂單 confirmed → in_progress → completed
   - 不打真 LINE / 真金流（mock 或 skip）
2. **pricing 單元測試補強**：補 phase 累積 tag surcharge / order preferences / driver match / soft match 的邊界 case
3. **firestore rules deploy**：累積 1A 新加的 `tags` / `tag_audit_logs` 規則 + 既有未 deploy 的修改一次性 push 到 prod
4. **edge case 修補**：跑 E2E 與 prod 驗收清單時發現的 bug 都在本 phase 修
5. **push main**：把 1A~1F 所有 commits（也包含本 phase 的 fix）push 到 main，觸發 Vercel 自動部署
6. **Prod 驗證清單**：列 ≥ 30 條手測 checklist 給 Brain AI 上 prod 跑

### 不做（明確排除）

- 不重做任何 phase 的 UI / 邏輯（純整合 / 驗證 / 上線）
- 不接金流（後付，無實際扣款）
- 不做 SU 動態演算（Phase 2）
- 不做 driver 評分 / SEO / OG meta

## 11 個決策

| # | 議題 | 拍版 |
|---|---|---|
| 1 | E2E 框架 | Playwright（既有專案已用） |
| 2 | E2E 範圍 | 1A→1F 全鏈路 1 個主 happy path + 2 個分支（Soft Match accept / wait） |
| 3 | LINE 真打嗎 | mock / skip（環境變數 切換） |
| 4 | 金流 | 後付（無扣款），skip 測試 |
| 5 | firestore rules deploy | **本 phase 最後執行**（避免 dev 期間誤拒 read） |
| 6 | 部署模式 | push main → Vercel 自動 deploy |
| 7 | 失敗回滾策略 | git revert 該 commit；prod 從 Vercel rollback |
| 8 | 通知 channel | passenger LINE + driver LINE +（admin 內部不通知） |
| 9 | Brain AI 真機驗收 | 必跑（≥ 30 條 checklist） |
| 10 | 版本號 | 累積 1A~1G 為一個 minor bump（如 v0.4.0） |
| 11 | i18n 補丁 | 真機跑時若發現 en/ja fallback 缺翻譯，本 phase 一併補 |

## Impact

### Affected code (Phase 1G only)

| 檔案 | 動作 |
|---|---|
| `tests/e2e/vehicle-tag-system.spec.ts` | 🆕 主 E2E（1 happy path + 2 分支） |
| `tests/e2e/helpers/mock-line-push.ts` | 🆕（mock LINE push 避免真打） |
| `shared/pricing.spec.ts` | 改：補 5+ 邊界 case |
| `shared/orderPreferences.spec.ts` | 改：補 case |
| `shared/orderDispatch.spec.ts` | 改：補 case |
| `firestore.rules` | 整理 + deploy（用 firebase MCP / CLI） |
| `version.ts` | 改：v0.3.X → v0.4.0（minor bump） |
| Bug fix files（依驗收結果） | 改 |
| `openspec/changes/2026-05-21-vehicle-tag-system-e2e-launch/HANDOFF.md` | 🆕（含 prod 驗收 checklist） |

### 不影響

- 任何 1A-1F 已實作的核心邏輯（除非發現 bug）
- 其他既有 feature（折扣碼 / referral / fare V2）

## 驗收標準

### Phase 1G 本身（local）
- [ ] E2E 主 happy path 全綠
- [ ] E2E 兩個分支（soft match accept / wait）全綠
- [ ] `pnpm lint` 全綠
- [ ] `pnpm test` 全綠（含補強單元測試）
- [ ] `pnpm build` 全綠
- [ ] firestore rules `firebase deploy --only firestore:rules` 成功
- [ ] `git push origin claude/<branch>:main` 成功
- [ ] Vercel 自動部署 status: ready

### Prod 真機驗收 checklist（Brain AI 自跑，預估 60-90 min）

#### 標籤治理（1A）
- [ ] admin 進 /admin/settings → 「車輛標籤」tab → 看到 6 群 24 預載
- [ ] 新增 / 編輯 / archive / 還原 各跑一次，audit log 寫入正確

#### Driver profile（1B）
- [ ] driver 進 /driver/profile → VEHICLE & SKILLS section → 改 driverSkill 立即生效
- [ ] driver 改 vehicleProfile（標籤 / 照片）→ 自動進 draft → 送審
- [ ] admin 收 LINE 通知 → 進 admin/drivers/[uid] → 「車輛 Profile ⚠待審」tab → diff view → approve
- [ ] driver 收 LINE 通知「已通過」

#### 公開檔案頁（1C）
- [ ] 進 /vehicles/{verified driverId} → 看到完整公開頁
- [ ] 進 /vehicles/{unverified} → 404
- [ ] 切 lang zh/en/ja → 標籤名跟著切

#### Booking 偏好 + 加價（1D）
- [ ] booking 頁勾選偏好 → fare summary 即時加 max 加價
- [ ] 多勾 → 取 max
- [ ] 確認下單後 order doc 內有 preferences snapshot
- [ ] 改某 tag 加價 → 重看舊單金額不變

#### 訂單需求單 + 配對（1E）
- [ ] admin 點「發出需求單」→ 所有 driver 收 LINE
- [ ] driver 進接單看板 → 喊單 → admin 看到 bid
- [ ] driver 撤回 → admin 看到該 bid 灰掉
- [ ] admin 指派完全命中 driver → 雙方收 LINE
- [ ] passenger LINE 點公開頁連結 → 進 /vehicles/{driverId} 正確

#### Soft Match + 重新配對（1F）
- [ ] admin 指派部分命中 driver → passenger 收 3 按鈕 Flex
- [ ] 點「接受」→ confirmationStatus accepted
- [ ] 點「等下一輪」→ 訂單回 pending、reMatchRound +1、原 driver 收 deselect 通知
- [ ] 點「取消」→ cancelled_by_passenger
- [ ] admin 點「強制重新配對」→ 流程正確

#### 跨 phase 整合
- [ ] cancel 訂單時所有 active bidder 收 LINE 通知
- [ ] reMatchRound > 0 訂單在 admin 列表顯示徽章
- [ ] audit log 完整覆蓋 dispatch / bid / withdraw / assign / rematch / soft_match_response
- [ ] 三語切換在乘客端都正常（無 fallback 漏字）
