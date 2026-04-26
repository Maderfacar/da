# 技術棧文件 (Tech Stack)

> ⚠️ **適配說明**：原始規格由 Brain AI 以 Nuxt 3 + pnpm 設計，Execution AI 實作時已適配至 **Nuxt 4 + pnpm**。詳見 decision-log.md。

## 1. 開發環境

- **Node.js 版本**：`22.x`（本機開發用 24.x 亦可，CI/Vercel 以 22.x 為準）
- **套件管理器**：pnpm（`packageManager: pnpm@10.33.2`）
- **開發作業系統**：Windows

## 2. 前端核心框架

- **框架**：Nuxt **4**（app/ 目錄架構）
- **UI 框架**：Vue 3（Composition API，全部使用 `<script setup lang="ts">`）
- **語言**：TypeScript（嚴格模式）
  - 嚴禁使用 `any` 型別
  - 所有元件、函式、狀態、API 回應必須有明確型別定義

## 3. UI 與視覺設計

- **樣式框架（原子元件）**：Tailwind CSS（@nuxtjs/tailwindcss）
- **業務元件框架**：Element Plus（@element-plus/nuxt，現有樣板）
- **設計系統**：Editorial Horizon（見 docs/style-guide.md）
- **SCSS 工具**：全局注入 config / colors / fn / mixin / font-size / rwd（Vite additionalData）

**使用原則：**
- 自定義 Ui* 原子元件 → Tailwind + Editorial Horizon
- 複雜業務表單/表格/彈窗 → Element Plus

## 4. 部署（Vercel）規範

- **平台**：Vercel（Nuxt framework 自動偵測）
- **設定檔**：`vercel.json`（僅允許 `framework`、`installCommand`、`buildCommand`、`functions`、`routes`、`rewrites`、`headers`、`redirects` 等官方 schema 欄位）
- **❌ 禁止**：在 `vercel.json` 使用 `nodeVersion` 欄位（該欄位不存在於 Vercel schema，會造成 validation error）
- **❌ 禁止**：`framework` 值使用 `"nuxt"`（不存在），**必須使用 `"nuxtjs"`**
- **Node.js 版本控制**：透過 `package.json` 的 `engines.node` 指定（如 `"22.x"`），Vercel 會自動讀取；不可在 `vercel.json` 設定
- **pnpm build scripts**：pnpm v10 預設封鎖原生套件的 build script；需在 `package.json` 的 `pnpm.onlyBuiltDependencies` 白名單列出（`esbuild`、`@parcel/watcher`、`protobufjs`、`unrs-resolver`、`@firebase/util`）

```json
// vercel.json 正確格式
{
  "framework": "nuxtjs",
  "installCommand": "pnpm install",
  "buildCommand": "pnpm build"
}
```

## 5. 狀態管理與資料獲取

- **狀態管理**：Pinia（@pinia/nuxt）
- **API 請求**：Nuxt 內建 `$fetch` / `useFetch`；業務 API 透過 `app/protocol/fetch-api/` 的 `$api`

## 5. 後端架構（BFF）

- **後端實現**：Nuxt Nitro（`server/api/` + `server/routes/nuxt-api/`）
- **資安鐵律**：所有外部 API 呼叫必須透過 Nitro 轉發，嚴禁客戶端直接呼叫或暴露金鑰
- **環境變數**：`.env.dev`，使用 `useRuntimeConfig()` 存取

## 6. 資料庫與身份驗證

- **資料庫**：Firebase Firestore
- **身份驗證**：Firebase Auth（`firebase` 套件）
- **後端管理**：firebase-admin（server only）
- **初始化掛載點**：`app/plugins/auth.client.ts`（Client-only Plugin）

## 7. LINE 整合

- **登入**：LINE LIFF（`@line/liff`，動態 import，client-only）
- **推播通知**：LINE Bot（LINE_CHANNEL_ACCESS_TOKEN，伺服器端呼叫）

## 8. 多語系

- **模組**：@nuxtjs/i18n
- **支援語言**：繁體中文 zh（預設）、英文 en、日文 ja
- **策略**：prefix_except_default

## 9. 外部服務（已確認）

- **地圖與定位**：Google Maps API（路線、距離、地理圍欄）→ 透過 server/api/maps/ 代理
- **航班資訊**：待確認廠商 → 透過 server/api/flight/ 代理
- **LINE LIFF + LINE Bot**：登入與推播

## 10. 嚴格禁止

- 未更新 tech-stack.md 並經架構師確認前，嚴禁安裝新套件
- 禁止在客戶端直接呼叫外部 API
- 禁止使用 `any` 型別
- 禁止使用 `ElMessageBox.confirm/prompt`（改用 `UseAsk()`）

## 11. 待確認清單

| 項目 | 狀態 | 備註 |
|------|------|------|
| 航空 API 廠商 | ⏳ 未確定 | AviationStack / FlightAware 等 |
| 地理圍欄實作方式 | ⏳ 未確定 | Google Maps Geocoding or GeoJSON |
| Tailwind config 語義化顏色 | ⏳ 待建立 | 見 docs/style-guide.md |

---

**版本紀錄**
- 版本：v1.3（適配 Nuxt 4 + pnpm + Element Plus）
- 更新日期：2026/04/26
