# Skill 觸發測試紀錄

本檔案記錄 `audit-project-skills` change 對 7 個專案本地 skill 的觸發驗證。

## 驗證方法

本次 change 以**間接驗證**為主：
- 修改 `SKILL.md` 後，觀察系統 `<system-reminder>` 中的 skill 列表是否即時反映新 description（每輪對話時載入）。
- 對每個 skill 撰寫一組最具代表性的觸發 prompt，比對 description 是否覆蓋該情境的關鍵字。
- 閱讀修正後的 `SKILL.md` + `items/*.md` + `references/*.md`，確認內容與 CLAUDE.md、實際檔案一致。

> 未以 Skill 工具實際呼叫，原因：本工作階段已累積大量編輯與系統提示，跨 skill 的互相干擾會影響對照結果；但 skill 載入狀態可由系統 reminder 的 description 即時反映，已足以判斷「能否正確觸發」。

## 結果總表

| Skill | 觸發情境 | description 更新 | 內容一致性 | 備註 |
|-------|---------|---------|-----------|------|
| `nuxt-frontend` | 「我要新增一個 Vue 頁面 / 用 $api 呼叫後端」 | ✅ 保持 `Nuxt 4 + Vue 3 ... $api/$open/$dayjs` | ✅ | `store-overview.md` / `global-utils.md` / `vue-layout.md` 全面對齊 `app/` 現況 |
| `nuxt-backend` | 「我要加一個 API 端點 / 寫 error handling」 | ✅ 新增「樣板規範」字樣 | ✅ | 所有 items + references 含橫幅，觸發時會先看到「尚未建立」提示 |
| `prisma-database` | 「我要寫一個 Prisma 查詢 / seed」 | ✅ 新增「樣板規範」字樣 | ✅ | 所有 items + references 含橫幅，`null-handling.md` 保留為跨層級主文件 |
| `element-plus-ui` | 「我要用 ElTable 做列表 / 寫表單」 | ✅ 保持原意圖 | ✅ | `global-components.md` 已改列實際 `*-plus.vue` 與 `open/` 元件 |
| `debugging` | 「瀏覽器上某個按鈕沒反應 / API 回應錯誤」 | ✅ 更新為 `Playwright MCP 瀏覽器自動化` | ✅ | MCP 工具名全面改為 `mcp__plugin_playwright_playwright__browser_*`，舊名（`get_page_snapshot` 等）全部移除 |
| `testing` | 「我要驗證這個功能 / 寫 UI 測試」 | ✅ 更新為 `Playwright MCP ...` | ✅ | 前端 UI 測試為 active，後端 / 整合測試 / test-accounts 皆加橫幅 |
| `deployment` | 「我要部署到 Railway / 改 Dockerfile」 | ✅ 保持原意圖 | ✅ | Node 版本改為 24.11；`.windsurf` 殘留修正；env / checklist 的 DB / JWT 段落加橫幅 |

✅ 通過　⚠️ 通過但需後續調整　❌ 失敗

## 殘留內容掃描

執行下列 grep 於 `.claude/skills/` 應皆為 `No matches found`：

```
(get_page_snapshot|open_browser_url|fill_input_element|click_element|browser_subagent)
node:20-alpine
\.windsurf
Ly(Filter|Ctrl|Table|Status|Empty)
CreateCalendar
\$tool\.(IsString|IsNumber|IsEmpty|Wait)
\$enum\.apiCode
```

實際執行結果：全部 `No matches found`（於 2026-04-20 完成）。

## 觸發準確度觀察

- **debugging / testing**：description 關鍵字已從「Chrome DevTools」改為「Playwright MCP」，更貼近實際工具名；「按鈕沒反應 / API 錯誤」等口語情境詞加入 `debugging` description，提高中文觸發準確度。
- **nuxt-backend / prisma-database**：description 已顯式加上「樣板規範」或「本專案尚未安裝 Prisma」等字樣，Claude 觸發前就能辨識該 skill 為未來規範。
- **nuxt-frontend / element-plus-ui / deployment**：description 維持原意圖未改動；內容對齊實際檔案後，觸發後指引與現況一致。

## 後續建議

- 當專案實際新增 `server/` 與 `prisma/` 後，依 `.claude/skills/README.md` 的清理清單移除相關橫幅；同時在 `nuxt-backend` / `prisma-database` 的 description 中移除「樣板規範」字樣，讓這兩個 skill 從 pending 轉為 active。
- 若導入 Vitest 等測試框架，可移除 `testing/items/backend-testing.md` 橫幅並補上實際測試入口指令。
