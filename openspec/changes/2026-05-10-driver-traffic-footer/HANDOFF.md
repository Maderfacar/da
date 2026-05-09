# Hand-off：driver/traffic + driver footer 選單化（給下個 session）

## 目前進度（2026-05-10 收工）

### 上個 session 已完成 commits
- `1991324` feat(p21): mobile responsive Phase 1（admin layout / war-room / orders / traffic）
- `f041340` 棄用 n8n + Gist（**已 revert**：xlsx@0.18.5 cpexcel ESM bundle 失敗導致 server 全域 crash）
- `934051e` Revert
- `3defb2e` 重做：cheerio + xlsx@0.20.3 (CDN) + nitro inline externals + Firestore lazy cache
- `54d6868` admin sidebar 可 toggle + T1/T2 暫時 disable（誤判，下行修正）
- `9dac07f` 真正解析 T1/T2 三區塊（schemaVersion=2，舊 cache 自動覆蓋）

### admin/traffic 現況
- ✅ server 端 cheerio + xlsx 解析桃園機場 XLS
- ✅ Firestore `airport_flow/{date}` lazy cache + 7 天自動清理
- ✅ T1 / T2 / 全端 三選項皆有真實資料（驗證 24/24 sum check 通過）
- ✅ 入境 / 出境 / 進出境合計 三方向皆有真實資料
- ✅ banner 依 mockReason 顯示精準錯誤訊息（4 種：firebase-not-configured / xls-not-found / parse-failed / unknown-error）

### admin layout 現況
- 桌機 ≥ 768px：drawer 初始展開，hamburger 永遠可 toggle，drawer 開啟時 main 用 push 模式（`:has()`）
- 手機 < 768px：drawer overlay 模式（hamburger 控制）

---

## 下個 Session 開場做這些

### 第一件事：讀文件

按順序（總計 ~10 分鐘）：

1. `CLAUDE.md`（根目錄，強制規範）
2. `docs/decision-log.md` 最近 1 條（2026/05/09 機場人流預報架構重構）
3. **`openspec/changes/2026-05-10-driver-traffic-footer/HANDOFF.md`**（本檔）
4. `docs/tasks.md` P19 後續工作 + P21 段落
5. memory 中的 P20 backlog（auto load）

### 第二件事：實作 driver/traffic + driver footer 選單化

**已對齊的設計決策**（不用再問使用者）：

#### A. driver/traffic 新頁
- 路徑：`app/pages/driver/traffic/index.vue`
- layout：`driver`（非 back-desk）
- 共用同一個 server endpoint `/api/airport/flow`，**無新後端**
- 從 admin/traffic 複製大架構並調整：
  - 移除右側「氣象 aside」（手機空間有限）改 chart 下方一個 mini 氣象列（或省略）
  - 移除「調度建議」段（司機不需提醒自己），改成「建議前往機場時段」司機視角文案
  - 移除 admin 專屬的篩選樣式，配合 driver 端視覺風格（可能更精簡）
- 司機視角友善文案：「14:00 — 15:00 預計 7,949 人次到站，建議提前 1 小時待命」之類

#### B. driver footer 5-tab
- 看 `app/layouts/driver.vue` 現有結構（**先讀**才能改）
- 改成 5 個 tab：
  | 順序 | icon | label | 路徑 |
  |------|------|-------|------|
  | 1 | 🎯 | 任務 | `/driver/dashboard` |
  | 2 | 📋 | 搶單 | `/driver/pending` |
  | 3 | ✈️ | 人流 | `/driver/traffic` ← 新增 |
  | 4 | 📊 | 統計 | `/driver/stats` ← 預留路由（先建空頁或註解掉） |
  | 5 | 👤 | 我的 | `/driver/profile` |
- 5-tab 在手機底部剛好。未來若超過 5 個再加「更多 ⋯」二級選單。

#### C. 注意事項
- driver / admin **不做 i18n**（使用者已決議移除此 backlog 項）
- 三端均使用 `middleware: ['auth', 'role']` 守衛，driver 端設 `ssr: false`
- 動 SCSS 前先看 `app/assets/styles/scss-tool/rwd.scss` 既有 mixin 沿用
- `:has()` 選擇器在 LIFF 環境（Chrome 105+）支援沒問題（admin sidebar 已用過）

### 第三件事（可選）：commit + push 後驗證

部署完成後實測：
1. driver LIFF 開 `/driver/traffic` 應該看到圖表 + T1/T2 篩選可用（共用 admin 已建好的 Firestore cache）
2. driver 底部 footer 應該有 5 個 tab，「人流」可點進新頁
3. 統計頁如果先建空頁，應該不會 404

---

## 後續 backlog（依使用者偏好排序）

1. **P21 Phase 2**（admin/drivers / admin/settings 響應式微調 + driver/dashboard / driver/profile stats grid 響應式）— MED 優先
2. **P20 booking 擴充**（contactPhone / flightNumber / terminal / notes 四欄位）— 使用者明確說「乘客端收尾查驗時做」
3. **P19 後續**：訂單推送通知（LINE 訊息）/ passenger 端追蹤司機位置 / driver/dashboard online hours 統計

---

## 關鍵已知資訊

### 部署
- production: https://da-line-liff-app.vercel.app
- branch 模式：`git push origin <local-branch>:main` fast-forward
- 對話用繁中、commit message 用 Conventional Commits 繁中、attribution 已禁用

### 機場人流預報架構（2026-05-09 重構完成）
- **抓取**：server `server/utils/airport-xls-fetcher.ts` 直拼 `taoyuan-airport.com/uploads/fos/{YYYY_MM_DD}.xls`，cheerio fallback
- **下載**：必帶 `User-Agent` + `Referer` headers（反爬蟲）
- **解析**：xlsx 0.20.3（SheetJS 官方 CDN）+ hardcoded col index（[1]=總計出發、[2]=總計抵達、[11/12]=T1、[18/19]=T2）
- **儲存**：Firestore `airport_flow/{date}`，每 doc 216 筆（24h × 9）+ schemaVersion 欄位
- **清理**：寫入時自動刪 7 天前舊 doc
- **Vercel env**：`NUXT_AIRPORT_FORECAST_GIST_URL` 可手動刪除（已不用）

### Vercel ESM 陷阱（已解）
- npm 上 `xlsx@0.18.5` 為 SheetJS 廢版，內部用動態 require 載 cpexcel codepage 檔，Vercel ESM bundle 失敗
- 解法：改用官方 CDN 版 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` + `nuxt.config.ts` `nitro.externals.inline = ['xlsx', 'cheerio']`
- **教訓**：新增 server-side 依賴（特別是 dynamic require）需要單獨 commit 上 Vercel 驗證，不要綁其他 feature

### admin layout（2026/05/09 P21 + hotfix 後）
- `drawerOpen` ref，桌機 onMounted 自動 `true`
- CSS 用 `:has()` 偵測 drawer.is-open 狀態切換 push 模式
- hamburger 永遠可 toggle（無論桌機/手機）

---

## Context 評估

當前 session 已做：
- P21 mobile Phase 1（5 檔案）
- airport-flow 架構重構（n8n → server cheerio + xlsx + Firestore）
- xlsx cpexcel Vercel crash hotfix
- T1/T2 解析誤判 hotfix（重寫 fetcher）

context 已 70%+，繼續做 driver/traffic + footer 邊際太緊。**請開新 session 接手**。

## 給下個 session 的提醒

- 第一件事讀本檔
- 寫 driver/traffic 前先看 admin/traffic 的 template 結構抄一份再改
- 寫 driver footer 前先看 driver layout 現有結構（不要假設）
- driver/stats 路由若決定預留，建空頁或在 nav 註解掉避免 404
- 完成後請使用者用手機 LIFF 實測（driver LIFF endpoint = `/driver/dashboard`），記得用底部 footer 切過去 `/driver/traffic`
