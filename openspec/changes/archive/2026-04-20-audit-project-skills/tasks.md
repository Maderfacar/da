## 1. 準備基礎設施

- [x] 1.1 建立 `.claude/skills/README.md`，說明分級定義、橫幅格式、啟用後端時的清理清單
- [x] 1.2 建立 `openspec/changes/audit-project-skills/validation.md` 骨架（七個 skill 觸發測試空欄位）

## 2. 修正 debugging skill（MCP 工具名更新）

- [x] 2.1 `debugging/SKILL.md`：將前端調試流程的工具名改為 Playwright MCP 完整名稱
- [x] 2.2 `debugging/items/chrome-devtools.md`：重寫工具清單為 `browser_snapshot`、`browser_navigate`、`browser_click`、`browser_type`、`browser_wait_for`、`browser_evaluate`、`browser_take_screenshot`、`browser_console_messages`、`browser_network_requests`
- [x] 2.3 `debugging/items/chrome-devtools.md`：檔名保留但內文標題改為「Playwright MCP 操作」
- [x] 2.4 `debugging/items/frontend-debug.md`、`backend-debug.md`：更新所有工具名與範例（`backend-debug.md` 補上樣板規範橫幅與 `throw` → `return` 修正）
- [x] 2.5 `debugging/references/common-issues.md`：檢查並更新任何過時引用（加上部分內容樣板規範提示）

## 3. 修正 testing skill

- [x] 3.1 `testing/SKILL.md`：更新所有工具名為 Playwright MCP
- [x] 3.2 `testing/items/frontend-testing.md`：更新工具名
- [x] 3.3 `testing/items/browser-testing.md`：移除 `browser_subagent`，改用 Playwright MCP 工具
- [x] 3.4 `testing/items/backend-testing.md`：加入「樣板規範」橫幅
- [x] 3.5 `testing/items/integration.md`：加入「樣板規範」橫幅
- [x] 3.6 `testing/references/test-accounts.md`：加入「樣板規範」橫幅

## 4. 修正 deployment skill

- [x] 4.1 `deployment/SKILL.md`：移除 Prisma Generate 步驟，Node 版本在說明中改為 24.11
- [x] 4.2 `deployment/items/dockerfile.md`：將 `node:20-alpine` 全部改為 `node:24.11-alpine`；`npx prisma generate` 以註記改為「啟用後端後補」
- [x] 4.3 `deployment/items/railway.md`：移除 `.windsurf/...` 殘留路徑，修正為 `.claude/skills/deployment/...`
- [x] 4.4 `deployment/items/env-config.md`：將 `DATABASE_URL`、`JWT_SECRET` 等後端變數段落加入「樣板規範」橫幅
- [x] 4.5 `deployment/references/checklist.md`：同步檢查並更新

## 5. 修正 nuxt-backend skill

- [x] 5.1 `nuxt-backend/SKILL.md`：frontmatter `description` 加註「樣板規範：啟用後端時適用」；檔案頂部加入統一橫幅
- [x] 5.2 `nuxt-backend/items/coding-style.md`：加橫幅
- [x] 5.3 `nuxt-backend/items/api-design.md`：加橫幅
- [x] 5.4 `nuxt-backend/items/error-handling.md`：加橫幅
- [x] 5.5 `nuxt-backend/items/validation.md`：加橫幅；說明 Zod 目前未安裝
- [x] 5.6 `nuxt-backend/items/auth-context.md`：加橫幅
- [x] 5.7 `nuxt-backend/references/file-naming.md`：加橫幅

## 6. 修正 prisma-database skill

- [x] 6.1 `prisma-database/SKILL.md`：frontmatter `description` 加註「樣板規範」；頂部加橫幅
- [x] 6.2 `prisma-database/items/query-patterns.md`：加橫幅
- [x] 6.3 `prisma-database/items/transaction.md`：加橫幅
- [x] 6.4 `prisma-database/items/null-handling.md`：保留空值處理標準為核心參考，加橫幅說明「資料庫層啟用後才實際套用」
- [x] 6.5 `prisma-database/items/soft-delete.md`：加橫幅
- [x] 6.6 `prisma-database/items/migration.md`：加橫幅
- [x] 6.7 `prisma-database/references/seed-data.md`：加橫幅

## 7. 修正 nuxt-frontend skill

- [x] 7.1 `nuxt-frontend/SKILL.md`：修正空值處理連結指向 `prisma-database/items/null-handling.md`
- [x] 7.2 `nuxt-frontend/items/global-utils.md`：將 `$dayjs` 方法清單修正為僅含 `FormatDate` + dayjs 原生方法；移除 `CreateCalendar` 等不存在方法；驗證 `$tool`、`$enum`、`$lodash` 的敘述是否對應實際檔案
- [x] 7.3 `nuxt-frontend/items/api-usage.md`：驗證 `$api` 使用敘述與 `app/utils/$api.ts`、`app/protocol/fetch-api/` 一致（無需修改）
- [x] 7.4 `nuxt-frontend/items/drawer-system.md`：對照 `app/components/open/{dialog,drawer,group}` 實際結構（無需修改）
- [x] 7.5 `nuxt-frontend/references/store-overview.md`：僅保留實際存在的 5 個 store（`0.store-env` / `1.store-tool` / `2.store-theme` / `3.store-self` / `4.store-open`）
- [x] 7.6 `nuxt-frontend/items/{coding-style,vue-layout,i18n,rbac,scss-guide}.md`：`vue-layout.md` 移除不存在的 `Ly*` 元件，其餘對照後無需修改

## 8. 修正 element-plus-ui skill

- [x] 8.1 `element-plus-ui/references/global-components.md`：移除不存在的 `Ly*` 元件；改列實際存在的 `app/components/el/*-plus.vue` 與 `app/components/open/{dialog,drawer,group}` 內元件
- [x] 8.2 `element-plus-ui/SKILL.md`：自定義元件表同步更新
- [x] 8.3 `element-plus-ui/items/forbidden.md`：驗證 `UseAsk()` 敘述（確認 `app/composables/app/use-ask.ts` 存在，無需修改）
- [x] 8.4 `element-plus-ui/items/{form-components,table-patterns,dialog-patterns,message-patterns}.md`：對照 CLAUDE.md 檢查後無需修改

## 9. 觸發測試

- [x] 9.1 `nuxt-frontend`：以「我要新增一個 Vue 頁面」情境測試觸發，記錄結果
- [x] 9.2 `nuxt-backend`：以「我要加 API 端點」情境測試觸發，記錄結果
- [x] 9.3 `prisma-database`：以「我要寫 Prisma 查詢」情境測試觸發，記錄結果
- [x] 9.4 `element-plus-ui`：以「我要用 ElTable 做列表」情境測試觸發，記錄結果
- [x] 9.5 `debugging`：以「瀏覽器上某個按鈕沒反應」情境測試觸發，記錄結果
- [x] 9.6 `testing`：以「我要驗證這個功能」情境測試觸發，記錄結果
- [x] 9.7 `deployment`：以「我要部署到 Railway」情境測試觸發，記錄結果
- [x] 9.8 將所有結果寫入 `openspec/changes/audit-project-skills/validation.md`

## 10. 驗證與收尾

- [x] 10.1 執行 `openspec validate audit-project-skills --strict` 通過
- [x] 10.2 執行 verify skill 檢查一致性
- [x] 10.3 執行 archive skill 歸檔 change
