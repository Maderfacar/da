## Why

`.claude/skills/` 下的 7 個專案本地 skill（`nuxt-frontend`、`nuxt-backend`、`prisma-database`、`element-plus-ui`、`debugging`、`testing`、`deployment`）部分內容與目前專案實際狀況不符：本專案是一個「**Nuxt 4 前端快速樣板**」，目前僅包含前端程式碼（`app/`），尚未初始化 `server/`、`prisma/`、測試框架等後端/資料庫基礎設施。現有 skill 中有多處引用不存在的檔案、過時的 MCP 工具名（例如舊版 Chrome DevTools MCP 指令，而本專案實際已切換到 Playwright MCP）、不存在的元件（`Ly*` 系列）、與錯誤的 Node 版本號，導致 Claude 在觸發這些 skill 時會給出與專案無法對應的指引。

## What Changes

- **審計並分類 7 個 skill 的內容**：將每個檔案的敘述拆為「專案已存在並適用」「樣板規範但尚未實作（未來啟用）」「錯誤或過時需修正」三類。
- **修正 MCP 工具名稱**：`debugging`、`testing` 兩個 skill 內所有舊版 Chrome DevTools MCP 指令改為 Playwright MCP 對應工具名（`browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` 等）。
- **修正過時或錯誤資訊**：
  - `deployment/items/dockerfile.md` Node 版本由 20 更新為 24.11（與現行 `Dockerfile` 一致）。
  - `deployment/items/railway.md` 移除 `.windsurf/...` 路徑殘留。
  - `nuxt-frontend/references/store-overview.md` 僅保留實際存在的 5 個 store。
  - `element-plus-ui/references/global-components.md` 移除不存在的 `Ly*` 元件清單，改列實際存在的 `*-plus` 封裝元件。
  - `nuxt-frontend/items/global-utils.md` `$dayjs` 僅保留實際擁有的 `FormatDate` 與 dayjs 原生方法。
- **標註尚未實作的規範**：`nuxt-backend`、`prisma-database` 兩個 skill 在 `SKILL.md` 開頭加入「樣板規範：啟用後端/資料庫時適用」橫幅；`testing/integration.md`、`testing/references/test-accounts.md`、`deployment/items/env-config.md` 中涉及後端/DB 的內容統一加上同一橫幅，保留規範但明確區分「現況」與「未來」。
- **修正交叉引用**：`SKILL.md` 中對其他 skill 的相對連結統一指向對方的 `SKILL.md`；對知識庫的引用改為 `.claude/knowledge/*.md`。
- **新增一份 skill 健檢指引**：於 `.claude/skills/README.md` 簡要說明 skill 的內容等級分類（可用 / 樣板規範 / 待修正）與維護流程，避免未來再次累積過時內容。
- **實測觸發情境**：每個 skill 依 `description` 擬定 1 組觸發 prompt，實際以 Skill 工具呼叫確認能載入，並在 `openspec/changes/audit-project-skills/validation.md` 記錄結果（作為 verify 階段依據）。

## Capabilities

### New Capabilities

- `skill-audit`: 定義專案本地 skill 的內容分類規則、觸發測試流程、以及修正優先級，讓未來新增或維護 skill 有一致的驗收標準。

### Modified Capabilities

<!-- 本專案目前尚無既有 spec，故無修改項目 -->

## Impact

- 影響檔案：`.claude/skills/{nuxt-frontend,nuxt-backend,prisma-database,element-plus-ui,debugging,testing,deployment}/` 下所有 `SKILL.md`、`items/*.md`、`references/*.md`。
- 新增檔案：`.claude/skills/README.md`、`openspec/changes/audit-project-skills/validation.md`、`openspec/specs/skill-audit/spec.md`。
- 不影響實際執行環境（`app/`、`Dockerfile`、`package.json` 不更動）。
- 不影響 CI/CD；僅影響 Claude Code 在本專案內觸發 skill 時得到的指引內容。
- 排除範圍：`openspec-*` 系列 skill（依需求排除）。
