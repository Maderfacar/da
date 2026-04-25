# 前端編碼規範

Nuxt 4 + Vue 3 Composition API + TypeScript + Element Plus 的 SFC 撰寫規範。

## SFC 結構順序

模板使用 **Pug**，樣式使用 **SCSS scoped**。`<script setup lang="ts">` 內部必須依此順序組織：

```vue
<script setup lang="ts">
// 1. Imports
// 2. Props / Refs / State
// 3. Watch / Event Handlers（Click* 前綴）
// 4. Flow Control（*Flow 後綴）
// 5. Helpers
// 6. API Requests（Api* 前綴）
// 7. Lifecycle
// 8. Emits
// 9. Expose
</script>

<template lang="pug">
.ComponentName
  //- 內容
</template>

<style lang="scss" scoped>
.ComponentName { }
</style>
```

## 元件命名規範

| 類型 | 命名規則 | 範例 |
|------|---------|------|
| 純 UI 原子元件（Tailwind + Editorial Horizon） | `Ui` 前綴 | `UiButton.vue`, `UiCard.vue`, `UiInput.vue` |
| 乘客端業務元件 | `Passenger` 前綴 | `PassengerOrderForm.vue`, `PassengerVehicleCard.vue` |
| 司機端業務元件 | `Driver` 前綴 | `DriverTaskCard.vue`, `DriverLocationMap.vue` |
| 管理者端業務元件 | `Admin` 前綴 | `AdminOrderTable.vue`, `AdminDriverList.vue` |
| 共用業務元件 | `Common` 前綴 | `CommonPageHeader.vue` |
| 彈窗元件 | `OpenDialog{名稱}{模式}` | `OpenDialogOrderInfo.vue`, `OpenDialogOrderEdit.vue` |

## 函式命名慣例

| 類型 | 命名前綴/後綴 | 範例 |
|------|--------------|------|
| 點擊事件 | `Click*` | `ClickSave`, `ClickDelete` |
| 流程控制 | `*Flow` | `SaveFlow`, `DeleteFlow`, `InitAuthFlow` |
| API 呼叫 | `Api*` | `ApiSave`, `ApiGetList` |
| 私有 helper | `_*` | `_clearState`, `_InitLiffFlow` |

## SCSS 規範

- 類名採 BEM 變體：`.ComponentName`、`.ComponentName__element`、`.ComponentName__element--modifier`
- **禁止** `&__` 嵌套寫法，必須展平寫
- **禁止** `!important`、內聯 `style=""`、`@import`
- 覆蓋 Element Plus 樣式只能在 scoped 內用 `:deep()`
- 全局 SCSS（`config`、`colors`、`fn`、`mixin`、`font-size`、`rwd`、`element-plus/index`）已由 Vite 自動注入，直接使用 mixin/變數即可

## Element Plus 限制

- **禁止** `ElMessageBox.confirm/prompt` → 改用 `UseAsk()` composable
- `ElInput` 必須加 `maxlength`
- `ElSelect` 搭配 `clearable` 時必須加 `value-on-clear=""`
- 數字輸入必須加 `inputmode="numeric"`

## 自動導入（無需 import）

- `app/stores/` — Pinia stores（如 `StoreSelf()`、`StoreOpen()`）
- `app/utils/` — `$api`、`$dayjs`、`$tool`、`$lodash`、`$encrypt`、`$enum`、`$open`
- `app/composables/**` — 如 `UseAsk()`
- `app/components/` — 全局組件（排除 `loading/page.vue` 與 `open/group/index.vue`）
- Vue 核心 API（`ref` / `computed` / `watch` 等）

## 彈窗系統

業務彈窗使用 `$open` 開啟，組件放在 `app/components/open/`，命名規則 `OpenDialog{業務名稱}{模式}.vue`（`Info` / `Edit` / `Create`）。確認對話框一律用 `UseAsk()`。

## API 請求範式

```typescript
const res = await $api.GetUserList({ page: 1 });
if (res.status.code !== $enum.apiStatus.success) return false;
```

Token 注入、錯誤處理、401 自動跳轉登入皆內建於 `app/protocol/fetch-api/`。

## TinyEditor 富文本編輯器

全局組件 `TinyEditor` 基於 TinyMCE 8 self-hosted（GPLv2）＋ `@tinymce/tinymce-vue` wrapper。

**基本用法**：
```vue
<TinyEditor v-model="content" />
```

**Props**：
| Prop | 型別 | 說明 |
|------|------|------|
| `modelValue` | `string` | HTML 字串（v-model） |
| `initOverrides` | `Record<string, any>` | 覆寫 TinyMCE init 配置 |
| `disabled` | `boolean` | 進入唯讀狀態 |

**客製工具列／plugins**：修改 `app/utils/tinymce-config.ts`（tinymceToolbar、tinymcePlugins、tinymceDefaultInit），組件端無感。使用單一頁覆寫則傳 `initOverrides`。

**圖片上傳**：內建 `images_upload_handler` 呼叫 `$api.ApiTinymceUpload`（POST `/nuxt-api/tinymce/upload`，回傳 `{ data: { url }, status }`）。骨架 API 目前僅回傳 placeholder URL。

**SSR 安全**：組件內部以 `<ClientOnly>` 包裹，伺服器端渲染時顯示 loading placeholder，不存取 `window`/`document`。

**靜態資源**：`npm install` 時 postinstall 會自動把 `node_modules/tinymce/` 複製到 `public/tinymce/`（已 gitignore）。升級 TinyMCE 僅需 `npm update tinymce`。
