# 命名規範 (Naming Conventions)

> 本文件為合併版本：`_docs/naming-conventions.md`（業務元件命名）＋ `CLAUDE.md`（函式命名慣例）。
> 兩者衝突時，**CLAUDE.md 的函式命名慣例優先**。

## 1. 檔案與目錄命名

| 類型 | 規則 | 範例 |
|------|------|------|
| 目錄 | 小寫 + 連字符 | `war-room/`、`fetch-api/` |
| Vue 元件 | PascalCase + `.vue` | `UiButton.vue`、`PassengerOrderForm.vue` |
| TypeScript 檔案 | camelCase + `.ts` | `useOrder.ts`、`orderUtils.ts` |
| Store 檔案 | 數字前綴 + `.ts` | `5.store-auth.ts` |
| 翻譯檔 | 小寫 + 連字符 | `zh.js`、`en.js` |

## 2. Vue 元件命名規範

| 類型 | 命名規則 | 範例 |
|------|---------|------|
| 純 UI 原子元件（Tailwind） | `Ui` 前綴 | `UiButton.vue`、`UiCard.vue`、`UiInput.vue` |
| 乘客端業務元件 | `Passenger` 前綴 | `PassengerOrderForm.vue`、`PassengerVehicleCard.vue` |
| 司機端業務元件 | `Driver` 前綴 | `DriverTaskCard.vue`、`DriverLocationMap.vue` |
| 管理者端業務元件 | `Admin` 前綴 | `AdminOrderTable.vue`、`AdminDriverList.vue` |
| 共用業務元件 | `Common` 前綴 | `CommonPageHeader.vue` |
| 彈窗元件 | `OpenDialog{名稱}{模式}` | `OpenDialogOrderInfo.vue`、`OpenDialogOrderEdit.vue` |
| Element Plus 擴展 | `El` 前綴（現有） | 現有樣板元件，維持不動 |

## 3. 函式命名慣例（遵循 CLAUDE.md）

| 類型 | 命名 | 範例 |
|------|------|------|
| 點擊事件處理 | `Click*` | `ClickSave`、`ClickDelete`、`ClickConfirm` |
| 流程控制 | `*Flow` | `SaveFlow`、`InitAuthFlow`、`DeleteFlow` |
| API 呼叫 | `Api*` | `ApiGetList`、`ApiSave`、`ApiGetOrderDetail` |
| 私有 helper | `_*` | `_clearState`、`_InitLiffFlow` |

## 4. 變數與狀態命名

| 類型 | 規則 | 範例 |
|------|------|------|
| 一般變數 / 狀態 | camelCase | `orderList`、`currentTrip`、`isLoading` |
| Boolean | `is` / `has` / `should` 開頭 | `isSignIn`、`hasValidRoute`、`liffReady` |
| 常量 | 全大寫 + 底線 | `MAX_PASSENGERS`、`DEFAULT_LANGUAGE` |
| Ref / Reactive | camelCase（不需 `Ref` 後綴） | `const uid = ref('')` |

## 5. TypeScript 型別命名

- **介面 / 型別**：PascalCase → `Order`、`DriverLocation`、`TripStatus`
- **Enum**：PascalCase → `OrderStatus`、`VehicleType`
- **聯合型別**：PascalCase → `TripStatus = 'idle' | 'pending' | ...`

## 6. Store 命名慣例

- 檔案：`{數字}.store-{名稱}.ts`
- 匯出函式：`Store{PascalCase}` → `StoreAuth()`、`StoreTrip()`
- 呼叫方式：直接呼叫（Pinia auto-import）→ `const { isSignIn } = StoreAuth()`

## 7. 路由與頁面命名

- 頁面檔案：小寫 + 連字符 → `war-room/index.vue`
- 路由路徑：小寫 + 連字符 → `/admin/war-room`

## 8. 禁止事項

- 禁止使用中文作為變數、函式、檔案名稱
- 禁止縮寫（除非業界常見：`id`、`url`、`api`、`liff`）
- 禁止不同命名風格混用（camelCase vs snake_case）
- 禁止使用 `any` 型別

---

**版本紀錄**
- 版本：v1.1（合併 _docs 業務元件命名 + CLAUDE.md 函式命名慣例）
- 更新日期：2026/04/26
