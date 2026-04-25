## Purpose

定義 `.claude/skills/` 下專案本地 skill 的內容分級規則、樣板規範橫幅格式、以及觸發 / 審計流程，確保 skill 內容與專案現況同步、觸發描述準確，並保留「啟用後端 / 資料庫時」的未來規範。

## Requirements

### Requirement: Skill 內容分級

`.claude/skills/` 下的每個 skill 檔案（`SKILL.md`、`items/*.md`、`references/*.md`）內容 SHALL 可被分類為以下三級之一：

- **可用（active）**：敘述的工具、檔案、元件在本專案中確實存在且可操作。
- **樣板規範（pending）**：敘述的是統一規範，但依賴的基礎設施（後端、資料庫、測試框架等）尚未初始化；此類檔案 MUST 在頂部標註「樣板規範」橫幅。
- **待修正（broken）**：敘述與專案狀況不符（錯誤工具名、不存在的元件、版本不一致等），MUST 立即修正。

#### Scenario: 分級明確

- **WHEN** 維護者開啟任一 skill 檔案
- **THEN** 檔案內容必須能對應到 active / pending / broken 其中一級，且 pending 級檔案頂部有統一格式的橫幅。

#### Scenario: broken 級必須修正

- **WHEN** 審計過程發現任一 skill 檔案屬於 broken 級
- **THEN** 對應 change 必須修正該檔案，使其降級為 active 或 pending。

### Requirement: MCP 工具名一致性

`debugging` 與 `testing` skill 的所有瀏覽器自動化相關敘述 SHALL 使用 Playwright MCP 的完整工具名（`mcp__plugin_playwright_playwright__browser_*`），不得使用舊版 Chrome DevTools MCP 名稱。

#### Scenario: 無舊工具名殘留

- **WHEN** 以 `get_page_snapshot`、`open_browser_url`、`click_element`、`fill_input_element`、`browser_subagent` 等舊工具名在 `.claude/skills/debugging/` 或 `.claude/skills/testing/` 內搜尋
- **THEN** 不應回傳任何實際操作敘述（僅允許在「已棄用對照表」之類的歷史說明中出現）。

### Requirement: 現況資料正確

skill 中所提到的專案內實體（Node 版本、路徑、元件名稱、Store 名稱、composable 名稱、全局工具方法）SHALL 與 `CLAUDE.md`、`package.json`、`app/` 實際內容一致。

#### Scenario: Node 版本一致

- **WHEN** 檢視 `deployment/items/dockerfile.md`
- **THEN** FROM 指令使用的 Node 版本必須是 `node:24.x-alpine` 系列（與現行 Dockerfile 一致），不得為 `node:20-alpine`。

#### Scenario: 元件清單真實

- **WHEN** 檢視 `element-plus-ui/references/global-components.md`
- **THEN** 所列元件必須能在 `app/components/` 下找到；不得列出專案中不存在的 `Ly*` 元件。

#### Scenario: Store 清單真實

- **WHEN** 檢視 `nuxt-frontend/references/store-overview.md`
- **THEN** 所列 store 必須能在 `app/stores/` 下找到；不得列出不存在的 store。

#### Scenario: 全局工具方法真實

- **WHEN** 檢視 `nuxt-frontend/items/global-utils.md`
- **THEN** 所列的 `$dayjs` / `$tool` / `$enum` 等方法必須能在 `app/utils/` 的對應檔案中找到定義；找不到的方法必須移除或標註為建議實作。

### Requirement: 樣板規範橫幅格式

凡涉及尚未初始化之後端/資料庫/測試框架的 skill 檔案 SHALL 在頂部（frontmatter 之後、第一個 H1 之前或之後但在任何內文之前）插入以下統一橫幅：

```markdown
> [!NOTE]
> **樣板規範**：本文件描述「啟用後端 / 資料庫時」適用的統一規範。
> 目前專案為前端快速樣板，`server/` 與 `prisma/` 尚未建立，請於初始化後端後再實際套用。
```

#### Scenario: 橫幅覆蓋完整

- **WHEN** 檢視 `nuxt-backend/` 與 `prisma-database/` 下所有檔案，以及 `testing/items/integration.md`、`testing/items/backend-testing.md`、`testing/references/test-accounts.md`、`deployment/items/env-config.md` 中後端/DB 相關段落
- **THEN** 這些檔案頂部必須有上述統一橫幅。

### Requirement: SKILL description 觸發準確

每個 skill 的 frontmatter `description` SHALL 在一句話內說明：(1) 技能主題、(2) 主要使用情境、(3) 若屬樣板規範則明示「本 skill 為樣板規範」。

#### Scenario: pending 級 skill 在 description 標註

- **WHEN** 檢視 `nuxt-backend/SKILL.md` 與 `prisma-database/SKILL.md` 的 frontmatter
- **THEN** `description` 欄位文字中必須含有「樣板規範」或等效語句，讓觸發前即可辨識。

### Requirement: 觸發測試紀錄

涉及 skill 修改的 change MUST 對每個受影響 skill 執行 1 組觸發測試（以 Skill 工具實際呼叫，或透過 `<system-reminder>` 觀察 description 更新），並將「PASS / 問題描述」寫入該 change 的 `validation.md`。

#### Scenario: 所有受影響 skill 皆有紀錄

- **WHEN** 檢視對應 change 的 `validation.md`
- **THEN** 檔案中必須包含所有受此 change 影響的 skill 的觸發結果。

### Requirement: 維護說明

`.claude/skills/README.md` SHALL 說明：skill 內容分級定義、樣板規範橫幅格式、以及「當專案啟用後端/資料庫後，應移除哪些橫幅」的檢查清單。

#### Scenario: README 存在且可導引

- **WHEN** 新維護者進入 `.claude/skills/` 目錄
- **THEN** `README.md` 應能在 30 秒內讓其理解「哪些 skill 現在可用、哪些是未來規範、何時該更新」。

### Requirement: 不變動非 skill 內容

以 skill 審計 / 修正為主的 change SHALL 僅修改 `.claude/skills/` 與 `openspec/` 目錄下的檔案，不得變更 `app/`、`server/`、`package.json`、`Dockerfile`、`CLAUDE.md` 等執行環境內容。

#### Scenario: diff 範圍受限

- **WHEN** 執行 `git diff` 檢視本次變更
- **THEN** 變動檔案僅限於 `.claude/skills/**` 與 `openspec/**`。
