---
name: "Knowledge Init"
description: 初始化或重新整理 .claude/knowledge 知識庫，與 CLAUDE.md 雙向同步
category: Workflow
tags: [workflow, knowledge, claude-md]
---

# 知識庫初始化 / 重整指令

> 一鍵建立或刷新 `.claude/knowledge/`，並與 CLAUDE.md 索引雙向同步。

---

## 核心目標

降低未來對話的上下文消耗。CLAUDE.md 維持輕量索引，每個 knowledge 檔案聚焦單一主題、可被「按需讀取」。

CLAUDE.md 的「## 知識庫」段落寫得很明確：

> 詳細業務規則與技術知識存放於 `.claude/knowledge/`，**按需讀取以減少上下文消耗**

本指令的所有判定（拆檔、合併、把某段移到 CLAUDE.md）都應該以「能否減少未來對話的上下文消耗」為唯一標準。

### 設計原則

1. **CLAUDE.md 是輕量索引，不是內容容器** — 只放索引表格 + 一行描述 + 閱讀時機
2. **每個 knowledge 檔案聚焦單一主題** — Claude 才能按閱讀時機只載入需要的那一份
3. **檔案職責不重疊** — 同一個事實只在一個檔案說一次，其他用 link 引用
4. **粒度與閱讀時機綁定** — 索引表格的「閱讀時機」一欄就是實質的路由規則

---

## 與 `/commit` 的分工

| 指令 | 時機 | 範圍 |
|------|------|------|
| `/knowledge:init` | 初始化 or 全面重整 | 掃描**整個 codebase + CLAUDE.md**，全面重建索引與檔案內容 |
| `/commit` | 每次 commit 時 | 只根據 `git diff` 的觸發類型做**局部更新**（觸發表見 [commit.md](../commit.md)）|

`/knowledge:init` 結束後，CLAUDE.md 的「最後更新時間」會被更新為今日；之後 `/commit` 會以這個時間點作為 `git log --since=...` 的基準，兩者自然銜接。

---

## 執行步驟

### Step 0: 執行前狀態檢查

```bash
git status --short
```

- 若有未提交變更，提示使用者「建議先 commit 或 stash 再執行，以便回滾」並等待確認
- 檢查 `openspec/changes/` 下是否有 in-progress change（非 archived），若有則列出名稱提醒：「這些變更可能尚未進主線，重整可能會掃到未完成內容」
- 兩項皆通過或使用者確認後才進入 Step 1

### Step 1: 偵測當前狀態

讀取 [CLAUDE.md](../../../CLAUDE.md)，依以下規則判定：

| CLAUDE.md 狀態 | 處理 |
|---------------|------|
| 不存在 | **中止**，提示使用者先建立專案的 CLAUDE.md |
| 存在但沒有「## 知識庫」段落 | 標記為「**需新增知識庫段落**」，後續 Step 5 會插入完整段落 |
| 存在且有「## 知識庫」段落 | 解析索引表格作為期望狀態 |

接著列出 `.claude/knowledge/` 下的現有檔案，決定執行模式：

- **A. 初始化模式**：`.claude/knowledge/` 不存在 / 為空，且 CLAUDE.md 沒有索引或索引為空
- **B. 刷新模式**：目錄存在，索引與檔案對得上
- **C. fix 模式**：目錄存在但索引與檔案有落差（多檔、少檔、命名不一致，或 CLAUDE.md 缺索引段落）

**升級狀態識別**：檢查 CLAUDE.md 末尾是否有結構版本標記：

```markdown
> 知識庫結構：fact-context-layered-v1
```

- **沒有此標記** → 視為「首次升級」，本次跑「安全子集」（見下方）
- **有此標記** → 走完整模式（事實/脈絡分層自動處理）

偵測為首次升級時，明文輸出：「⚠ 偵測為首次升級，本次只跑安全子集，現有 knowledge 檔案內容完全不會被動到。」

### Step 2: 配對引導（CLAUDE.md ↔ knowledge/）

將 CLAUDE.md 索引表每一列（檔案名、內容、閱讀時機）視為「期望狀態」，與 `.claude/knowledge/*.md` 實際檔案做 diff：

- 索引有但檔案缺 → 待建立
- 檔案有但索引缺 → 待補索引（**不自動刪檔**，列出請使用者決定：刪 / 改寫 / 保留為歷史脈絡）
- 雙方都有 → 進入 Step 3 做內容刷新

列出配對結果供使用者確認。

### Step 3: 掃描 codebase 取得事實來源

依每個 knowledge 檔案的主題，指定事實來源並讀取：

| 知識檔案 | 事實來源 |
|---------|---------|
| `modules.md` | `server/routes/nuxt-api/` 實際目錄與 `.get/.post/.put/.delete/.patch.ts` route handler 數 |
| `stores-and-globals.md` | `app/stores/`、`app/composables/`、`app/utils/` |
| `rbac-system.md` | `prisma/seed.ts`、`scripts/sync-rbac-permissions.ts`、`server/middleware/auth.ts` |
| `error-handling.md` | `server/utils/response.ts`、`server/plugins/error-handler.ts` |
| `deploy-and-migration.md` | `.github/workflows/`、`docker-compose.yml`、`Dockerfile` |
| `tech-decisions.md` | `package.json`、`nuxt.config.ts`、`prisma/schema.prisma` |
| `plan-rules.md` / `ct-payment-rules.md` / `ct-file-expiry.md` / `statistics-logic.md` / `payment-company-auto-creation.md` / `incident-rescue.md` | 對應 `server/routes/nuxt-api/` 子模組、`prisma/schema.prisma` 相關 model |
| `business-overview.md` | CLAUDE.md 的「專案簡介」+ `prisma/schema.prisma` 的 `CTShooting` / `Plan` model |

蒐集的事實用於下一步內容更新。

### Step 4: 建立或更新內容（事實/脈絡分層）

每個 knowledge 檔案的內容明文分成兩層：

| 層級 | 範圍 | init 模式行為 | 刷新模式行為 |
|------|------|--------------|-------------|
| **事實層** | 檔案數、目錄數、API 路徑、route handler 數、版本號、模組清單、`schema.prisma` 欄位、套件版本 | 從 codebase 計算後寫入 | **可自動覆蓋**為當前事實 |
| **脈絡層** | 業務原因、決策背景、踩雷紀錄、流程說明、為什麼這樣做、incident playbook | 建立空骨架 + TODO 標記等待人工填寫 | **永不自動覆蓋**；只能附加 `<!-- 事實層更新於 YYYY-MM-DD -->` 註記 |

**模式行為**：

- **初始化模式**：依照 Step 3 蒐集的事實，為每個 CLAUDE.md 索引列建立新檔案（H1 標題、表格、程式碼區塊、繁體中文）。脈絡層若無可參考來源，留 TODO 等使用者補
- **刷新模式**：只更新事實層；脈絡層整段保留。比對前先讀完整檔，識別出哪些段落屬於哪一層
- **fix 模式**：先補索引或補檔案讓雙邊一致，再進入刷新

**禁則**：

- 禁止建立 CLAUDE.md 索引中未列出的新主題檔案；若發現需要新主題，提示使用者並等待指示
- 禁止加入任何 emoji / README 類檔案

**特別保護清單**（整檔幾乎都是脈絡層，刷新模式僅可微調事實層數字）：

- [incident-rescue.md](../../knowledge/incident-rescue.md)
- [tech-decisions.md](../../knowledge/tech-decisions.md)
- [plan-rules.md](../../knowledge/plan-rules.md) 的「規則說明」段落

**首次升級的安全子集**：偵測到沒有 `> 知識庫結構：fact-context-layered-v1` 標記時，本步驟必須**跳過事實層自動覆蓋**：

- init 模式：可建立全新的缺失檔案（無人工內容可破壞）
- 對既有檔案：**完全不動**

### Step 5: 同步 CLAUDE.md（保持輕量）

#### 新增「## 知識庫」段落（若 Step 1 標記為需新增）

在 CLAUDE.md 末尾「最後更新時間」之前**插入完整段落**：

```markdown
## 知識庫

詳細業務規則與技術知識存放於 `.claude/knowledge/`，按需讀取以減少上下文消耗：

| 文件 | 內容 | 建議閱讀時機 |
|------|------|-------------|
| [檔名.md](.claude/knowledge/檔名.md) | 一行內容描述 | 何時應該讀這份 |
```

逐列填入 Step 4 建立的所有 knowledge 檔案。

#### 既有「## 知識庫」段落

僅更新有漂移的索引表格列。每列只放：檔案連結 / 一行內容描述 / 閱讀時機。

#### 更新最後更新時間

```bash
date +%Y-%m-%d
```

更新 CLAUDE.md 末尾「最後更新時間」為今日；若末尾沒有此行，補上 `> 最後更新時間：YYYY-MM-DD`。

#### 嚴格禁則

- **不動 CLAUDE.md 的其他段落**（專案簡介、技術棧、架構總覽、開發入口慣例）除非使用者明確要求
- **嚴禁**把 knowledge 檔案的詳細內容搬進 CLAUDE.md — 違反「按需讀取以減少上下文消耗」的設計原則
- 若發現 CLAUDE.md 某段已經膨脹到超過「索引描述」的程度，提示使用者並建議拆出獨立 knowledge 檔案

#### 閱讀時機品質檢查

逐列檢視「建議閱讀時機」欄位，列出寫得太籠統的列，提示使用者調整。閱讀時機是 Claude 路由的關鍵 — 不準的話會導致「按需讀取」失效、整批檔案被誤讀。

**檢查標準**：好的閱讀時機應同時包含「動作」+「對象/範圍」：

- ✗ 不夠精準：「處理付款相關時」、「處理 XX 時」
- ✓ 夠精準：「處理 CT 付款時」、「撰寫後端 API、處理 transaction 錯誤時」

### Step 6: 產出報告

摘要列出：

- 模式（init / refresh / fix）+ 是否走「首次升級安全子集」
- 建立的新檔案
- 更新的檔案與主要變更點（**區分事實層 vs 脈絡層**）
- CLAUDE.md 是否調整過索引
- 索引漂移而暫未處理的項目（例如：使用者待決定刪/保留的舊檔）
- 閱讀時機品質檢查的「待調整」清單
- **下一步建議**：
  - 一般情況：執行 `/commit` 來提交這次重整
  - 首次升級剛跑完：請人工檢查 `.claude/knowledge/` 內容是否符合事實/脈絡分層的預期，若 OK 請在 CLAUDE.md 加入 `> 知識庫結構：fact-context-layered-v1` 標記，後續執行才會開放完整模式

---

## 內容歸屬判定

`/knowledge:init` 遵循與 `/commit` **同一套**內容歸屬判定樹（見 [commit.md](../commit.md) 的「內容歸屬判定」章節），避免兩份規則同步漂移。

---

## 護欄

- 全程只讀程式碼、只寫 `.claude/knowledge/` 與 CLAUDE.md
- 不執行 `git commit`、`git push` 或任何會動到遠端的指令（提交由使用者用 `/commit` 另行處理）
- 若偵測到 `.claude/knowledge/` 下有非 `.md` 檔案或子目錄，先向使用者確認再處理
- 若 CLAUDE.md 不存在，直接中止並提示使用者先建立專案的 CLAUDE.md
- 若 CLAUDE.md 存在但缺「## 知識庫」段落，**主動新增**該段落（init 模式的關鍵職責之一）

### 上下文友善原則（最重要）

- 單一 knowledge 檔案若膨脹過大（建議 > 300 行或主題明顯混雜），主動建議拆檔
- 多個檔案若內容大量重疊，主動建議合併或抽出共同段落、用 link 引用
- 任何會讓 CLAUDE.md 變肥的修改都要拒絕 — CLAUDE.md 是路由器，不是內容
