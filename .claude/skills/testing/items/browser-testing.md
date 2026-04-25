# 瀏覽器自動化測試

本專案使用 **Playwright MCP** 做瀏覽器自動化，工具由 `plugin:playwright` 提供。

## 核心工具

| 簡稱 | 完整名稱 | 用途 |
|------|---------|------|
| `browser_navigate` | `mcp__plugin_playwright_playwright__browser_navigate` | 開啟 URL / 導航 |
| `browser_navigate_back` | `mcp__plugin_playwright_playwright__browser_navigate_back` | 返回上一頁 |
| `browser_snapshot` | `mcp__plugin_playwright_playwright__browser_snapshot` | 取得 Accessibility 快照 |
| `browser_click` | `mcp__plugin_playwright_playwright__browser_click` | 點擊 |
| `browser_type` | `mcp__plugin_playwright_playwright__browser_type` | 輸入文字 |
| `browser_fill_form` | `mcp__plugin_playwright_playwright__browser_fill_form` | 批次填表 |
| `browser_select_option` | `mcp__plugin_playwright_playwright__browser_select_option` | 選擇下拉 |
| `browser_wait_for` | `mcp__plugin_playwright_playwright__browser_wait_for` | 等待文字 / 時間 |
| `browser_take_screenshot` | `mcp__plugin_playwright_playwright__browser_take_screenshot` | 截圖 |
| `browser_console_messages` | `mcp__plugin_playwright_playwright__browser_console_messages` | 查看 Console |
| `browser_network_requests` | `mcp__plugin_playwright_playwright__browser_network_requests` | 查看網路請求 |
| `browser_evaluate` | `mcp__plugin_playwright_playwright__browser_evaluate` | 執行 JavaScript |
| `browser_close` | `mcp__plugin_playwright_playwright__browser_close` | 關閉 |

## 測試案例

### 登入測試（若登入頁已存在）

```
1. browser_navigate(url: "http://localhost:3000/sign-in")
2. browser_snapshot → 取得欄位 ref
3. browser_fill_form(fields: [
     { name: "Email", type: "textbox", ref: "eX", value: "<測試帳號>" },
     { name: "密碼", type: "textbox", ref: "eY", value: "<測試密碼>" }
   ])  // fields 每個必含 name / type / ref / value；type 為 textbox|checkbox|radio|combobox|slider
4. browser_click(ref: "eZ")  // 登入按鈕
5. browser_wait_for(text: "儀表板")
6. browser_snapshot → 確認導頁結果
```

### 新增資料測試

```
1. browser_navigate(url: "/.../management")
2. browser_click(ref: "e{新增按鈕}")
3. browser_fill_form(fields: [...])
4. browser_click(ref: "e{確認}")
5. browser_wait_for(text: "新增成功")
6. browser_snapshot → 確認列表中出現新資料
```

### 表單驗證測試

```
1. 開啟新增表單
2. 不填欄位直接 browser_click 送出
3. browser_snapshot → 確認必填錯誤提示
```

## 注意事項

1. **每次 DOM 變動後都要重新 `browser_snapshot`**（`ref` 失效）
2. **明確描述操作**：不依賴順序假設，驗證每一步結果
3. **處理等待**：`browser_wait_for` 優於 `sleep`；等待文字 / 元素出現
4. **錯誤處理**：用 `browser_console_messages` 與 `browser_network_requests` 看真實錯誤
5. **結果驗證**：以快照內容比對預期文字，不只比對流程是否執行完
