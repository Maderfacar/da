---
name: testing
description: |
  測試驗證技能。包含前端 UI 測試（Playwright MCP）、
  後端 API 測試（樣板規範）、整合測試（樣板規範）。
  驗證功能正確性時使用此技能。
---

# 測試驗證技能

> 前端 UI 測試、後端 API 測試、整合測試

## 快速導航

| 文件 | 級別 | 說明 |
|------|------|------|
| [frontend-testing.md](items/frontend-testing.md) | active | 前端 UI 測試流程（Playwright MCP） |
| [browser-testing.md](items/browser-testing.md) | active | 瀏覽器自動化 |
| [backend-testing.md](items/backend-testing.md) | pending | 後端 API 測試（啟用後端後適用） |
| [integration.md](items/integration.md) | pending | 整合測試（啟用後端後適用） |

> 本專案目前**未配置測試框架**（無 Vitest / Jest）。下述前端測試流程以 Playwright MCP 為主；後端與整合測試規範僅為樣板，待後端初始化後套用。

## 測試流程速查

### 前端測試（Playwright MCP）

```
1. 開啟頁面：browser_navigate(url)
2. 取得快照：browser_snapshot → 得到元素 ref
3. 執行操作：browser_click / browser_type / browser_select_option
4. 等待狀態：browser_wait_for
5. 驗證結果：browser_snapshot 確認 UI 變化
6. 檢查 Console / Network：browser_console_messages / browser_network_requests
```

工具完整名稱為 `mcp__plugin_playwright_playwright__browser_*`。

### 後端測試（樣板規範）

```
1. 準備測試資料
2. 呼叫 API 端點（curl / fetch）
3. 驗證響應格式與 status.code
4. 確認資料庫變更
```

## 測試帳號

> [!NOTE]
> 本專案目前無後端、無 `prisma/seed.ts`。測試帳號規範僅為樣板；待 seed 建立後補上實際帳號。

**建議的帳號結構**：

| 角色 | 用途 |
|------|------|
| 超級管理員 | 全功能測試 |
| 公司管理員 | 權限測試 |
| 一般使用者 | 一般操作測試 |

## 測試優先級

| 優先級 | 類型 | 說明 |
|--------|------|------|
| P0 | 核心流程 | 登入、主要 CRUD |
| P1 | 業務邏輯 | 付款、狀態轉換 |
| P2 | 邊界情況 | 空值、錯誤處理 |
| P3 | UI/UX | 樣式、響應式 |

## 相關技能

- [debugging](../debugging/SKILL.md) - 測試發現問題時調試
- [nuxt-frontend](../nuxt-frontend/SKILL.md) - 前端相關
- [nuxt-backend](../nuxt-backend/SKILL.md) - 後端相關（樣板規範）
