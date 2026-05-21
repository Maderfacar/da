# Design — Phase 1G E2E + 上線

## 1. E2E 測試結構

### 1.1 主檔 `tests/e2e/vehicle-tag-system.spec.ts`

3 個 scenarios：

```ts
test.describe('Vehicle Tag System', () => {
  test('happy path: full match', async ({ page, context }) => {
    // 0. admin 載入種子標籤
    // 1. driver 1 自編 vehicleProfile（含所有偏好標籤）→ 送審 → admin approve
    // 2. driver 2 自編 vehicleProfile（不含偏好標籤）→ 送審 → admin approve
    // 3. passenger booking → 勾 2 個偏好 → 下單
    // 4. admin 發單
    // 5. driver 1 喊單 → driver 2 喊單
    // 6. admin 看到兩個 bid（driver 1 match=2, driver 2 match=0）
    // 7. admin 指派 driver 1（full match）
    // 8. passenger 收正常配對 push（不是 soft match）
    // 9. admin 標訂單 in_progress → completed
    // assert：每階段 firestore doc / UI 狀態正確
  })

  test('soft match: passenger accepts', async ({ page, context }) => {
    // 同 happy path 1-5
    // 6. admin 指派 driver 2（partial match=0/2）
    // 7. passenger 收 3-button soft match flex
    // 8. passenger 點 accept
    // 9. confirmationStatus='accepted'，訂單繼續
  })

  test('soft match: passenger waits → rematch', async ({ page, context }) => {
    // 同 happy path 1-7
    // 8. passenger 點 wait
    // 9. order.driverId / bids 清空、bidHistory[0] 寫入、reMatchRound=1、dispatchAt 重簽
    // 10. driver 1 收新需求單 → 喊單
    // 11. admin 指派 driver 1
    // 12. passenger 收正常配對
  })
})
```

### 1.2 LINE mock

`tests/e2e/helpers/mock-line-push.ts`：

```ts
// 環境變數 LINE_PUSH_MOCK=1 時 server 端不真打 LINE，改寫 mock collection
// E2E 從 mock collection 驗證推播內容
```

實作可在 `server/utils/line-push.ts` 加 `if (process.env.LINE_PUSH_MOCK) { writeMockDoc(...); return }`。

或更簡單：E2E 環境 `LINE_PUSH_DISABLED=1`，跳過真打。assert 不檢查 LINE 內容，只檢查 firestore 狀態變化。

### 1.3 測試帳號

E2E 用 mock auth（既有專案應有測試身分機制）：
- passenger uid: `e2e-passenger-1`
- driver 1 uid: `e2e-driver-1`
- driver 2 uid: `e2e-driver-2`
- admin uid: `e2e-admin-1`

cleanup hook：每個 test 後刪除 mock data。

## 2. 單元測試補強

### 2.1 `shared/pricing.spec.ts`
- `calcTagSurcharge` 邊界 case：所有 selected 都 archived、surcharge=0 不取 max=0、negative surcharge 防呆

### 2.2 `shared/orderPreferences.spec.ts`
- snapshot 三語 fallback（en/ja 缺則用繁中）
- mutex 違反組合（同群 2 個 single）

### 2.3 `shared/orderDispatch.spec.ts`
- preferenceTagIds=0 → matchCount=0
- isSoftMatch 邊界：preferenceCount=0 → false（auto）

### 2.4 `shared/vehicleProfile.spec.ts`（1B 既存）
- 確認既有 11 case 仍綠

## 3. firestore.rules deploy

### 3.1 整理

確認累積規則：
- `tags/{tagId}` read=auth/admin only, write=false（client）
- `tag_audit_logs/{logId}` admin read, write=false
- 其他既有 rules 不動

### 3.2 deploy

用 firebase MCP `firebase_deploy({ only: 'firestore:rules' })` 或 CLI：

```bash
firebase deploy --only firestore:rules
```

deploy 前先 `firebase_validate_security_rules` 確認 syntax。

## 4. push main 流程

```bash
# 確保 lint/test/build 都綠
pnpm lint && pnpm test && pnpm build

# 確保所有 commits 在本地分支
git log claude/<branch> --oneline | head -20

# push main
git push origin claude/<branch>:main

# 等 Vercel 自動部署 ~3-5 min
# 在 Vercel dashboard 看 status
```

## 5. Prod 真機驗收 checklist

詳見 `proposal.md` § 驗收標準。共 ~30 條，依序：標籤治理 → driver profile → 公開頁 → booking → 配對 → soft match → 跨 phase 整合。

## 6. 版本號

`version.ts` 從 `v0.3.X` bump 到 `v0.4.0`（minor，因為大功能群上線）。

實際數字依當前 prod 版本決定（讀 `version.ts` 既有值 +1 minor）。

## 7. 留尾 / 不在本 series 範圍

- SU 動態演算 → Phase 2 另開
- driver-scope tag 抽查機制 → Phase 2
- 評分系統 → Phase 2+
- SEO / OG meta → Phase 2+
- 多車支援 → 不在規畫（拍版 #3）
- 自動 trigger 重新配對（vehicleProfile 變化）→ Phase 2 評估
- pending soft match 超時 SLA → Phase 2 評估
- bid 撤回後重 bid 上限 → Phase 2 評估

## 8. 失敗回滾

若 prod 發現嚴重 bug：
1. **小修可救** → 改 + commit + push（fast follow）
2. **大修需回滾** → Vercel dashboard rollback 到上個 deployment，本地 `git revert <bad commit>` + push
3. **firestore rules 有問題** → 重新 deploy 舊版 rules（從 git history 拿）

## 9. 設計權衡與已知陷阱

1. **E2E 跑時間長**：3 scenarios + 多 driver + LINE mock 可能跑 5-10 分鐘。CI 整合留 Phase 2 評估。本 phase 只要 local 跑得起來即可。
2. **mock LINE 失準風險**：mock 不打真 LINE，可能 prod 真打時才發現 Flex schema 錯。Brain AI 真機驗收 checklist 必跑 LINE 相關項。
3. **firestore rules deploy 是不可逆動作**：deploy 後 client 端規則生效，舊版若有 dev 用的寬鬆規則一旦 deploy 不能 dry run。先 `firebase_validate_security_rules` + 手測一輪。
4. **push main 後 Vercel build 失敗**：本地 `pnpm build` 通過但 Vercel 環境變數可能不同。push 前確認 Vercel 環境變數已含本 series 新加的（如有；本 series 應該沒新加 env）。
5. **i18n 翻譯品質**：英日翻譯由 Claude 寫，Brain AI 真機跑時若覺得不自然可改。本 phase 接受「能讀懂即可」的標準。
6. **既有 prod 訂單缺新欄位**：`preferences` / `bids` / `reMatchRound` 等都是 optional。既有訂單顯示時 `?? null` 即可，不寫 migration。
