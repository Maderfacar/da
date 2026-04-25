# 專案本地 Skill 維護指南

`.claude/skills/` 下的專案本地 skill 分為兩類：**專案自訂**（本目錄）與 **OpenSpec 工作流**（`openspec-*`）。OpenSpec 系列由 `openspec` CLI 管理，不在本指南範圍內。

本指南說明「專案自訂 skill」的內容分級、維護規則，以及當專案啟用後端 / 資料庫時應移除哪些樣板規範橫幅。

---

## 內容分級

| 級別 | 定義 | 行為 |
|------|------|------|
| **active（可用）** | 敘述的工具、檔案、元件在本專案**確實存在且可操作** | 無需額外標註 |
| **pending（樣板規範）** | 描述「將來啟用某功能時」的統一規範，目前依賴的基礎設施（後端、資料庫、測試框架等）**尚未初始化** | 檔案頂部必須加「樣板規範橫幅」 |
| **broken（待修正）** | 敘述與專案狀況不符（錯誤工具名、不存在的元件、錯誤版本） | **必須立即修正**成 active 或 pending |

## 樣板規範橫幅

pending 級檔案必須在頂部（H1 之後、首段內文之前）插入以下橫幅：

```markdown
> [!NOTE]
> **樣板規範**：本文件描述「啟用後端 / 資料庫時」適用的統一規範。
> 目前專案為前端快速樣板，`server/` 與 `prisma/` 尚未建立，請於初始化後端後再實際套用。
```

pending 級 skill 的 `SKILL.md` frontmatter `description` 中亦應含「樣板規範」字樣，使 Claude 在觸發前即可辨識。

---

## 目前各 skill 級別快照

| Skill | 級別 | 備註 |
|-------|------|------|
| `nuxt-frontend` | active | 對應 `app/` 既有程式碼 |
| `element-plus-ui` | active | Element Plus 已安裝可用 |
| `debugging` | active | 使用 Playwright MCP |
| `deployment` | 混合 | Dockerfile 為 active；含 DB 變數的段落為 pending |
| `testing` | 混合 | 前端 UI 測試為 active；後端 / 整合測試為 pending |
| `nuxt-backend` | pending | `server/` 尚未建立 |
| `prisma-database` | pending | Prisma 尚未安裝 |

---

## 啟用後端 / 資料庫時的清理清單

當專案實際新增 `server/`、`prisma/` 等基礎設施後，依序執行：

1. **nuxt-backend**：移除 `SKILL.md` 與所有 `items/*.md`、`references/*.md` 的樣板規範橫幅；`description` 去掉「樣板規範」字樣。
2. **prisma-database**：同上；並檢查 `items/null-handling.md` 的範例是否與實際 `schema.prisma` 一致。
3. **testing**：移除 `items/backend-testing.md`、`items/integration.md`、`references/test-accounts.md` 的橫幅。
4. **deployment/items/env-config.md**：移除 `DATABASE_URL` / `JWT_SECRET` 段落的橫幅。
5. **deployment/items/dockerfile.md**：加回 `npx prisma generate` 步驟並取消相關註記。
6. **debugging/items/backend-debug.md**：若啟用 Prisma，檢查錯誤碼對照表是否仍適用。
7. 更新本 README 的「目前各 skill 級別快照」表格。
8. 更新 `CLAUDE.md` 知識庫最後更新日期。

---

## 新增 skill 檢查清單

- [ ] `SKILL.md` frontmatter 有 `name` 與 `description`
- [ ] description 說明「何時使用」，關鍵字足夠準確
- [ ] 內容中的工具名、路徑、元件名皆可在專案中驗證存在
- [ ] 若依賴未初始化的基礎設施，已加入樣板規範橫幅
- [ ] 相關技能連結指向實際存在的 `../xxx/SKILL.md`
- [ ] 列入本 README 的級別快照表

---

## 觸發測試

修改 skill 後應以實際情境觸發確認能載入。上次完整觸發測試結果請見：
- `openspec/changes/archive/*audit-project-skills/validation.md`（歸檔後）
- `openspec/changes/audit-project-skills/validation.md`（進行中）
