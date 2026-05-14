# Tasks — P42 LINE Richmenu 多語版本

> **總時程**：≈ 1.5-2.5 工作天 / 5 Phase。
> **決策依據**：Brain AI 拍板 [design.md §6](design.md#6-開放問題待-brain-ai-拍板) Q1-Q7（必拍才能進 Phase 1）。
> **推 spec 預設**：Q1=1a / Q2=2b / Q3=3b / Q4=4a / Q5=5a / Q6=6a / Q7=7a

---

## Phase 0：Spec + Brain AI 拍板（0.25 天）

- [x] 0.1 P40 / P43 audit（commits ..1632867 全 push main + firebase deploy rules/indexes 完成 + v0.3.24）
- [x] 0.2 既有 schema 盤點（line-richmenu-doc.ts / i18n-message.ts Lang type / users.lang 寫入路徑為空 / publish.post.ts 走 setDefaultRichmenu）
- [x] 0.3 撰寫 [proposal.md](proposal.md)
- [x] 0.4 撰寫 [design.md](design.md)
- [x] 0.5 撰寫 [tasks.md](tasks.md)（本檔）
- [x] 0.6 commit + push origin HEAD:main（commit `88fd455`）
- [x] 0.7 **Brain AI 拍板 Q1-Q7**（2026-05-15「預設即可」一句 → 全採推 spec 預設 1a/2b/3b/4a/5a/6a/7a）
- [x] 0.8 design.md §7 補拍板紀錄；推 spec 預設全採用故無 section 需重寫 → commit + push → 進 Phase 1

---

## Phase 1：Schema + Binding Helper + Webhook Follow Integration（0.5 天）

> **前置**：Q1 / Q3 / Q5 / Q7 拍板。

### 1.1 Schema 改動（line_richmenus 加 lang field）

- [ ] `server/utils/line-richmenu-doc.ts`：
  - 加 `lang: Lang` 入 `LineRichmenuDoc` interface
  - 加 `lang: Lang` 入 `LineRichmenuDto`
  - `toRichmenuDto` map lang field
  - 加 `validateLang(raw)` validator
- [ ] `server/utils/line-richmenu-doc.ts` 加 `RICHMENU_VALID_LANGS = ['zh_tw', 'en', 'ja']`（避免硬寫多處）

### 1.2 Migration endpoint（既有 active → grandfather zh_tw）

- [ ] 新檔 `server/routes/nuxt-api/admin/migrations/p42-richmenu-lang.post.ts`：
  - super only
  - dry-run mode（`?dryRun=1`）
  - 冪等
  - 對所有 lang 為 null/undefined 的 doc set `lang='zh_tw'`
  - audit log `line.richmenu.migrate.lang`

### 1.3 Binding helper（新 util）

- [ ] 新檔 `server/utils/line-richmenu-binding.ts`：
  - `resolveUserLang(db, lineUid, eventLang?)` — Q3=3b 直接複用 `getUserLang`
  - `loadActiveRichmenuForLang(db, channel, lang)` — Q5=5a fallback chain
  - `bindRichmenuForUser(db, client, lineUid, lang)` — link / unlink + 失敗 return 不 throw
  - 內含 `FALLBACK_CHAIN` 常數（Q5=5a）

### 1.4 Webhook follow event 整合

- [ ] `server/utils/line-channel.ts` follow event 分支：
  - 既有：loadBotReply + _reply（保留）
  - 新增 fire-and-forget IIFE：`resolveUserLang` → `bindRichmenuForUser`
  - 失敗只 console.warn（不破壞 webhook 200 回應）

### 1.5 既有 endpoint 加 lang query filter

- [ ] `server/routes/nuxt-api/admin/line-richmenus/index.get.ts`：
  - query string 加 `lang` filter（optional；不傳 = 全部）
  - 既有 channel / status filter 不變

- [ ] `server/routes/nuxt-api/admin/line-richmenus/index.post.ts`：
  - body 加 `lang` 必填 + validateLang
  - 草稿建立時必填

- [ ] `server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts`：
  - lang field 編輯時 readonly（避免 mid-flight 改 lang）
  - 若 body 含 lang → return badRequestError

### 1.6 Firestore Rules + Indexes

- [ ] `firestore.rules`：line_richmenus rule 不需改動（admin only write 維持）
- [ ] `firestore.indexes.json`：加 composite index `channel ASC + lang ASC + status ASC + createdAt DESC`（loadActiveRichmenuForLang query 用）
- [ ] **Claude 自跑** `npx firebase-tools deploy --only firestore:indexes`

### 1.7 Stage Gate

- [ ] G1.1 lint + build pass
- [ ] G1.2 migration endpoint dry-run 手測（prod doc 影響範圍）
- [ ] G1.3 migration endpoint 正式跑（prod）
- [ ] G1.4 commit + push origin HEAD:main

---

## Phase 2：User Lang Persist Endpoint + Re-bind Hook（0.5 天）

> **前置**：Q2 / Q3 拍板（若 Q2=2a 則本 Phase 跳過、整體估時減 0.5d）。

### 2.1 PATCH /nuxt-api/self/lang endpoint

- [ ] 新檔 `server/routes/nuxt-api/self/lang.patch.ts`：
  - Zod validate body
  - update `users/{lineUid}.lang`
  - 依 auth.roles 推 channels → `bindRichmenuForUser` per channel
  - audit log `user.lang.update`（含 prev / new lang + 重綁結果）

### 2.2 Audit log action 註冊

- [ ] `server/utils/audit-log.ts`：加 `user.lang.update` action + 對應 targetType `user`

### 2.3 Protocol module

- [ ] `app/protocol/fetch-api/api/self/lang.ts`：`PatchSelfLang({ lang }): Promise<...>`
- [ ] `app/protocol/fetch-api/index.ts` wire export

### 2.4 Stage Gate

- [ ] G2.1 lint + build pass
- [ ] G2.2 手測：passenger 切 lang → users.lang 寫入 → 對應 lang richmenu 綁定（或 fallback）
- [ ] G2.3 commit + push origin HEAD:main

---

## Phase 3：Admin UI Per-Lang Management（0.5 天）

> **前置**：Q1 / Q4 / Q6 拍板。

### 3.1 Richmenu tab lang sub-tab

- [ ] `app/pages/admin/line-management/index.vue`：
  - Richmenu tab → channel sub-tab 內加 lang sub-tab（zh_tw / en / ja）
  - lang sub-tab UI 用 ElTabs（與 channel pattern 對齊）
  - 切 lang sub-tab 時 reload list（GET 加 lang query）
  - 卡片內顯示 lang badge（zh / en / ja）

### 3.2 Edit dialog 改動

- [ ] `app/components/open/dialog/line-richmenu/Edit.vue`：
  - 草稿建立 mode：加 lang select 必填（zh_tw / en / ja）
  - 既有編輯 mode：lang field readonly + 顯示
  - 加「從其他 lang 複製」按鈕（在草稿 mode）：彈窗選 source lang doc → 複製 areas + chatBarText + image objectPath

### 3.3 Diagnostics sync-overview 對齊

- [ ] `app/pages/admin/line-management/index.vue` Diagnostics tab sync-overview：
  - 顯示「passenger × zh_tw」「passenger × en」... 三維 grid（不再單 channel 一行）
  - match / orphan / stale 各 grid cell 獨立顯示

### 3.4 i18n locale 三檔加新 key

- [ ] `i18n/locales/zh.js` / `en.js` / `ja.js` 同步加：
  - `admin.lineManagement.richmenu.lang.zh_tw`
  - `admin.lineManagement.richmenu.lang.en`
  - `admin.lineManagement.richmenu.lang.ja`
  - `admin.lineManagement.richmenu.copyFromLang`
  - `admin.lineManagement.richmenu.langRequired`

### 3.5 Stage Gate

- [ ] G3.1 lint + build pass
- [ ] G3.2 手測：admin 在三 lang sub-tab 各建一 draft、publish、看 LINE 同步狀態
- [ ] G3.3 commit + push origin HEAD:main

---

## Phase 4：Publish / Unpublish Lang-Aware + Sync-Overview 對齊（0.5 天）

> **前置**：Q1 / Q5 拍板。

### 4.1 Publish 流程改 lang-aware

- [ ] `server/routes/nuxt-api/admin/line-richmenus/[id]/publish.post.ts`：
  - Firestore tx 改為 archive 同 channel **同 lang** 既有 active（既有為同 channel）
  - LINE API：
    - 既有：createRichmenu + uploadRichmenuImage（若 lineRichMenuId 為 null）
    - 修改：`setDefaultRichmenu` 只在 lang=`zh_tw` 時呼（作為未綁定 user 的 fallback default）
  - **新增**：對既有 user batch re-bind
    - 撈 `users` collection where `lang == publishedLang` limit 100
    - 對每個 user 呼 `linkRichmenuToUser`（throttle 100ms 間隔）
    - 超過 100 → throw badRequest「需 cron job 批次（P50+）」
  - audit log payload 加 `lang` + `rebindStats: { total, success, failed }`

### 4.2 Unpublish 對齊

- [ ] `server/routes/nuxt-api/admin/line-richmenus/[id]/unpublish.post.ts`：
  - 既有：mark archived + clearDefaultRichmenu
  - 修改：clearDefaultRichmenu 只在 lang=`zh_tw` 時呼
  - 新增：對該 lang 既有綁定 user batch unlink（fallback 對應 lang 鏈接 / 或 unlink 看 LINE default）

### 4.3 Test-bind 對齊

- [ ] `server/routes/nuxt-api/admin/line-richmenus/[id]/test-bind.post.ts`：
  - 既有：linkRichmenuToUser（admin 測試用）
  - 不需改動（直接綁該 doc 的 lineRichMenuId，不考慮 user lang）

### 4.4 Sync-overview 對齊

- [ ] `server/routes/nuxt-api/admin/line-richmenus/sync-overview.get.ts`：
  - 既有：本地 docs vs LINE listRichmenus 比對
  - 修改：response 加 `byLang: Record<Lang, OverviewEntry>` 維度
  - cleanup-orphan 不需改動（孤兒邏輯與 lang 無關）

### 4.5 Stage Gate

- [ ] G4.1 lint + build pass
- [ ] G4.2 手測：publish zh_tw → 100 user 內重綁；publish en → 對應 en lang user 重綁
- [ ] G4.3 commit + push origin HEAD:main

---

## Phase 5：E2E + i18n Switcher 前端整合 + Archive（0.25-0.5 天）

### 5.1 前端 i18n switcher 整合（passenger 端）

- [ ] `app/stores/8.store-config.ts`：i18n changeLocale 新增 hook：登入 user 時 call `$api.PatchSelfLang`
- [ ] passenger settings page i18n switcher 行為對齊（既有 UI 不動，只在 store 層接 endpoint）
- [ ] driver 端 i18n switcher 不動（UI 尚未實作；endpoint 已備好）

### 5.2 E2E 真機驗收清單

- [ ] 5.2.1 admin 在 /admin/line-management 建 passenger × zh_tw / en / ja 三 draft
- [ ] 5.2.2 各 publish → LINE 端三個 richmenu 同步成功
- [ ] 5.2.3 一新 LINE 帳號加 passenger OA（zh lang）→ follow event 自動綁 zh_tw 版
- [ ] 5.2.4 LIFF 切 i18n 到 en → `PatchSelfLang` 成功 → LINE App 內 richmenu 重綁為 en 版
- [ ] 5.2.5 publish 後既有 user batch re-bind 數量正確（audit log payload 比對）
- [ ] 5.2.6 fallback chain：刪 ja 版 active → ja user 看到 zh_tw 版（Q5=5a 驗證）
- [ ] 5.2.7 unpublish zh_tw 版 → setDefaultRichmenu cleared；zh_tw user 看 LINE default（無 richmenu）
- [ ] 5.2.8 publish 對 > 100 user 觸發 badRequest（驗證 batch limit）

### 5.3 Archive 收尾

- [ ] version bump（v0.3.24 → v0.3.25）
- [ ] 撰寫 HANDOFF.md（實作摘要 / 拍板紀錄 / 部署狀態 / 程式碼總覽 / 留尾清單）
- [ ] `git mv` openspec change 至 `openspec/changes/archive/2026-05-15-line-oa-p42-multilang-richmenu/`
- [ ] memory 同步：新建 `project-p42-richmenu-multilang.md` + 更新 MEMORY.md index

### 5.4 Stage Gate

- [ ] G5.1 lint + build pass
- [ ] G5.2 全部 e2e 5.2.* 綠
- [ ] G5.3 commit + push origin HEAD:main

---

## 風險與 Rollback

| Phase | 風險 | Rollback |
|---|---|---|
| 1 | migration 跑錯把 active doc lang 設錯 | dry-run 先看；migration 冪等（已有 lang 不動）；最差情況直接 admin 介面改 |
| 2 | PATCH /api/self/lang 寫入但 re-bind 失敗 | endpoint 內 swallow re-bind 失敗（return rebinds 含 error）；user 仍可手動切 |
| 3 | admin UI 三 lang sub-tab 切換 list 亂掉 | 純前端問題；revert vue component |
| 4 | publish batch re-bind 100 user 超出 LINE quota | 失敗 user 進 P43 error log；admin 手動 test-bind 補救 |
| 4 | setDefaultRichmenu 只對 zh_tw 設 → 非 zh user 沒 default | 設計上是預期行為（user 改 lang 後會 PATCH 觸發 re-bind）；可接受 |
| 5 | i18n switcher PATCH 失敗 → cookie 已切但 firestore 沒寫 | catch + ElMessage.warning「lang 已切但同步失敗，下次登入會重設」；用戶體驗可接受 |

---

## 驗收標準（Definition of Done）

- [ ] Q1-Q7 全部拍板紀錄在 design.md §7
- [ ] migration endpoint 跑過 prod（dry-run 後再 actual）
- [ ] 三 lang 各至少一 active doc（passenger / driver 都做）
- [ ] follow event 對新 user 自動綁對應 lang richmenu
- [ ] `PATCH /api/self/lang` 對既有 user 觸發 re-bind
- [ ] fallback chain（Q5=5a）行為正確
- [ ] HANDOFF.md 完整 + memory 同步 + archive 已 mv
- [ ] e2e 5.2.* 全綠
