# 開發 Roadmap（7 階段開發計劃）

嚴格按照本文件順序執行，不得跨階段跳躍。每個 Stage 結束必須通過 Stage Gate（build + lint + tasks.md 更新 + 人類確認）。

---

## Stage 0：需求與規則最終確認（The Constitution）

**目標**：在寫任何一行程式碼之前，先把專案的「法律」全部立好。

**主要任務：**
- 完成並確認所有核心 docs/ 文件
- 進行文件一致性檢查
- 產生 tasks.md 完整任務清單

**完成標準**：所有文件經人類確認無誤  
**狀態**：✅ 完成

---

## Stage 1：環境初始化與規則設定（The Law）

**目標**：建立可正常運行的開發環境。

**主要任務：**
- 建立 Nuxt 4 專案與基礎套件（已使用樣板）
- 設定 Tailwind、TypeScript、Firebase、LINE LIFF、Pinia
- 建立所有規則文件（docs/ 目錄）
- 設定 .env.dev

**完成標準**：執行 `pnpm dev` 可正常看到頁面，build 通過  
**狀態**：✅ 完成

---

## Stage 2：基礎原子組件開發（The Atoms）

**目標**：建立統一、美觀的基礎 UI 元件。

**主要任務：**
- 開發 UiButton、UiInput、UiCard 等原子元件
- 所有元件遵循 美式復古機場風 設計系統（style-guide.md v2.0）
- 支援 Light / Dark Mode

**完成標準**：元件展示頁面樣式正確，build 通過  
**狀態**：✅ 完成

---

## Stage 3：佈局與靜態頁面（The Shell）

**目標**：搭建完整的網站骨架。

**主要任務：**
- 建立三端 Layout（乘客、司機、管理者）
- 建立靜態頁面框架（路由已在 Stage 1 建立）
- 實作路由守衛（authResolved 等待）

**完成標準**：可正常切換頁面，佈局在手機上顯示良好  
**狀態**：✅ 完成

---

## Stage 4：邏輯實作與狀態管理（The Logic）

**目標**：讓網站開始有互動功能。

**主要任務：**
- LINE LIFF 登入流程（StoreAuth.InitAuthFlow 已建立骨架）
- 訂單表單邏輯與 Google Maps 計價
- Pinia 狀態管理（StoreTrip、StoreOrder 已建立骨架）

**完成標準**：表單可正常操作，計價功能正確  
**狀態**：✅ 完成（2026/04/27）

---

## Stage 5：資料串接與持久化（The Soul）

**目標**：完成 MVP 核心功能。

**主要任務：**
- Nitro 後端 API 完整實作（BFF 骨架已建立）
- Firebase Firestore 資料儲存
- 航空 API 與 LINE Bot 通知
- 司機位置地圖顯示

**完成標準**：可完整走完訂車到通知的主要流程  
**狀態**：✅ 完成（2026/04/28）

---

## Stage 6：測試、優化與部署準備（The Polish）

**主要任務：**
- 測試（Vitest + Playwright）
- 多語系（i18n）完整覆蓋
- 首頁視覺強化（Split-flap Board）
- 行動版優化
- 部署至 Vercel

**完成標準**：測試通過，staging 環境部署成功

**目前進度（2026/04/30）**：
- ✅ Vitest 單元測試（8 tests）
- ✅ Split-flap Display（SplitFlapChar + SplitFlapBoard）
- ✅ i18n Layer 1：核心頁面（home / booking / upcoming / fleet）
- ✅ i18n Layer 2：乘客端組件（7 個 passenger 組件 + booking 成功畫面）
- ✅ Playwright E2E（15/15 通過）
- 🔄 行動版測試 / Vercel 部署確認

---

## Stage 7：維護與迭代（The Evolution）

**目標**：建立長期維護機制。

---

**版本紀錄**
- 版本：v1.6（Stage 6 進行中 — i18n + E2E 完成）
- 更新日期：2026/04/30
