## ADDED Requirements

### Requirement: Skills 目錄結構遷移
系統 SHALL 將以下 8 個 skill 目錄從 `.windsurf/skills/` 複製到 `.claude/skills/`：debugging、deployment、element-plus-ui、nuxt-backend、nuxt-frontend、prisma-database、project-knowledge、testing。每個 skill 目錄 MUST 包含完整的子目錄結構（items/、references/、scripts/）。

#### Scenario: 完整目錄結構遷移
- **WHEN** 遷移完成後檢查 `.claude/skills/` 目錄
- **THEN** 8 個 skill 目錄均存在，且每個目錄的子檔案數量與 `.windsurf/skills/` 對應目錄一致

### Requirement: SKILL.md 格式轉換
每個 skill 的 SKILL.md 檔案 MUST 使用 Claude Code 格式的 YAML front matter（包含 name 和 description 欄位）。檔案內容主體（快速導航、核心規則、相關技能）MUST 保持不變。

#### Scenario: YAML front matter 格式正確
- **WHEN** 讀取任一遷移後的 `.claude/skills/<name>/SKILL.md`
- **THEN** 檔案開頭包含有效的 YAML front matter，含 `name` 和 `description` 欄位，不含 Windsurf 專有欄位

#### Scenario: 內容主體完整保留
- **WHEN** 比較遷移前後的 SKILL.md 內容主體（YAML front matter 以下部分）
- **THEN** 核心規則、導航連結、程式碼範例等內容完全一致

### Requirement: Items 和 References 檔案完整複製
skill 下的 `items/`、`references/`、`scripts/` 目錄中的所有 .md 和 .sh 檔案 MUST 原封不動複製，不做任何格式修改。

#### Scenario: 子檔案內容完整
- **WHEN** 比較 `.windsurf/skills/<name>/items/` 與 `.claude/skills/<name>/items/` 中的對應檔案
- **THEN** 檔案內容完全相同（byte-level identical）

### Requirement: 不影響現有 Claude Skills
遷移過程 MUST NOT 修改或刪除 `.claude/skills/` 下已存在的 openspec-* 目錄。

#### Scenario: 現有 OpenSpec skills 不受影響
- **WHEN** 遷移完成後檢查 `.claude/skills/openspec-*/SKILL.md`
- **THEN** 所有現有 OpenSpec skill 檔案的內容與遷移前完全一致

### Requirement: 不影響 Windsurf 原始檔案
遷移過程 MUST NOT 修改或刪除 `.windsurf/skills/` 下的任何檔案。

#### Scenario: Windsurf 原始檔案保持不變
- **WHEN** 遷移完成後檢查 `.windsurf/skills/`
- **THEN** 所有原始 skill 檔案的內容與遷移前完全一致
