# Playwright MCP 操作

本專案瀏覽器自動化一律使用 **Playwright MCP**（`plugin:playwright`），不再使用舊版 Chrome DevTools MCP。工具名前綴為 `mcp__plugin_playwright_playwright__`，以下以簡稱列出。

## 基本工具

| 簡稱 | 完整名稱 | 用途 |
|------|---------|------|
| `browser_navigate` | `mcp__plugin_playwright_playwright__browser_navigate` | 開啟指定 URL |
| `browser_snapshot` | `mcp__plugin_playwright_playwright__browser_snapshot` | 取得 Accessibility 快照（含 `ref` 參考） |
| `browser_click` | `mcp__plugin_playwright_playwright__browser_click` | 點擊元素 |
| `browser_type` | `mcp__plugin_playwright_playwright__browser_type` | 填寫輸入框 |
| `browser_fill_form` | `mcp__plugin_playwright_playwright__browser_fill_form` | 批次填寫多個欄位 |
| `browser_select_option` | `mcp__plugin_playwright_playwright__browser_select_option` | 選擇 `<select>` 下拉 |
| `browser_press_key` | `mcp__plugin_playwright_playwright__browser_press_key` | 按鍵（Enter、Escape 等） |
| `browser_evaluate` | `mcp__plugin_playwright_playwright__browser_evaluate` | 執行 JavaScript |
| `browser_console_messages` | `mcp__plugin_playwright_playwright__browser_console_messages` | 取得 Console 訊息 |
| `browser_network_requests` | `mcp__plugin_playwright_playwright__browser_network_requests` | 取得網路請求列表 |
| `browser_wait_for` | `mcp__plugin_playwright_playwright__browser_wait_for` | 等待文字 / 時間 / 元素消失 |
| `browser_take_screenshot` | `mcp__plugin_playwright_playwright__browser_take_screenshot` | 擷取畫面 |
| `browser_hover` | `mcp__plugin_playwright_playwright__browser_hover` | 滑鼠懸停 |
| `browser_handle_dialog` | `mcp__plugin_playwright_playwright__browser_handle_dialog` | 處理 alert / confirm |
| `browser_tabs` | `mcp__plugin_playwright_playwright__browser_tabs` | 分頁管理 |
| `browser_close` | `mcp__plugin_playwright_playwright__browser_close` | 關閉頁面 |

## 調試流程

### 1. 開啟頁面

```
browser_navigate(url: "http://localhost:3000/")
```

### 2. 取得快照

```
browser_snapshot
```

- 回傳 Accessibility Tree
- 每個可互動元素會有 `ref` 參考（例如 `e3`），後續操作使用 `ref`

### 3. 檢查 Console

```
browser_console_messages
```

### 4. 執行操作

`browser_click` 必填 `ref`；`element`（人類可讀描述）為可選但建議填，會在權限提示中顯示。`browser_type` 必填 `ref` 與 `text`。

```
browser_click(element: "登入按鈕", ref: "e12")
browser_type(element: "Email 輸入框", ref: "e7", text: "user@example.com")
browser_type(element: "搜尋框", ref: "e3", text: "keyword", submit: true)  // 輸入後直接按 Enter
```

### 5. 等待 / 重新取得快照

`browser_wait_for` 三種互斥模式：`text`（等出現）、`textGone`（等消失）、`time`（秒數）。

```
browser_wait_for(text: "儀表板")         // 等指定文字出現
browser_wait_for(textGone: "載入中")      // 等指定文字消失
browser_wait_for(time: 2)                 // 固定等待 2 秒
browser_snapshot
```

## ref 注意事項

### 常見錯誤

```
Error: No element found for aria-ref=e12
```

### 原因

- 頁面重新渲染（Vue 響應更新）
- 路由切換
- 動態載入資料後 DOM 改變

### 解決方案

1. 操作後若預期 DOM 變化，先 `browser_wait_for`
2. 再 `browser_snapshot` 取得新 `ref`
3. 不要快取上一輪快照中的 `ref`

## 常用 JavaScript 片段

`browser_evaluate` 的必填參數是 `function`（字串，內容為箭頭函式）；若針對特定元素執行，可再帶 `ref`，箭頭函式型別變為 `(element) => { ... }`。

### 檢查元素狀態（針對整頁）

```
browser_evaluate(function: "() => document.querySelector('.el-button')?.disabled")
```

### 檢查 Vue / Nuxt payload

```
browser_evaluate(function: "() => window.__NUXT__?.data")
```

### 觸發原生事件（針對 ref 元素）

```
browser_evaluate(
  element: "提交按鈕",
  ref: "e12",
  function: "(element) => element.click()"
)
```

## 常見問題排查

| 問題 | 檢查點 |
|------|--------|
| 按鈕無法點擊 | `disabled` 屬性、`z-index` 遮蔽、是否在視窗內 |
| 看不到元素 | `v-if` 條件、`display: none`、`visibility: hidden` |
| 資料不顯示 | API 是否返回、資料綁定、空陣列判斷 |
| 表單無法送出 | 驗證規則、必填欄位、ElForm `validate()` 結果 |
