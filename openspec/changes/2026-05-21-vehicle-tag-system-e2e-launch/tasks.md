# Phase 1G 任務拆解

> 依 `design.md` 實作。**本 phase 是整個系列的最後一站**：跑 E2E、補測試、deploy rules、push main、prod 驗收。

## 0. 探勘（10 min）
- [ ] 讀 `playwright.config.ts` 或 `tests/e2e/` 既有結構
- [ ] 確認 mock auth 機制（grep `mockAuth` / `testToken`）
- [ ] 確認 `LINE_PUSH_DISABLED` 或類似 mock 機制（grep `process.env.LINE`）
- [ ] 確認當前 `version.ts` 版本
- [ ] 確認 1A-1F 全部 commits 在本地分支（git log）

## 1. E2E 測試（120 min）
- [ ] `tests/e2e/vehicle-tag-system.spec.ts` 🆕
  - happy path（full match）
  - soft match accept
  - soft match wait → rematch
- [ ] `tests/e2e/helpers/mock-line-push.ts` 🆕（或在 server util 加 env 切換）
- [ ] LINE mock 機制接入 `server/utils/line-push.ts`（加 `LINE_PUSH_DISABLED` 環境變數判斷）
- [ ] 本地跑 `pnpm test:e2e` 全綠

## 2. 單元測試補強（30 min）
- [ ] `shared/pricing.spec.ts` 補 5+ 邊界 case
- [ ] `shared/orderPreferences.spec.ts` 補 case
- [ ] `shared/orderDispatch.spec.ts` 補 case
- [ ] 確認既有 `shared/vehicleProfile.spec.ts` 11 case 仍綠

## 3. Edge case 修補（依驗收結果動態）
- [ ] 跑 E2E 與真機 smoke 後若發現 bug → 本 phase 修
- [ ] race condition / null fallback / i18n 漏翻 等

## 4. firestore.rules 整理（15 min）
- [ ] 用 `firebase_validate_security_rules` 確認 syntax
- [ ] 確認 1A 加的 `tags` / `tag_audit_logs` 規則仍正確
- [ ] 不刪任何既有規則

## 5. 版本 bump（5 min）
- [ ] 讀 `version.ts` 當前版本
- [ ] minor bump（如 v0.3.27 → v0.4.0）
- [ ] commit message: `chore: 版本升至 v0.4.0 — 車輛標籤系統 (Phase 1A-1G)`

## 6. 三項驗證（10 min）
- [ ] `pnpm lint` 全綠
- [ ] `pnpm test` 全綠（含 E2E）
- [ ] `pnpm build` 全綠

## 7. Commit 1G 內容（5 min）
- [ ] commit message: `feat: Phase 1G — E2E + 上線`
- [ ] 包含 E2E 檔案 / 單元測試補強 / bug fix / version bump
- [ ] **暫不 push**，等 deploy rules 後一起 push

## 8. Deploy firestore rules（10 min）
- [ ] 用 firebase MCP `firebase_deploy({ only: 'firestore:rules' })` 或 CLI
- [ ] 確認 deploy 成功（response code）
- [ ] **deploy 完不能回頭**，務必前置驗證完整

## 9. Push main（5 min）
- [ ] 確認本地分支 commits 順序（1A→1B→1C→1D→1E→1F→1G）
- [ ] `git push origin <branch>:main`
- [ ] 等 Vercel 自動部署完成（dashboard 看 status ready）

## 10. Prod 真機驗收（60-90 min，Brain AI 跑）

詳見 `proposal.md` § 驗收標準。共 ~30 條 checklist，本 phase 任務只到「列清單」，實際驗收 Brain AI 自跑。

- [ ] 寫 `HANDOFF.md` 列完整 checklist + 失敗時的 rollback 步驟

## 11. 失敗回滾預備（5 min）
- [ ] 在 HANDOFF.md 寫：
  - Vercel rollback 步驟
  - firestore rules 回滾步驟（用 git history 抓舊版 rules）
  - 哪些 commit 可獨立 revert

## 12. commit + HANDOFF
- [ ] 寫 `openspec/changes/2026-05-21-vehicle-tag-system-e2e-launch/HANDOFF.md`
- [ ] 回報「Phase 1G 完工，prod deploy 完成；等 Brain AI 真機驗收。失敗的話按 HANDOFF.md rollback。」
