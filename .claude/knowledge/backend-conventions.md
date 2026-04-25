# 後端編碼規範（Server API）

Nitro server routes 位於 `server/routes/nuxt-api/`，使用 `@@` 別名引用 `server/`。

## API 路由結構

每個資源依 HTTP 方法拆檔：

```
server/routes/nuxt-api/{資源}/
  index.get.ts    — 列表
  index.post.ts   — 新增
  [id].get.ts     — 詳情
  [id].put.ts     — 更新
  [id].delete.ts  — 刪除
```

## 錯誤處理（核心規則）

- **使用 `return` 回傳錯誤，禁止 `throw`**
- 使用 `@@/utils/response` 提供的工具函式：
  - `successResponse(data)`
  - `notFoundError(...)`
  - `badRequestError(...)`
  - `forbiddenError(...)`
  - 其他依需求擴充
- 錯誤訊息必須提供三語言（`zh_tw`、`en`、`ja`）
- 後端返回資料中的 `null` 值應轉為空字串

## 統一響應格式

```typescript
{
  data: T,
  status: {
    code: number,
    message: { zh_tw: string, en: string, ja: string }
  }
}
```

## 前後端共享

- 共享程式碼放在 `shared/`，以 `~shared` 別名引用
- 前端透過 `$api` 呼叫，需與後端回傳格式保持一致（`status.code` 判斷成功失敗）
