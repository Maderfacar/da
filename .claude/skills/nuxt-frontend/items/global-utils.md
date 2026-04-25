# 全局工具使用

以下工具已在 `app/utils/` 自動注入，無需 `import`。下列 API 清單以實際檔案內容為準（擷取自 `app/utils/$*.ts` 的 `export default`）。

## $dayjs - 日期處理

```typescript
// 格式化日期（靜態方法，封裝自 dayjs）
$dayjs.FormatDate(date)                       // 預設 'YYYY-MM-DD'
$dayjs.FormatDate(date, 'YYYY-MM-DD HH:mm:ss')

// 原生 dayjs 方法（FormatDate 以外皆為 dayjs 原生）
$dayjs().format('YYYY-MM-DD')
$dayjs(date).add(7, 'day')
$dayjs(date).subtract(1, 'month')
$dayjs(date1).isBefore(date2)
$dayjs(date1).isSame(date2, 'day')
```

> 專案只額外提供 `FormatDate` 一個封裝方法；其他日期操作請直接使用 dayjs 原生 API。

## $enum - 枚舉常數

```typescript
// API 狀態碼（實際檔案：app/utils/$enum.ts → apiStatus）
$enum.apiStatus.none           // ''
$enum.apiStatus.success        // 200
$enum.apiStatus.fail           // 400
$enum.apiStatus.unauthorized   // 401
$enum.apiStatus.forbidden      // 403
$enum.apiStatus.notFound       // 404
$enum.apiStatus.serverError    // 500
```

## $tool - 通用工具

```typescript
// 型別判斷
$tool.HasKey(object, key)
$tool.IsArray(value)
$tool.IsObject(value)

// 生成 / 轉換
$tool.CreateUUID()
$tool.NumToMoney(1234567)       // '1,234,567'
$tool.MoneyToNum('1,234')       // 1234
$tool.ArrayObjectFilter(data)   // 深度過濾 null/undefined/空字串
$tool.ArraySum([1, 2, '3'])     // 6
$tool.PickObjectA2B(fromObj, toObj)
$tool.JsonToFormData(json)
$tool.FormDataToJson(formData)
$tool.Zero(5, 3)                // '005'（左側補零）
$tool.FirstUpper('hello')       // 'Hello'
$tool.AdjustArrayLength(arr, 10, structure)
$tool.CreateDemoImg(600, 400)
$tool.CreateRandomImg(600, 400)

// 行為
await $tool.Sleep(1000)         // 等待 1 秒
$tool.ScrollTop('.container')
$tool.ScrollToEl(element)
$tool.ScrollToTag('#section-id')
await $tool.CopyText('text')
await $tool.ShareUrl(url, title, text)
$tool.HiddenScrollbar(true)
await $tool.DownloadLinkFile(url, 'filename.xlsx')
```

## $lodash - Lodash 工具

專案使用 `lodash-es`。`$lodash` 直接等同於 lodash-es 的命名導出集合，常用：

```typescript
$lodash.cloneDeep(object)
$lodash.debounce(fn, 300)
$lodash.throttle(fn, 300)
$lodash.pick(obj, ['name', 'email'])
$lodash.omit(obj, ['password'])
```

## $encrypt - 加密 / 解密

```typescript
// Base64 編 / 解碼（UTF-8 安全版，會先 encodeURIComponent 處理多位元字元）
$encrypt.Encode64('中文字串')            // 回傳 Base64 字串；失敗回 ''
$encrypt.Decode64(base64Str)             // 回傳原文；失敗回 ''

// AES 加 / 解密（使用檔內固定 SECRET_KEY）
$encrypt.EncodeAES('plain text')         // 回傳 AES 密文
$encrypt.DecodeAES(cipherText)           // 回傳原文
```

> ⚠️ `EncodeAES` / `DecodeAES` 使用 `app/utils/$encrypt.ts` 內硬編碼的 `SECRET_KEY`，不適用於需要保密的場景，僅可用於前端本地混淆（例如 cookie 儲存）。真正機密資料請在後端處理。

## $open / $api

- `$open`：業務彈窗開啟器（見 [drawer-system.md](drawer-system.md)）
- `$api`：後端請求封裝（見 [api-usage.md](api-usage.md)）

## 使用注意事項

1. 這些工具已全局注入，**無需 import**
2. 在 `<script setup>` 中直接使用即可
3. TypeScript 類型由各工具檔自行定義；`$dayjs` 的自訂方法透過 `dayjs & { FormatDate }` 擴充型別
4. 若需要新增全局工具，新建 `app/utils/$xxx.ts` 並於 `default export` 匯出即可被自動注入
