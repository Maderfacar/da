# 專案任務清單 (Project Tasks & Backlog)

**總進度**：Stage 6 進行中（約 85%）  
**最後更新**：2026/04/30

---

## Stage 0：需求與規則最終確認

- [✅] 完成 prd.md
- [✅] 完成 tech-stack.md
- [✅] 完成 style-guide.md
- [✅] 完成 folder-structure.md
- [✅] 完成 agent-protocols.md（適配 Claude Code）
- [✅] 完成 roadmap.md
- [✅] 完成 tasks.md
- [✅] 完成 decision-log.md
- [✅] 完成 git-workflow.md
- [✅] 完成 naming-conventions.md
- [✅] 完成 api-contracts.md
- [✅] 完成 testing-strategy.md

**Stage Gate**：✅ 所有文件完成，已整合至 docs/

---

## Stage 1：環境初始化與規則設定

- [✅] 建立 Nuxt 4 專案（使用企業樣板）
- [✅] 設定 TypeScript + ESLint
- [✅] 安裝 Tailwind CSS（@nuxtjs/tailwindcss）
- [✅] 安裝 Firebase + firebase-admin
- [✅] 安裝 @line/liff
- [✅] 設定 .env.dev（FIREBASE_* / LINE_LIFF_* 欄位）
- [✅] 更新 nuxt.config.ts（runtimeConfig Firebase + LIFF）
- [✅] 建立三端路由骨架（乘客 5 頁 / 司機 4 頁 / 管理者 3 頁）
- [✅] 建立 BFF API 骨架（maps/distance、flight/status、trip/sync）
- [✅] 建立 StoreAuth / StoreTrip / StoreOrder
- [✅] 建立 app/plugins/auth.client.ts（Firebase onAuthStateChanged）
- [✅] 建立 docs/ 規格文件目錄
- [✅] 更新 CLAUDE.md 加入 docs/ 知識庫引用
- [✅] **Stage Gate**：pnpm build 通過 + pnpm lint 通過

---

## Stage 2：基礎原子組件開發

- [✅] 建立 UiButton（Primary / Secondary / Glass 三種變體）
- [✅] 建立 UiInput（支援 Light / Dark Mode）
- [✅] 建立 UiCard（Glassmorphism 效果）
- [✅] 建立 UiModal
- [✅] 建立 UiToast / UiBadge
- [✅] 建立元件展示頁 `/demo/components`
- [✅] **Stage Gate**：展示頁樣式正確 + build 通過

---

## Stage 3：佈局與靜態頁面

- [✅] 建立乘客端 Layout（front-desk：固定頂部 Nav + 底部 5-Tab Bar）
- [✅] 建立司機端 Layout（driver：深色頂部 Nav + 底部 4-Tab Bar）
- [✅] 建立管理者端 Layout（back-desk：Hamburger + 左側抽屜 280px）
- [✅] 實作路由守衛 middleware（auth + role）
- [✅] 首頁與所有頁面抽換為正式 Layout（移除頁面內暫時 nav）
- [✅] **Stage Gate**：三端頁面可切換 + lint ✅ + build ✅

---

## Stage 4：邏輯實作與狀態管理

- [✅] 完整實作 LINE LIFF 登入流程（line-exchange API 500 修復、authResolved 無限 loading 修復）
- [✅] 完整實作 Firebase Auth 狀態機（onAuthStateChanged finally 保證 authResolved 設定）
- [✅] 修復 SSR Hydration mismatch（司機端/Admin 改 CSR；乘客端殘留警告待後續追蹤）
- [✅] 乘客訂單建立表單（4 步驟：行程類型/地址/車種/計價）
- [✅] Google Maps 地址自動完成（UiGooglePlaceInput + BFF autocomplete / place-details）
- [✅] Google Maps 路線規劃（MapRoutePreview：BFF Route API → encoded polyline → Polyline 繪製 + fitBounds）
- [✅] Drop Pin 互動（地圖點擊 / 長按 → 逆向地理編碼 → 更新地址欄位，blur 延遲修正時序）
- [✅] 台灣本島地理圍欄（strictBounds + 服務端驗證 + 前端錯誤提示）
- [✅] 共用計價公式（shared/pricing.ts：車種起跳費 + perKm + 額外服務 × 200，進位至 50）
- [✅] 停靠站距離即時計算（GetMapsRoute 含 waypoints，停靠站填入後自動更新里程與車程）
- [✅] **Stage Gate**：表單 E2E 手動驗收通過（testMode bypass 可在 localhost 完整走完 4 步驟訂車流程）

---

## Stage 5：資料串接與持久化

- [✅] Firebase Firestore 訂單 CRUD（POST 寫入 + GET 查詢 + /upcoming 接真實資料）
- [✅] 司機位置即時更新（PUT location BFF + GET available + /driver/trip 任務頁 + /admin/war-room 地圖）
- [✅] 航空 API 串接（server/api/flight.get.ts Mock Aviation Edge + 訂單表單自動填入航廈）
- [✅] LINE Webhook 建立（HMAC 簽名驗證 + follow 歡迎訊息 + text 自動回覆）
- [✅] liff.getFriendship() + 加好友提醒橫幅（乘客端 layout）
- [✅] 機場人流預測（Firestore airport_flow + n8n POST API + /admin/traffic Chart.js 24h 圖）
- [✅] LINE Bot 訂單推播通知（訂單建立後主動推播乘客 LINE 確認訊息）
- [✅] 補完所有 driver / admin 路由頁面 UI（driver dashboard/pending/trip/profile；admin orders/notifications/drivers/settings）
- [✅] **Stage Gate**：MVP 核心流程可跑通（乘客訂車→Firestore→LINE 推播→司機端可見→Admin 可查）

---

## Stage 6：測試、優化與部署

- [✅] Vitest 單元測試（shared/pricing.ts — 8 tests passed）
- [✅] 首頁統計列改版為機場翻牌效果（Split-flap Display）
  - 新增 `SplitFlapChar.vue`（單字元翻牌動畫，CSS perspective + backface-visibility）
  - 新增 `SplitFlapBoard.vue`（字串容器，charDelay stagger）
  - 取代舊有跑馬燈 flip-in 動畫
- [✅] 多語系（i18n）完整覆蓋 — **Layer 1：核心頁面**
  - 安裝 `@nuxtjs/i18n` v10.2.4，strategy `prefix_except_default`，支援 zh / en / ja
  - `home/index.vue`、`booking/index.vue`、`upcoming/index.vue`、`fleet/index.vue` 全面改用 `$t()`
  - 三語系翻譯檔建立（`i18n/locales/zh.js` / `en.js` / `ja.js`）
- [✅] 多語系（i18n）完整覆蓋 — **Layer 2：乘客端組件層**
  - `BookingStepType.vue`、`BookingStepRoute.vue`、`BookingStepOptions.vue`、`BookingStepConfirm.vue`
  - `BookingLocationInput.vue`、`GooglePlaceInput.vue`、`MapRoutePreview.vue`
  - `booking/index.vue` 成功畫面（`訂單送出成功` / `訂單編號` / `再次訂車`）全面 i18n
  - 修復 `ja.js` 遺漏整個 `booking.nav/type/route/options/confirm` 區塊（Playwright E2E 發現）
  - 補齊 `en.js` / `ja.js` 缺少的 `map.*` 與 `ui.*` 頂層翻譯區塊
- [✅] Playwright E2E 測試（15/15 通過）
  - 語系切換 URL 路由驗證（zh / en / ja）
  - 各語系 booking step 標籤確認無殘留硬編碼中文
  - 首頁 Split-flap board 無 JS 錯誤
  - 翻譯鍵缺失警告（`[vue-i18n] Not found`）全零
- [✅] 修復 `loading/page.vue` `.is-hide` 缺少 `pointer-events: none`（遮罩 600ms 攔截點擊問題）
- [✅] 行動版與 Dark Mode 完整測試
  - Playwright config 新增 `mobile-chrome`（Pixel 5, 393px）與 `iphone-14`（390px）兩個 project
  - 新增 `tests/e2e/mobile.spec.ts`（17 個測試）：Nav/TabBar 不溢出、無橫向 overflow、LangSwitcher 下拉、司機端深色 Nav 背景驗證
  - `i18n.spec.ts` KNOWN ISSUE test 更新為正向斷言（ja.js bug 已修復）
  - 程式碼審查：375/390px 版面數學驗算通過，`padding-top:56px` / `env(safe-area-inset-bottom)` 均已正確實作
  - 修復 `BookingStepType.vue` emit overload lint 警告（`@typescript-eslint/unified-signatures`）
  - 修復 `MapRoutePreview.vue` empty arrow function lint 警告（`no-empty-function`）
  - `pnpm build` ✅ `pnpm lint`（app 程式碼）✅
- [✅] 部署至 Vercel（v0.3.13 已 push，Vercel 自動部署）
- [✅] **Stage Gate**：行動版測試通過 + Vercel 部署成功確認（待人類最終確認）

---

**使用規則**
- 每完成一個子任務，立即更新狀態（[ ] → [✅] 或 [🔄]）
- 重大決策必須同步記錄至 docs/decision-log.md

**版本紀錄**
- 版本：v2.6（Stage 6 完成 — 行動版測試 + Stage Gate）
- 更新日期：2026/04/30
