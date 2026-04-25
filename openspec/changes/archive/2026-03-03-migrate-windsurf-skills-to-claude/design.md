## Context

專案目前有兩套 AI 輔助系統：
- `.windsurf/skills/`：8 個知識技能（debugging、deployment、element-plus-ui、nuxt-backend、nuxt-frontend、prisma-database、project-knowledge、testing），每個包含 SKILL.md 主檔 + items/ 詳細文件 + references/ 參考資料 + scripts/ 腳本
- `.windsurf/workflows/`：工作流程定義（git-commit、project-init）

現有 `.claude/` 結構：
- `.claude/skills/openspec-*/SKILL.md`：OpenSpec 自動生成的技能，使用 YAML front matter（name、description、license、compatibility、metadata）
- `.claude/commands/opsx/*.md`：OpenSpec 相關的 slash commands，使用 YAML front matter（name、description、category、tags）

## Goals / Non-Goals

**Goals:**
- 將 8 個 Windsurf skills 完整遷移至 `.claude/skills/`，保留所有子目錄結構
- 將 2 個 workflows 遷移至 `.claude/commands/`，成為 Claude Code slash commands
- 調整 SKILL.md 的 YAML front matter 格式以符合 Claude Code 規範
- 確保所有知識內容（items/、references/、scripts/）完整保留
- 兩套系統可並存，不影響現有 `.windsurf/` 目錄

**Non-Goals:**
- 不修改 skills 的實質知識內容（僅調整格式殼層）
- 不合併或重組現有的 OpenSpec 相關 skills
- 不刪除 `.windsurf/` 目錄下的原始檔案
- 不建立自動同步機制（兩套系統獨立維護）

## Decisions

### 1. SKILL.md 格式轉換

**決定**：採用 Claude Code 的 YAML front matter 格式，保留 Windsurf 版本的內容主體。

```yaml
---
name: skill-name
description: |
  技能說明
---
```

**理由**：
- Claude Code skills 使用此格式識別與載入技能
- 保持與現有 openspec-* skills 一致
- 不加入 license/metadata 等額外欄位，保持簡潔（那些是 OpenSpec 自動生成的）

**替代方案**：完全移除 YAML front matter，僅用純 Markdown → 放棄，因為 Claude Code 需要 front matter 來識別技能

### 2. 目錄結構保持不變

**決定**：維持 `SKILL.md` + `items/` + `references/` + `scripts/` 的子目錄結構。

**理由**：
- 結構清晰，SKILL.md 作為入口索引，子檔案提供詳細內容
- Claude Code 可透過 SKILL.md 中的連結導航到子檔案
- 避免因合併檔案導致單一檔案過大

### 3. Workflow 轉換為 Commands

**決定**：將 workflows 遷移至 `.claude/commands/` 目錄，使用 Claude Code command 格式。

```yaml
---
name: "命令名稱"
description: 命令說明
category: Workflow
tags: [workflow]
---
```

**理由**：
- Claude Code 使用 `.claude/commands/` 作為 slash command 來源
- 用戶可透過 `/command-name` 直接調用
- 格式與現有 opsx/ commands 一致

### 4. 檔案內部連結調整

**決定**：保留相對路徑連結，僅確保路徑在新目錄結構中仍然有效。

**理由**：
- 所有 `items/`、`references/` 連結使用相對路徑，遷移後路徑不變
- 跨 skill 引用（如 `../other-skill/SKILL.md`）在新目錄中同樣有效

## Risks / Trade-offs

- **[風險] 兩套系統內容分歧** → 短期可接受，後續如需要可手動同步或選擇棄用其中一套
- **[風險] Claude Code 可能不會主動讀取 skills 子目錄** → SKILL.md 中的連結提供導航，Claude Code 會按需讀取引用的檔案
- **[取捨] 不自動同步** → 降低複雜度，但需手動維護兩套檔案
