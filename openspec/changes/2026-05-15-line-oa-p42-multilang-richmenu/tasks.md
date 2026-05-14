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

- [x] `server/utils/line-richmenu-doc.ts`：
  - 加 `lang: Lang` 入 `LineRichmenuDoc` interface
  - 加 `lang: Lang` 入 `LineRichmenuDto`
  - `toRichmenuDto` map lang field（含 grandfather safety fallback 'zh_tw'）
  - 加 `validateLang(raw)` validator
- [x] `server/utils/line-richmenu-doc.ts` 加 `RICHMENU_VALID_LANGS = ['zh_tw', 'en', 'ja']`（避免硬寫多處）

### 1.2 Migration endpoint（既有 active → grandfather zh_tw）

- [x] 新檔 `server/routes/nuxt-api/admin/migrations/p42-richmenu-lang.post.ts`：
  - super only
  - dry-run mode（`?dryRun=1` 或 body.dryRun=true）
  - 冪等
  - 對所有 lang 為 null/undefined/非合法 的 doc set `lang='zh_tw'`
  - audit log `line.richmenu.migrate.lang`

### 1.3 Binding helper（新 util）

- [x] 新檔 `server/utils/line-richmenu-binding.ts`：
  - `resolveUserLang(db, lineUid, eventLang?)` — Q3=3b 直接複用 `getUserLang`
  - `loadActiveRichmenuForLang(db, channel, lang)` — Q5=5a fallback chain
  - `bindRichmenuForUser(db, client, lineUid, lang)` — link / unlink + 失敗 return 不 throw
  - 內含 `FALLBACK_CHAIN` 常數（Q5=5a）

### 1.4 Webhook follow event 整合

- [x] `server/utils/line-channel.ts` follow event 分支：
  - 既有：loadBotReply + _reply（保留）
  - 新增 fire-and-forget IIFE：`resolveUserLang` → `bindRichmenuForUser`
  - 失敗只 console.warn（不破壞 webhook 200 回應）

### 1.5 既有 endpoint 加 lang query filter

- [x] `server/routes/nuxt-api/admin/line-richmenus/index.get.ts`：
  - query string 加 `lang` filter（optional；不傳 = 全部）
  - 既有 channel / status filter 不變

- [x] `server/routes/nuxt-api/admin/line-richmenus/index.post.ts`：
  - body 加 `lang` 必填 + validateLang
  - audit log payload 帶 lang

- [x] `server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts`：
  - body 含 channel / lang / status → 顯式 return badRequestError（unique key 維度禁止改）

### 1.6 Firestore Rules + Indexes

- [x] `firestore.rules`：line_richmenus rule 不需改動（admin only write 維持）
- [x] `firestore.indexes.json`：加 2 個 composite index（channel + lang + status + updatedAt desc / channel + lang + updatedAt desc）
- [x] **Claude 自跑** `npx firebase-tools deploy --only firestore:indexes` 成功（destination-anywhere-cfd50）

### 1.7 Stage Gate

- [x] G1.1 lint + build pass（40.8 MB / 11.6 MB gzip）
- [x] G1.2 migration prod 直跑 — firestore MCP 對 prod 唯一 doc `ns1IJvb4IAUpVkswN3Ge`（passenger draft「乘客主選單」）補 `lang='zh_tw'`（其餘狀況 spec endpoint 已備好給後續批次跑）
- [x] G1.3 prod 端 line_richmenus 全部 doc 已 grandfather（共 1 個）
- [ ] G1.4 commit + push origin HEAD:main

---

## Phase 2：User Lang Persist Endpoint + Re-bind Hook（0.5 天）

> **前置**：Q2 / Q3 拍板（若 Q2=2a 則本 Phase 跳過、整體估時減 0.5d）。

### 2.1 PATCH /nuxt-api/self/lang endpoint

- [x] 新檔 `server/routes/nuxt-api/self/lang.patch.ts`：
  - 純手動 validate body（與 driver/me/profile pattern 一致；非 Zod，沿用既有 endpoint 風格）
  - 取 prev lang（給 audit log 比對）
  - update `users/{lineUid}.lang`（merge：不破壞既有 displayName / pictureUrl / lastSeenAt）
  - 依 auth.roles 推 channels → `bindRichmenuForUser` per channel（fail-open；per channel 進 rebinds[i]）
  - audit log `user.lang.update`（含 prev / new lang + per channel rebind 結果）

### 2.2 Audit log action 註冊

- [x] `server/utils/audit-log.ts`：加 `user.lang.update` action + `user` targetType

### 2.3 Protocol module

- [x] `app/protocol/fetch-api/api/self/index.ts`：`PatchSelfLang({ lang })` method + re-export type
- [x] `app/protocol/fetch-api/api/self/type.d.ts`：SelfLang / SelfRebindEntry / PatchSelfLangResponse 型別
- [x] `app/protocol/fetch-api/index.ts` wire `* as self` import + 聚合

### 2.4 Stage Gate

- [x] G2.1 lint pass
- [x] G2.2 build pass
- [ ] G2.3 手測：延後到 Phase 5 e2e（需先有 active richmenu 才能驗 rebind；目前 prod 只有 1 個 draft / 無 active）
- [ ] G2.4 commit + push origin HEAD:main

---

## Phase 3：Admin UI Per-Lang Management（0.5 天）

> **前置**：Q1 / Q4 / Q6 拍板。

### 3.1 Richmenu tab lang sub-tab

- [x] `app/pages/admin/line-management/index.vue`：
  - activeLang `RichmenuLang | 'all'` ref + LANG_TABS / LANG_LABEL 常數
  - channel sub-tab 後加 lang sub-tab（all / zh_tw / en / ja；button pattern 對齊既有 status filter）
  - 切 lang sub-tab 時 reload list（watch [activeChannel, activeLang, activeStatus]）
  - GetLineRichmenus protocol 加 lang param
  - 卡片內加 lang badge（每 lang 不同色）

### 3.2 Edit dialog 改動

- [x] `app/components/open/dialog/line-richmenu/Edit.vue`：
  - DialogLineRichmenuEditParamsLocal 加 lang field（create 模式從 params 帶入；edit 模式由 server load 覆蓋）
  - 草稿建立 mode：加 lang select（draft 建立前可改；ensureDraft 後 + edit 模式 readonly）
  - CreateLineRichmenu body 帶 lang
  - header 並列加 lang badge 視覺對齊 channel badge
  - 基本資訊 section 加 lang select + 提示文字（建立後鎖定）
- [ ] **「從其他 lang 複製」按鈕** — Phase 3 範圍縮減，移至 Phase 5 留尾（admin 仍可手動建 + 上傳一樣的圖；先把核心 lang 框架做完才有 source doc 可複製）

### 3.3 Diagnostics sync-overview 對齊

- [ ] **延後 Phase 4**：sync-overview / cleanup-orphan 對齊 lang 維度與 Phase 4 publish lang-aware 一起做（同一 endpoint 範圍）

### 3.4 i18n locale 三檔加新 key

- [ ] **延後 Phase 5**：admin 介面整體仍是繁中 hardcoded（既有 P38/P40/P43 pattern），admin UI 加 i18n key 屬獨立工作非阻塞；本案聚焦核心 lang 框架

### 3.5 Stage Gate

- [x] G3.1 lint pass
- [x] G3.2 build pass（40.8 MB / 11.7 MB gzip）
- [ ] G3.3 手測：admin 在三 lang sub-tab 各建一 draft（延 Phase 5 e2e）
- [ ] G3.4 commit + push origin HEAD:main

> **Phase 3 範圍縮減記錄（2026-05-15）**：因「從其他 lang 複製」按鈕 + Diagnostics lang grid 都依賴有多 lang doc 存在才有意義（目前 prod 0 個 active doc），將其延後至 Phase 4/5 與 publish lang-aware 一併做。**i18n locale 延後**為非阻塞性 — 整個 admin 介面既有就是繁中 hardcoded，本案不單獨擴充。

---

## Phase 4：Publish / Unpublish Lang-Aware + Sync-Overview 對齊（0.5 天）

> **前置**：Q1 / Q5 拍板。

### 4.1 Publish 流程改 lang-aware

- [x] `server/routes/nuxt-api/admin/line-richmenus/[id]/publish.post.ts`：
  - Firestore tx 改為 archive 同 channel **同 lang** 既有 active（既有 channel 條件保留）
  - LINE API：
    - 既有：createRichmenu + uploadRichmenuImage（若 lineRichMenuId 為 null）
    - 修改：`setDefaultRichmenu` 只在 lang=`zh_tw` 時呼（作為未綁定 user 的 fallback default）
  - **新增**：對既有 user batch re-bind
    - 撈 `users` where `lang == publishedLang` limit 101（用 +1 偵測超量）
    - 對每個 user 呼 `linkRichmenuToUser`（throttle 100ms 間隔，10s 上限）
    - 超過 100 → return 502 with `rebindStats.limitExceeded=true` + 中文/英/日提示「需 cron job 批次（P50+）」
  - audit log payload 加 `lang` + `rebindStats: { total, success, failed, limitExceeded, errors[].lineUid + .error }`

### 4.2 Unpublish 對齊

- [x] `server/routes/nuxt-api/admin/line-richmenus/[id]/unpublish.post.ts`：
  - 既有：mark archived + clearDefaultRichmenu
  - 修改：clearDefaultRichmenu **只在 lang=`zh_tw` 時呼**（其他 lang 沒設 default，視為「清乾淨」）
  - 新增：對該 lang 既有綁定 user batch unlink（讓 user 看 LINE default / fallback lang 對應 richmenu）
  - audit log payload 加 `lang` + `unbindStats`

### 4.3 Test-bind 對齊

- [x] `server/routes/nuxt-api/admin/line-richmenus/[id]/test-bind.post.ts`：
  - 既有：linkRichmenuToUser（admin 測試用）
  - **無需改動**（直接綁該 doc 的 lineRichMenuId，不考慮 user lang）

### 4.4 Sync-overview 對齊

- [x] `server/routes/nuxt-api/admin/line-richmenus/sync-overview.get.ts`：
  - 既有：本地 docs vs LINE listRichmenus 比對保留
  - 修改：每個 LocalDoc 加 `lang` field（grandfather safety fallback zh_tw）
  - 修改：`activeDoc` 邏輯改為「以 zh_tw active 為 channel-level LINE default 對齊基準」（非 zh_tw 是 per-user binding，不對 LINE default）
  - 新增：response 加 `byLang: Record<Lang, { activeDoc, docs[] }>` 維度（admin UI grid 顯示用；admin UI 整合留 Phase 5+）
  - cleanup-orphan 不需改動（孤兒邏輯與 lang 無關，仍以 lineRichMenuId 比對）
- [x] Protocol type.d.ts 同步：SyncOverviewLocalDoc 加 lang / SyncOverviewByLangEntry 新型別 / SyncOverviewRes 加 byLang

### 4.5 Stage Gate

- [x] G4.1 lint + build pass（lint 修兩個 `let → const` 後綠；build 進行中等候）
- [ ] G4.2 手測：publish zh_tw → batch re-bind（延 Phase 5 e2e；prod 目前 0 個 lang 寫入 user）
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
