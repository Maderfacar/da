# 測試策略 (Testing Strategy)

> ⚠️ 注意：本專案目前（Stage 1）**未配置測試框架**。測試工具將在 Stage 6 安裝，需先更新 tech-stack.md 並經人類確認。

## 1. 測試原則

- 重要功能先思考如何測試，再開始實作
- 行動版優先：所有測試必須涵蓋手機尺寸
- Dark Mode 測試：重要元件需同時測試 Light / Dark 兩種模式
- Stage Gate：每個 Stage 結束前必須通過相關測試

## 2. 計劃採用的測試工具

| 測試類型 | 工具 | 負責範圍 | 執行頻率 |
|---------|------|---------|--------|
| Unit Test | Vitest + @vue/test-utils | 單一元件、工具函式 | 每次 commit |
| Integration Test | Vitest + MSW | API 呼叫、Pinia 狀態 | Stage 4 後 |
| E2E Test | Playwright | 完整使用者流程 | Stage 6 |

## 3. 測試覆蓋率目標

- 整體覆蓋率：≥ 70%
- 關鍵路徑（訂單建立、計價計算、登入流程）：必須 100%

## 4. 各 Stage 測試要求

**Stage 2**：每個 Ui 元件必須有基本渲染測試  
**Stage 3**：測試頁面正確渲染與路由切換  
**Stage 4**：測試表單驗證、計價邏輯、狀態管理  
**Stage 5**：MSW 模擬 API + Nitro 端點測試  
**Stage 6**：完整 E2E 測試 + 行動版測試

## 5. 執行指令（Stage 6 後生效）

```bash
pnpm test          # 單元測試
pnpm test:coverage # 測試覆蓋率
pnpm test:e2e      # E2E 測試
```

---

**版本紀錄**
- 版本：v1.1（加入目前無測試框架的說明）
- 更新日期：2026/04/26
