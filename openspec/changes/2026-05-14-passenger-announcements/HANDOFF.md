# HANDOFF — P37 乘客端發佈消息（待接 Phase 3）

> **目的**：給接下個對話的 Claude 一份「30 秒上手」摘要。詳細 spec 看同目錄 [proposal.md](proposal.md) / [design.md](design.md) / [tasks.md](tasks.md)。

---

## 當前狀態（2026-05-14）

| 項目 | 值 |
|---|---|
| worktree 路徑 | `C:\Users\awfulone\Desktop\Projects\cc_da\.claude\worktrees\passenger-announce` |
| branch | `claude/passenger-announce` |
| main HEAD | `3fc5999`（Phase 2 完成） |
| origin/main HEAD | 同上（每 Phase 都 push origin :main）|
| 下一步 | **Phase 3：Admin 編輯器**（1.5 天）|

## Phase 進度

| Phase | 狀態 | commit |
|---|---|---|
| 0 — Spec 三件套 | ✅ | `800d87e` + `1f5fa64`（v2 refinement） |
| 1 — Layout 改 hamburger drawer | ✅ | `b99da52` |
| 2 — Firestore schema + admin CRUD API | ✅ | `3fc5999` |
| **3 — Admin 編輯器** | ⏳ **下一步** | — |
| 4 — LINE 推送整合（含訂單事件 5 點 + admin 手動推） | ⏳ | — |
| 5 — 乘客端 /notifications 頁 | ⏳ | — |
| 6 — 收尾（i18n / e2e / decision-log） | ⏳ | — |

## Brain AI 已拍板決策（不要回頭問）

1. **Layout**：admin 風格 hamburger drawer（桌機也 hamburger 收合，不做 sticky）
2. **Q2 訂單推**：c — 自動事件推（pending/confirmed/en_route/completed/cancelled）+ admin 手動推單筆，**移除 arrived_pickup**
3. **Rich 等級**：L1（標題 + 內文 + 1 張封面圖 + 1 個 CTA 按鈕）
4. **解耦**：b — admin 發佈時 `channels.line` / `channels.inApp` 兩個獨立 checkbox
5. **Drawer menu 順序**：最新消息（紅點）/ 訂車 / 我的行程 / 歷史訂單 / 車型介紹 / 個人設定 / 客服
6. **無登出 / 無「首頁」menu item**（logo 點擊回 /home，沿用乘客端無登出政策 `473ada0`）
7. **status 可循環**：draft ↔ published ↔ archived 任意流轉；published/archived 都可編輯刪除；archived 可重新發佈（重發會再推 LINE）；純編輯 published 不重推
8. **LINE push 觸發精確判定**：`oldStatus !== 'published' && newStatus === 'published'`

## Phase 3 範圍（依 tasks.md 3.1-3.4）

### 3.1 改寫 `/admin/notifications` 列表頁

- 檔案：[app/pages/admin/notifications/index.vue](app/pages/admin/notifications/index.vue)（**327 行整檔替換**，舊版只做 in-memory broadcast，全部砍掉重寫）
- 三 tab：草稿 / 已發佈 / 已下架（query state 同步 URL）
- 列表卡片：標題 / 目標 / 推送統計 / 動作按鈕依 status 動態
  - **draft**：編輯 / 發佈 / 刪除
  - **published**：編輯 / 下架 / 刪除（編輯不重推 LINE，提示文案）
  - **archived**：編輯 / **重新發佈**（UseAsk 二次確認警告會再推 LINE）/ 刪除
- 「新增公告」按鈕 → 開編輯彈窗（mode='create'）
- 列表 polling 不需要（admin 主動切 tab 即重撈）

### 3.2 編輯彈窗

- 新檔：`app/components/open/dialog/announcement/Edit.vue`
- 走 `$open` + StoreOpen 系統（看既有 `app/components/open/dialog/*` pattern）
- 表單欄位（驗證對齊 [server/utils/announcement.ts](server/utils/announcement.ts) `validateAnnouncementBody`）：
  - `title`：input，maxlength 60，必填
  - `body`：**TinyEditor** 元件（專案已整合，看 `.claude/knowledge/frontend-conventions.md` 提到的 TinyEditor 章節 + grep `tinymce` 找既有使用範例如 `app/components/...` 內 rich text 欄位）
  - `coverImageUrl`：自製 image upload 元件（拖放 / 點擊上傳 → POST `/nuxt-api/admin/announcements/upload-cover` multipart）+ 預覽 + 刪除
  - `ctaButton`：optional fieldset（toggle 顯示），含 `label`（maxlength 20）+ `url`（必須 https://）
  - `targetType` radio：all / passenger / driver / order
    - 選 `order` 時下拉顯示 `targetOrderId` 輸入框
  - `channels`：兩個獨立 checkbox `line` / `inApp`，**至少擇一**（前端 + server 都驗）
- 動作 button：「儲存草稿」/「立即發佈」/「取消」
- 編輯既有公告（mode='edit'）：載入 GET `/nuxt-api/admin/announcements/[id]` 填表
- mode='republish'（archived 重發按鈕觸發）：跟 edit 一樣但 publish button 文字改「重新發佈」+ 紅色警示色

### 3.3 即時預覽（分割畫面右側）

- LINE Flex preview：用設計 §3 的 Flex JSON 結構手刻一個 Vue 元件渲染（**不接 LINE API**，純前端視覺模擬）
- App 內卡片 preview：複用 Phase 5 的詳情元件（**Phase 3 先做 App preview 樣式，Phase 5 reuse**）
- 響應式：手機螢幕把預覽折疊，給 「切到預覽 tab」 按鈕

### 3.4 API protocol 接線

- 看既有 [app/protocol/fetch-api/api/admin/](app/protocol/fetch-api/api/admin/) 結構（已有 `users` / `admins` / `audit-logs` / `drivers` / `broadcast` 模組）
- 新增 `app/protocol/fetch-api/api/admin/announcement/` 目錄：
  - `index.ts`（exports）
  - `type.d.ts`（`Announcement` interface 對齊 [server/utils/announcement.ts](server/utils/announcement.ts) AnnouncementDoc）
  - 個別 method 檔（GetAnnouncementList / GetAnnouncementDetail / CreateAnnouncement / PatchAnnouncement / DeleteAnnouncement / UploadAnnouncementCover）
- [app/protocol/fetch-api/api/admin/index.ts](app/protocol/fetch-api/api/admin/index.ts) 主檔匯出新模組

## 已知陷阱 / 不該重做

1. **firestore.rules 尚未部署**：Phase 2 已改 rules（加 announcements + announcement_reads 規則）但需 user 手動到 Firebase Console 部署。Phase 3 開工前**提醒 user 部署**，否則 admin client SDK 讀 announcements 會被擋。
2. **PATCH publish 區塊的 LINE push 是 stub**：[server/routes/nuxt-api/admin/announcements/[id].patch.ts](server/routes/nuxt-api/admin/announcements/[id].patch.ts) 內 `update.pushStats.sentCount = 0` 留 `// TODO Phase 4` 標記。**Phase 3 不要動這段**，Phase 4 才接 sendLinePush + Flex builder。
3. **無登出按鈕**：乘客端 layout 沒有登出，drawer 也沒有。沿用 `473ada0` 既有政策，**不要加回去**。
4. **CommonDrawer 版本號 hardcode `v0.3.20`**：[app/components/common/CommonDrawer.vue:27](app/components/common/CommonDrawer.vue) 寫死，Phase 6 收尾改接 runtimeConfig 或 ~~/version 同源。Phase 3 不用動。
5. **Phase 4 觸發點 5 個**：pending（**在 orders/index.post.ts**，新增點）+ confirmed/en_route/completed/cancelled（在 [orderId].patch.ts），**不推 arrived_pickup**。Phase 4 才做這段。
6. **i18n 政策**：admin/driver 不做 i18n（沿用 CLAUDE.md），但**乘客端必須三語**。Phase 3 admin 編輯器全繁中即可。

## 驗證 baseline

Phase 2 結束時：
- `pnpm lint` ✅
- `pnpm build` ✅
- 6 個 admin endpoints chunks 進 .output（含 `index.get*` 被 Nitro hoist 到 admin/ 用數字後綴命名規律）
- worktree clean

## 開新對話起手 prompt 建議

> 接 P37 Phase 3：admin 公告編輯器。worktree 路徑 `C:\Users\awfulone\Desktop\Projects\cc_da\.claude\worktrees\passenger-announce`，branch `claude/passenger-announce`，當前 HEAD `3fc5999`。先讀 `openspec/changes/2026-05-14-passenger-announcements/HANDOFF.md` 取完整脈絡，然後依 tasks.md Phase 3 開工。每 Phase 結束 commit + push origin :main（不 push branch）。

## 後續 Phase 4-6 提示（避免新對話踩雷）

- **Phase 4 重點**：擴 [server/utils/line-push.ts](server/utils/line-push.ts) `LineMessage` 為 union（text / flex）；新增 `server/utils/announcement-flex.ts` Flex builder（規格在 design.md §3）；新增 `server/utils/i18n-message.ts`（5 個 `order.*` 三語訊息表）；改 [orders/index.post.ts](server/routes/nuxt-api/orders/index.post.ts)（pending push）+ [orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts)（4 個 status push）+ [admin/orders/[orderId]/notify.post.ts](server/routes/nuxt-api/admin/orders/[orderId]/notify.post.ts)（擴 target='passenger'）+ [[orderId].patch.ts] 內 Phase 2 留的 TODO（sentCount 從 stub 改實推結果）
- **Phase 5 重點**：新增 3 個 passenger endpoints + `/notifications/index.vue` + `/notifications/[id].vue` + drawer 紅點 polling 接通
- **Phase 6 重點**：i18n 對齊（zh/en/ja `notifications.*` keys）+ decision-log 紀錄 + tasks.md P 編號（建議 P37）+ version bump
