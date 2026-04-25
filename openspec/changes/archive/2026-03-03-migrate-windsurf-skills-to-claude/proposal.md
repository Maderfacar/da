## Why

目前專案的 AI 技能知識庫（skills）和工作流程（workflows）僅存在於 `.windsurf/` 目錄下，無法被 Claude Code 讀取與使用。需要將這些知識遷移至 `.claude/` 目錄，並調整格式以符合 Claude Code 的使用方式，讓開發團隊在使用 Claude Code 時也能享有相同的知識引導能力。

## What Changes

- 將 8 個 skills 從 `.windsurf/skills/` 遷移到 `.claude/skills/`：debugging、deployment、element-plus-ui、nuxt-backend、nuxt-frontend、prisma-database、project-knowledge、testing
- 將 2 個 workflows 從 `.windsurf/workflows/` 遷移到 `.claude/commands/`：git-commit、project-init
- 調整 SKILL.md 格式：移除 Windsurf 專有的 YAML front matter，改為 Claude Code 可用的 Markdown 指令格式
- 調整 workflows 格式為 Claude Code commands 格式（純 Markdown prompt）
- 保留所有 items/、references/、scripts/ 子目錄內容，確保知識完整遷移

## Capabilities

### New Capabilities

- `skill-migration`: 將 8 個 Windsurf skills 目錄結構與內容遷移至 `.claude/skills/`，調整格式為 Claude Code 可讀取的純 Markdown 格式
- `workflow-migration`: 將 git-commit 和 project-init workflows 遷移至 `.claude/commands/`，轉換為 Claude Code slash command 格式

### Modified Capabilities

（無現有 capabilities 需要修改）

## Impact

- **新增檔案**：`.claude/skills/` 下新增 8 個 skill 目錄（含 items/、references/、scripts/ 子目錄，約 50+ 個 Markdown 檔案）
- **新增檔案**：`.claude/commands/` 下新增 git-commit.md、project-init.md
- **不影響**：`.windsurf/` 目錄保持不變，兩套系統並存
- **不影響**：現有 `.claude/commands/opsx/` 和 `.claude/skills/openspec-*` 不受影響
