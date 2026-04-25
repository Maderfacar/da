## Context

本專案 `.claude/skills/` 下的專案本地 skill 是從舊版 Windsurf / Chrome DevTools MCP 工具鏈延伸而來，但本專案已完成以下遷移：

- 開發環境：Node 24.11+，非 Node 20。
- 瀏覽器自動化 MCP：已切換到 `plugin:playwright`（工具名前綴 `mcp__plugin_playwright_playwright__browser_*`），不再使用舊的 Chrome DevTools MCP。
- 專案型態：**前端快速樣板**，目前不包含 `server/`、`prisma/`、測試框架；後端與資料庫規範僅為「將來啟用時的統一規範」。
- 彈窗系統：專案已有 `$open`、`UseAsk()`、`app/components/open/{dialog,drawer,group}`；但沒有 `Ly*` 系列元件。
- 全局工具實測：`$dayjs` 目前僅導出 `FormatDate` + 原生 dayjs 方法，舊 skill 提及的 `CreateCalendar` 等方法不存在。

這些差距讓 skill 在觸發時會給出「找不到檔案 / 工具名錯誤 / 元件不存在」的指引，降低信任度。本次變更的目的就是補齊這段差距，並建立未來維護 skill 時的一致標準。

## Goals / Non-Goals

**Goals:**
- 讓 7 個 skill 在本專案觸發時，內容皆與實際可用資源一致。
- 清楚標示「專案已實作」與「樣板規範（啟用後端/資料庫時才適用）」的分界，避免 Claude 把未來規範當成現況。
- 修正所有錯誤的 MCP 工具名、Node 版本、路徑與元件引用。
- 建立一份 `.claude/skills/README.md` 說明 skill 內容分級與維護流程。
- 每個 skill 至少執行 1 次觸發測試並留下紀錄。

**Non-Goals:**
- 不重寫 skill 的整體架構或合併 skill；保留既有的 7 個 skill 與其 item 結構。
- 不新增 `server/`、`prisma/`、測試框架或任何實際的後端/資料庫程式碼。
- 不調整 `openspec-*` 系列 skill。
- 不動 CLAUDE.md 的既有規範（knowledge 僅為補充，不再複製一份到 skill）。

## Decisions

### 決策 1：採「修正 + 分級標註」而非「刪除」未實作規範

**選擇**：對 `nuxt-backend`、`prisma-database` 以及 `testing/integration.md` 等涉及尚未實作的後端/資料庫內容，不刪除、不改寫成純前端，而是在每個相關檔案頂部加入「樣板規範：啟用後端 / 資料庫時適用」橫幅（繁中）。

**替代方案**：
- (A) 刪除所有未實作的規範：會遺失「未來加後端時該怎麼寫」的集中知識，且與 CLAUDE.md 原設計背離。
- (B) 依條件動態載入 skill：Claude Code skill 目前無原生條件分支；做不到。

**理由**：CLAUDE.md 本身就把後端規範納入樣板，是 feature（不是 bug）。分級標註能同時滿足「現況正確」與「保留未來指南」。

### 決策 2：MCP 工具名改用完整命名空間

所有 `debugging`、`testing` 內提到的 MCP 工具，一律改為 `mcp__plugin_playwright_playwright__browser_*` 的完整命名（例如 `browser_snapshot`、`browser_navigate`、`browser_click`、`browser_type`、`browser_wait_for`、`browser_evaluate`）。

**理由**：在 skill 文件中使用完整工具名，可讓 Claude 直接複製呼叫，不必額外猜測。

### 決策 3：橫幅統一格式

在需要標註的檔案頂部插入以下 GFM 提示框：

```markdown
> [!NOTE]
> **樣板規範**：本文件描述「啟用後端 / 資料庫時」適用的統一規範。
> 目前專案為前端快速樣板，`server/` 與 `prisma/` 尚未建立，請於初始化後端後再實際套用。
```

**理由**：統一格式讓 Claude 讀第一眼就能辨識「現況 vs 未來」，也便於將來移除標註。

### 決策 4：觸發測試放在 validation.md

每個 skill 以一組觸發 prompt 實測 Skill 工具呼叫，結果（PASS / 內容問題）寫入 `openspec/changes/audit-project-skills/validation.md`。archive 時此檔案會被清理，但作為 verify 階段依據。

**替代方案**：直接改寫 description 後不測 → 無法證明「正確的功用」這一需求已達成。

### 決策 5：保留 `prisma-database` skill 名稱

即使 Prisma 尚未安裝，仍保留該 skill；因為一旦啟用後端就會用 Prisma，且 CLAUDE.md 規範中的空值標準已從這裡引用。只需加橫幅標示現況。

## Risks / Trade-offs

- **[風險]** 標註「樣板規範」後，Claude 仍可能忽視橫幅而套用到實際程式碼 → **緩解**：description 欄位也補一句「本 skill 為樣板規範，專案尚未啟用後端」，讓觸發前就看到。
- **[風險]** 專案真的加入後端時，需同步移除所有橫幅 → **緩解**：在 `.claude/skills/README.md` 的維護流程中列出此檢查點。
- **[取捨]** 觸發測試在本次 change 檔案中留下 `validation.md`，archive 時會一併搬移 → 接受；這是 verify 的證據。

## Migration Plan

1. 建立 `.claude/skills/README.md`（skill 內容分級規則）。
2. 依 specs 修正 7 個 skill 的檔案（先 debugging / testing / deployment → 再 nuxt-backend / prisma-database → 最後 nuxt-frontend / element-plus-ui）。
3. 建立 `openspec/changes/audit-project-skills/validation.md` 並逐一觸發測試。
4. `openspec validate audit-project-skills` + verify skill 通過後歸檔。
5. 無回滾需求：本次變更只動 `.claude/` 目錄，不影響執行環境；若有誤可直接 revert commit。

## Open Questions

- 沒有尚待釐清的問題；需求方（使用者）已確認範圍（僅 7 個本地 skill）、檢查方式（內容審查 + 觸發測試）、產出（直接修正）、依據（本資料夾）。
