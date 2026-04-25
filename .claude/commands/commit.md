---
name: "Commit"
description: Git 提交流程 + 知識庫維護
category: Workflow
tags: [workflow, git, knowledge]
---

# Git 提交流程

> 提交變更並維護專案知識庫（`CLAUDE.md` + `.claude/knowledge/`）。

---

## 執行步驟

### Step 1: 檢查狀態與變更內容

```bash
git status
git diff
```

### Step 2: 版本號累加

讀取 `version.ts`，將語意化版本（`MAJOR.MINOR.PATCH`）的 **PATCH**（最小版本號）+1 後寫回。

- 範例：`0.0.1` → `0.0.2`
- 僅累加 patch，不動 major/minor
- 此步驟必須在 `git add` 之前完成，確保版本變更一併納入本次 commit

### Step 3: 知識庫更新檢查

根據 `git diff` 的變更內容分析是否需要更新知識庫：

#### 觸發條件

| 變更類型 | 更新目標 | 動作 |
|----------|----------|------|
| 新增功能模組 | `.claude/knowledge/modules.md` | 添加模組描述 |
| 目錄結構變更 | `CLAUDE.md` 架構總覽 | 更新結構描述 |
| 技術棧/依賴升級 | `.claude/knowledge/tech-decisions.md` | 記錄決策 |
| 重大架構決策 | `.claude/knowledge/tech-decisions.md` | 記錄決策與原因 |
| 新的業務流程 | `.claude/knowledge/` 新增文件 | 新增業務規則文件 |
| 業務邏輯變更 | `.claude/knowledge/` 對應文件 | 更新規則 |
| 新增知識文件 | `CLAUDE.md` 知識庫索引 | 同步更新索引表格 |

若需更新，立即執行對應更新。

#### CLAUDE.md 差異比對更新

每次更新 `CLAUDE.md` 時，執行以下流程：

1. 讀取 `CLAUDE.md` 末尾的「最後更新時間」
2. 使用 `git log --since="<最後更新時間>" --oneline` 查看自上次更新以來的所有 commit
3. 根據這些 commit 的變更內容，整理需要反映到 `CLAUDE.md` 的更新（如新增模組、結構變更、技術棧調整等）
4. 更新完成後，將末尾的「最後更新時間」更新為今天日期

### Step 4: 暫存所有變更

```bash
git add .
```

### Step 5: 檢視變更

```bash
git diff --staged --stat
```

### Step 6: 生成 Commit 訊息

根據 `git diff --staged` 生成 Conventional Commits 訊息：

**格式**：
```
<type>(<scope>): <描述>

[可選 body]
```

**類型**：
- `feat`: 新功能
- `fix`: Bug 修復
- `docs`: 文件更新
- `style`: 程式碼格式
- `refactor`: 重構
- `test`: 測試
- `chore`: 雜項

**語言**：繁體中文

### Step 7: 執行提交

```bash
git commit -m "你的提交訊息"
```

---

## 內容歸屬判定

```
問：這個知識放哪裡？

├─ 是核心架構/開發指令/技術棧？  → CLAUDE.md（直接寫入）
├─ 是開發慣例/入口點？           → CLAUDE.md 開發入口慣例區塊
├─ 是業務規則/領域知識？         → .claude/knowledge/{描述性名稱}.md
├─ 是技術決策？                  → .claude/knowledge/tech-decisions.md
├─ 是功能模組描述？              → .claude/knowledge/modules.md
├─ 可跨專案複用？                → .claude/skills/
└─ 以上皆非？                    → 可能不需要記錄
```
