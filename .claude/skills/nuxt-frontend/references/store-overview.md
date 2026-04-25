# Store 概覽

本專案實際存在 5 個 Pinia Store（`app/stores/`），以數字前綴控制載入順序：

| # | Store 檔案 | 函式名 | 功能 |
|---|-----------|--------|------|
| 0 | `0.store-env.ts` | `StoreEnv()` | 環境變數管理（runtimeConfig 取值） |
| 1 | `1.store-tool.ts` | `StoreTool()` | RWD 狀態、滾動偵測等工具 |
| 2 | `2.store-theme.ts` | `StoreTheme()` | 主題色 / 深淺模式 |
| 3 | `3.store-self.ts` | `StoreSelf()` | 使用者資訊、Token、權限（`HasRule()`） |
| 4 | `4.store-open.ts` | `StoreOpen()` | 彈窗狀態（`OnOpen` / `OnClose`） |

> 此表為目前實際可用的 Store 清單；若未來新增 Store，請同步更新本檔並於 CLAUDE.md 狀態管理區塊補充。

## 主要 Store 範例

### StoreSelf（使用者認證）

```typescript
StoreSelf().userInfo          // 使用者資訊
StoreSelf().token             // JWT Token
StoreSelf().isLogin           // 是否已登入

// 權限檢查
StoreSelf().HasRule('customer:view')  // boolean
```

### StoreOpen（彈窗管理）

```typescript
StoreOpen().OnOpen('OpenDialogUserInfo', { userId: 1 })
StoreOpen().OnClose('OpenDialogUserInfo')
```

### StoreTool（RWD、滾動）

```typescript
StoreTool().isMobile       // 是否為行動裝置寬度
StoreTool().scrollTop      // 滾動距離
```

### StoreTheme（主題）

```typescript
StoreTheme().themeColor    // 當前主題色
StoreTheme().isDark        // 是否深色模式
```

### StoreEnv（環境）

```typescript
StoreEnv().apiBase         // API 基礎路徑
```

## 使用規範

1. 在 `<script setup>` 中直接以**函式形式**使用（`StoreSelf()`），不要解構後使用
2. Store 相關操作放在組件的 Action 層；避免在組件 Template 中直接 mutate state
3. 避免在 Store 內直接呼叫 API（應由組件呼叫 `$api` 後再更新 Store）
