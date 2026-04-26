# 專案任務清單 (Project Tasks & Backlog)

**總進度**：Stage 4 進行中  
**最後更新**：2026/04/26

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
- [ ] 修復 SSR Hydration mismatch 警告
- [ ] 乘客訂單建立表單
- [ ] Google Maps 路線計算與計價
- [ ] **Stage Gate**：表單與計價功能正確

---

## Stage 5：資料串接與持久化

- [ ] Firebase Firestore 訂單 CRUD
- [ ] 司機位置即時更新
- [ ] 航空 API 串接
- [ ] LINE Bot 推播通知
- [ ] **Stage Gate**：MVP 核心流程可跑通

---

## Stage 6：測試、優化與部署

- [ ] Vitest 單元測試
- [ ] Playwright E2E 測試
- [ ] 行動版與 Dark Mode 完整測試
- [ ] 部署至 Vercel
- [ ] **Stage Gate**：測試通過 + 部署成功

---

**使用規則**
- 每完成一個子任務，立即更新狀態（[ ] → [✅] 或 [🔄]）
- 重大決策必須同步記錄至 docs/decision-log.md

**版本紀錄**
- 版本：v1.5（Stage 4 進行中 — LINE LIFF + Firebase Auth 登入流程完成）
- 更新日期：2026/04/26
