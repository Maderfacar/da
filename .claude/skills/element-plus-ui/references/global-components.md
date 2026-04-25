# 自定義全局組件

本專案的全局組件皆位於 `app/components/`，透過 Nuxt 自動引入，無需手動 `import`。根據 `nuxt.config.ts` 設定，`loading/page.vue` 與 `open/group/index.vue` 兩個檔案排除自動註冊，其餘皆可直接於模板使用。

## 自訂封裝（app/components/el/）

針對 Element Plus 做最小化二次封裝，檔名以 `-plus` 結尾：

| 元件 | 檔案 | 用途 |
|------|------|------|
| `ElDialogPlus` | `el/dialog-plus.vue` | 對 `ElDialog` 加上 `$open` 系統整合與預設樣式 |
| `ElDrawerPlus` | `el/drawer-plus.vue` | 對 `ElDrawer` 的再封裝（同上） |
| `ElImagePlus` | `el/image-plus.vue` | 圖片顯示，整合 loading / 預設佔位 |
| `ElPaginationPlus` | `el/pagination-plus.vue` | 分頁器，預設使用 `layout="total, prev, pager, next"` |
| `ElPopoverPlus` | `el/popover-plus.vue` | 彈出層，整合 `$open` |

> 元件名稱對應 Nuxt 的 PascalCase 推導；使用時以 `<el-dialog-plus>` 或 `<ElDialogPlus>` 皆可。

## 業務彈窗（app/components/open/）

使用 `$open` 全局工具觸發，對應目錄：

| 子目錄 | 用途 |
|--------|------|
| `open/dialog/` | 中央彈窗業務元件（例如 `demo.vue`） |
| `open/drawer/` | 抽屜式業務元件（例如 `demo/`） |
| `open/group/` | 彈窗群組容器（`index.vue` 已被排除自動註冊，由 `StoreOpen` 管理） |

新增業務彈窗時請遵循命名規則：`OpenDialog{業務名稱}{模式}.vue`（`Info` / `Edit` / `Create`）；檔案放入 `open/dialog/` 或 `open/drawer/` 後即可透過 `$open.OnOpen('OpenDialogXxx', payload)` 開啟。

## 展示用元件（app/components/demo/ 與 loading/）

| 目錄 | 說明 |
|------|------|
| `demo/` | 範例頁面元件（`item1.vue` 等），可作為新增頁面時的參考模板 |
| `loading/` | 全頁 Loading（`page.vue` 已排除自動註冊，需手動 `import` 使用） |

## 新增全局元件的檢查清單

- [ ] 檔案置於 `app/components/` 下的正確分類目錄
- [ ] 若是 `ElXxx` 的封裝，檔名加上 `-plus` 結尾避免與原生元件衝突
- [ ] 於 `<script setup lang="ts">` 內按 SFC 區塊順序撰寫
- [ ] 若需 `$open` 開啟，請新增至 `app/components/open/{dialog,drawer}/`
