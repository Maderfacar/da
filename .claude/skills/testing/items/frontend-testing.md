# 前端 UI 測試

## Playwright MCP 測試流程

### 基本流程

```
1. 開啟頁面
2. 取得快照（Accessibility Tree + ref）
3. 執行操作（點擊、輸入、選擇）
4. 等待 / 重新取得快照
5. 驗證結果
```

### 常用工具

| 簡稱 | 用途 |
|------|------|
| `browser_navigate` | 開啟 URL |
| `browser_snapshot` | 取得頁面快照（含 `ref`） |
| `browser_click` | 點擊元素 |
| `browser_type` | 填寫輸入框 |
| `browser_fill_form` | 批次填寫表單 |
| `browser_select_option` | 選擇 `<select>` |
| `browser_press_key` | 按鍵（Enter、Escape 等） |
| `browser_wait_for` | 等待文字出現 / 消失 |
| `browser_take_screenshot` | 擷圖驗證 |

工具完整名稱為 `mcp__plugin_playwright_playwright__browser_*`。

### 範例：登入測試（若後端已啟用）

```
1. browser_navigate(url: "http://localhost:3000/sign-in")
2. browser_snapshot → 取得 Email / 密碼欄位 ref
3. browser_type(ref: "e3", text: "<測試帳號>")
4. browser_type(ref: "e5", text: "<測試密碼>")
5. browser_click(ref: "e8")  // 登入按鈕
6. browser_wait_for(text: "儀表板")
7. browser_snapshot → 確認頁面已切換
```

## ref 注意事項

> [!WARNING]
> `ref` 會在 DOM 變更後失效！

### 常見問題

- 操作後頁面重新渲染，`ref` 不再有效
- 路由切換、資料重新載入都會讓 `ref` 變動

### 正確做法

```
1. browser_snapshot → 取得元素 ref
2. browser_click(ref)   → 執行操作
3. browser_wait_for(...) → 等待預期狀態
4. browser_snapshot → 重新取得快照
5. 使用新 ref 繼續後續操作
```

## 測試案例模板

### CRUD 測試
1. **列表顯示**：確認資料正確載入
2. **新增**：填寫表單、送出、確認新增成功
3. **編輯**：開啟編輯、修改、確認更新
4. **刪除**：確認刪除、驗證消失

### 表單測試
1. **必填驗證**：空白送出、確認錯誤提示
2. **格式驗證**：錯誤格式、確認驗證訊息
3. **成功送出**：正確資料、確認成功

## 測試檢查清單

- [ ] 頁面正常載入
- [ ] 資料正確顯示
- [ ] 表單驗證正常
- [ ] 操作回饋正確（loading、訊息）
- [ ] 錯誤處理妥當
- [ ] 權限控制正確
- [ ] `browser_console_messages` 無未預期錯誤
