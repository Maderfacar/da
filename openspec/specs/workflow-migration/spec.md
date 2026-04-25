## ADDED Requirements

### Requirement: Workflow 遷移為 Claude Commands
系統 SHALL 將 `.windsurf/workflows/git-commit.md` 和 `.windsurf/workflows/project-init.md` 遷移至 `.claude/commands/` 目錄，轉換為 Claude Code slash command 格式。

#### Scenario: Command 檔案建立
- **WHEN** 遷移完成後檢查 `.claude/commands/` 目錄
- **THEN** 存在 `git-commit.md` 和 `project-init.md` 兩個檔案

### Requirement: Command YAML Front Matter 格式
每個 command 檔案 MUST 使用 Claude Code command 格式的 YAML front matter，包含 name、description 欄位。

#### Scenario: YAML front matter 格式正確
- **WHEN** 讀取遷移後的 `.claude/commands/git-commit.md`
- **THEN** 檔案開頭包含有效的 YAML front matter，含 `name` 和 `description` 欄位

### Requirement: Workflow 內容調整
遷移後的 command 檔案 MUST 保留原始 workflow 的步驟流程和指令內容。可進行必要的格式調整（如移除 Windsurf 專有語法），但步驟邏輯 MUST 保持一致。

#### Scenario: 步驟流程完整保留
- **WHEN** 比較遷移前的 workflow 與遷移後的 command 內容
- **THEN** 所有步驟流程、bash 指令、決策樹邏輯均完整保留

### Requirement: 不影響現有 Commands
遷移過程 MUST NOT 修改或刪除 `.claude/commands/opsx/` 下已存在的 command 檔案。

#### Scenario: 現有 OpenSpec commands 不受影響
- **WHEN** 遷移完成後檢查 `.claude/commands/opsx/`
- **THEN** 所有現有 command 檔案的內容與遷移前完全一致
