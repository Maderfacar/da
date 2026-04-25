# Git 工作流程規範 (Git Workflow)

## 1. 分支策略

- **main**：正式環境分支，只能透過 Pull Request 合併
- **feature/xxx**：新功能開發分支
- **fix/xxx**：Bug 修復分支
- **chore/xxx**：維護工作（設定、文件更新等）

命名使用小寫英文 + 連字符（-）。

## 2. Commit 規範（Conventional Commits）

格式：`<type>(<scope>): <描述（繁體中文）>`

```
feat(passenger): 新增訂車表單頁面
fix(driver): 修正司機位置更新錯誤
chore(docs): 更新 tasks.md
style(ui): 調整 Button 元件圓角
refactor: 重構訂單計價邏輯
```

常用 type：`feat` / `fix` / `chore` / `style` / `refactor` / `docs`

## 3. 開發工作流程

1. 從 `main` 分支拉出新分支
2. 按照小步驟開發（每次最多影響少量檔案）
3. 每完成一個子任務：更新 tasks.md → commit → push
4. 功能完成後開 Pull Request

## 4. 禁止事項

- 禁止直接在 `main` 分支修改程式碼
- 禁止使用模糊 commit 訊息（如 "update"、"fixed"）
- 禁止不更新 tasks.md 就 commit

## 5. Stage Gate 要求

每個 Stage 結束時：全部變更 commit → 更新 tasks.md → `pnpm build` 通過 → 人類審核

---

**版本紀錄**
- 版本：v1.1（pnpm → npm，繁體中文 commit message）
- 更新日期：2026/04/26
