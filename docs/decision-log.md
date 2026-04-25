# 決策紀錄 (Decision Log)

每次重大決策或新增套件時，必須立即更新此檔案（時間由新到舊）。

格式：**日期** / **類型** / **標題** / **背景** / **決定** / **影響** / **替代方案**

---

### 2026/04/26 — _docs 規格文件整合至 cc_da

**決策類型**：開發流程  
**標題**：將 Brain AI 產出的 _docs 規格文件整合至 Execution AI 工作的 cc_da 專案  
**背景**：Brain AI 在 `C:\Projects\_docs\` 下產出了完整的 DestinationAnywhere 規格文件體系，需要與 Execution AI 的 cc_da 樣板合併。  
**決定**：
- 所有業務文件放入 `docs/` 目錄
- 技術文件適配至 Nuxt 4 + pnpm + Element Plus 現況
- `.windsurfrules` / `agent-protocols.md` 功能由 `CLAUDE.md` 取代（Claude Code 生態）
- 保留樣板原有的 `CLAUDE.md` / `.claude/knowledge/` 規範體系  

**影響**：整個開發流程，開發者需閱讀 `docs/` 了解業務背景  
**相關文件**：CLAUDE.md、docs/tech-stack.md

---

### 2026/04/26 — 安裝 @line/liff

**決策類型**：套件新增  
**標題**：安裝 LINE LIFF SDK  
**背景**：StoreAuth.InitAuthFlow() 需要 LIFF 初始化，`_InitLiffFlow()` 動態 import `@line/liff`  
**決定**：`pnpm add @line/liff`，動態 import 確保不進入 server bundle  
**影響**：app/stores/5.store-auth.ts、app/plugins/auth.client.ts  
**相關文件**：docs/tech-stack.md

---

### 2026/04/26 — Firebase Auth 掛載點決策

**決策類型**：技術選擇  
**標題**：選擇 `app/plugins/auth.client.ts` 作為 Firebase Auth 初始化掛載點  
**背景**：`onAuthStateChanged` 不能放在 middleware（每次路由都觸發），不能放在 app.vue（過度臃腫）  
**決定**：建立 `.client.ts` plugin，只在瀏覽器端執行，呼叫 `StoreAuth().InitAuthFlow()`  
**影響**：SSR 安全，app.vue 保持乾淨  
**替代方案**：在 middleware 用 authResolved flag 等待 → 已捨棄

---

### 2026/04/24 — 技術棧初始化

**決策類型**：技術棧選擇  
**標題**：選擇 Nuxt 4 + Vue 3 + Firebase + LINE LIFF 作為主要技術棧  
**背景**：需要快速開發三端（乘客、司機、管理者）訂車平台，LINE 生態整合是核心需求  
**決定**：
- 前端框架：Nuxt 4 + Vue 3 Composition API + TypeScript
- 樣式：Element Plus（企業樣板） + Tailwind CSS（設計系統補充）
- 後端：Nitro（server/api/ BFF 模式）
- 資料庫與認證：Firebase Firestore + Firebase Auth
- 登入方式：LINE LIFF
- 多語系：繁中（zh）+ 英文（en）+ 日文（ja）  

**影響**：整個專案技術架構  
**相關文件**：docs/tech-stack.md、docs/prd.md

---

### 2026/04/24 — 設計系統選擇

**決策類型**：設計規範  
**標題**：採用 Editorial Horizon 設計系統（Tailwind CSS）與 Element Plus 並行  
**背景**：企業樣板已整合 Element Plus，新 UI 元件採用 Tailwind + Editorial Horizon  
**決定**：
- Element Plus 用於複雜業務元件（表格、表單、彈窗）
- 自定義 Ui* 元件採用 Tailwind Editorial Horizon 風格  

**影響**：所有前端元件  
**相關文件**：docs/style-guide.md

---

**版本紀錄**
- 版本：v1.1
- 更新日期：2026/04/26
