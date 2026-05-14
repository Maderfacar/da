# HANDOFF — P42 LINE Richmenu 多語版本（2026-05-15）

> 程式碼層 Phase 0-5 全綠並 push main。Phase 5 e2e 真機驗收為 Brain AI 行動範圍（archive HANDOFF §6.1 checklist）。

## 實作摘要

| Phase | 內容 | Commit |
|---|---|---|
| 0 | spec 三件套（proposal / design / tasks） + Brain AI 拍板 Q1-Q7 全推 spec 預設 | `88fd455` + `ef86967` |
| 1 | line_richmenus schema 加 lang 維度 + binding helper（resolveUserLang / loadActiveRichmenuForLang / bindRichmenuForUser） + webhook follow 自動綁 + 既有 endpoint 加 lang filter / 必填 / unique key 鎖 + migration endpoint + indexes + firebase deploy + prod 唯一 doc grandfather | `517af36` |
| 2 | PATCH /nuxt-api/self/lang endpoint（任何登入 user）+ users.lang merge 寫入 + 依 roles 推 channels per-channel rebind + audit log `user.lang.update` + protocol module | `539d3cf` |
| 3 | admin UI Richmenu tab 加 lang sub-tab + Edit dialog lang select + lang badge / 三色配色（紅 zh_tw / 紫 en / 粉 ja） | `6fd5387` |
| 4 | publish/unpublish lang-aware（tx archive 同 lang 範圍 + setDefault/clearDefault 僅 zh_tw + batch re-bind/unbind users where lang==X limit 100 throttle 100ms） + sync-overview 加 byLang dimension | `7621669` |
| 5 | LangSwitcher 接 `$api.PatchSelfLang`（登入 user 切 lang 同步 firestore + LINE 重綁） + version v0.3.25 + 本 HANDOFF + archive | （本次 archive commit） |

## 拍板紀錄（design.md §7）

7 個 Q 全用推 spec 預設（**2026-05-15 Brain AI「預設即可」一句**）：

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | **1a** | 每 lang 一獨立 doc（unique = channel × lang × status='active'） |
| Q2 | **2b** | 含 user lang 切換 webhook（PATCH /api/self/lang） |
| Q3 | **3b** | `users/{lineUid}.lang` 為唯一來源 |
| Q4 | **4a** | 各 lang 獨立編輯（lang sub-tab） |
| Q5 | **5a** | zh_tw → en → ja fallback chain |
| Q6 | **6a** | 三語全做 zh_tw / en / ja |
| Q7 | **7a** | 既有 active 自動 grandfather zh_tw |

## 部署狀態

✅ **已 push main**（commits 上列）：5 個 Phase + spec/拍板 commit
✅ **firebase deploy --only firestore:indexes** 已自跑（destination-anywhere-cfd50）— 2 個 lang composite index 上線
✅ **prod migration 已自跑**：firestore MCP 對 prod 唯一 line_richmenus doc `ns1IJvb4IAUpVkswN3Ge`（passenger draft「乘客主選單」）補 `lang='zh_tw'`

⏳ **Brain AI 真機 e2e 驗收**（§6.1 checklist）

## 程式碼總覽

### 新增 util / endpoint

- [server/utils/line-richmenu-binding.ts](server/utils/line-richmenu-binding.ts) — resolveUserLang / loadActiveRichmenuForLang / bindRichmenuForUser + FALLBACK_CHAIN
- [server/routes/nuxt-api/self/lang.patch.ts](server/routes/nuxt-api/self/lang.patch.ts) — user 自助切換語系 + 依 roles 重綁 richmenu
- [server/routes/nuxt-api/admin/migrations/p42-richmenu-lang.post.ts](server/routes/nuxt-api/admin/migrations/p42-richmenu-lang.post.ts) — grandfather migration（super only + dry-run + 冪等）

### 改動既有 util

- [server/utils/line-richmenu-doc.ts](server/utils/line-richmenu-doc.ts) — 加 `lang: Lang` 到 LineRichmenuDoc + LineRichmenuDto + toRichmenuDto（含 grandfather safety）+ validateLang + RICHMENU_VALID_LANGS 常數
- [server/utils/line-channel.ts](server/utils/line-channel.ts) — webhook follow event 加 fire-and-forget bindRichmenuForUser（依 user lang 自動綁）
- [server/utils/audit-log.ts](server/utils/audit-log.ts) — 加 `line.richmenu.migrate.lang` + `user.lang.update` action + `user` targetType

### 改動既有 endpoint

- [server/routes/nuxt-api/admin/line-richmenus/index.get.ts](server/routes/nuxt-api/admin/line-richmenus/index.get.ts) — 加 lang query filter
- [server/routes/nuxt-api/admin/line-richmenus/index.post.ts](server/routes/nuxt-api/admin/line-richmenus/index.post.ts) — body 加 lang 必填
- [server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts](server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts) — 顯式拒絕 body 含 channel/lang/status（unique key 維度）
- [server/routes/nuxt-api/admin/line-richmenus/[id]/publish.post.ts](server/routes/nuxt-api/admin/line-richmenus/[id]/publish.post.ts) — tx archive 同 channel × 同 lang + setDefault 僅 zh_tw + batch re-bind limit 100
- [server/routes/nuxt-api/admin/line-richmenus/[id]/unpublish.post.ts](server/routes/nuxt-api/admin/line-richmenus/[id]/unpublish.post.ts) — clearDefault 僅 zh_tw + batch unbind limit 100
- [server/routes/nuxt-api/admin/line-richmenus/sync-overview.get.ts](server/routes/nuxt-api/admin/line-richmenus/sync-overview.get.ts) — 加 byLang dimension + activeDoc 改 zh_tw active 基準

### 改動 admin / protocol / 前端

- [app/protocol/fetch-api/api/admin/line-richmenu/type.d.ts](app/protocol/fetch-api/api/admin/line-richmenu/type.d.ts) — RichmenuLang / LineRichmenuDto.lang / CreateRichmenuBody.lang / SyncOverviewByLangEntry / SyncOverviewRes.byLang
- [app/protocol/fetch-api/api/admin/line-richmenu/index.ts](app/protocol/fetch-api/api/admin/line-richmenu/index.ts) — GetLineRichmenus 加 lang query + re-export RichmenuLang / SyncOverviewByLangEntry
- [app/protocol/fetch-api/api/self/](app/protocol/fetch-api/api/self/) — 新模組（PatchSelfLang + type 定義）
- [app/protocol/fetch-api/index.ts](app/protocol/fetch-api/index.ts) — wire `* as self`
- [app/pages/admin/line-management/index.vue](app/pages/admin/line-management/index.vue) — activeLang ref + LANG_TABS sub-tab + ApiLoadList 帶 lang + ClickCreate 傳 lang + card lang badge + SCSS
- [app/components/open/dialog/line-richmenu/Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue) — DialogLineRichmenuEditParamsLocal 加 lang + form 加 lang field + ensureDraft 後 readonly + CreateLineRichmenu body 帶 lang + UI 加 lang select 與 header badge
- [app/components/open/_index.d.ts](app/components/open/_index.d.ts) — DialogLineRichmenuEditParams 加 lang + copyFromId 預留
- [app/components/LangSwitcher.vue](app/components/LangSwitcher.vue) — 切 lang 後對登入 user fire `$api.PatchSelfLang`（locale 'zh' → 'zh_tw' map）

### 改動 Firestore 配置

- [firestore.indexes.json](firestore.indexes.json) — 加 2 個 composite index：
  - `channel + lang + status + updatedAt desc`
  - `channel + lang + updatedAt desc`
- `firestore.rules`：line_richmenus rule 不需改動（admin only write 維持）

## 留尾

### 非阻塞（Brain AI 真機 e2e 驗收項）

- §6.1.1 admin 在 /admin/line-management 建 passenger × zh_tw / en / ja 三 draft
- §6.1.2 各 publish → LINE 端三個 richmenu 同步成功
- §6.1.3 新 LINE 帳號加 passenger OA（lang 預設 zh_tw）→ follow event 自動綁 zh_tw 版
- §6.1.4 LIFF 切 i18n → `PatchSelfLang` 成功 → LINE App 內 richmenu 重綁為對應 lang 版
- §6.1.5 publish 後既有 user batch re-bind 數量正確（audit log payload）
- §6.1.6 fallback chain：刪 ja active → ja user 看到 zh_tw 版（Q5=5a 驗證）
- §6.1.7 unpublish zh_tw → setDefaultRichmenu cleared
- §6.1.8 publish 對 > 100 user 觸發 502 limitExceeded

### Phase 範圍縮減記錄（2026-05-15）

| 留尾項 | 原 Phase | 理由 |
|---|---|---|
| 「從其他 lang 複製」按鈕（admin Edit dialog） | Phase 3 → 後續 wave | 依賴有多 lang doc，先把核心框架做完才有 source doc 可複製 |
| Diagnostics tab UI 整合 byLang grid | Phase 3 → 後續 wave | sync-overview API 已備好 byLang 資料；UI 整合屬獨立工作 |
| i18n locale 三檔加 admin UI key | Phase 3 → 後續 wave | admin 介面整體既是繁中 hardcoded（既有 P38/P40/P43 pattern），非阻塞性 |

### 後續 Wave 留尾（與 P40 / P43 archive 留尾合併）

- **P44**：richmenu 圖層合成器 + area editor 拖拉互動 + resize handle（獨立新視窗）
- **P50+**：
  - Per-user 綁定查詢 admin tool（「U12345 綁哪 richmenu」）
  - Batch re-bind cron / Worker（> 100 user 場景）
  - richmenu alias / richmenuswitch action
  - i18n locale 擴充框架（如加 ko）
  - LINE quota 監控 / 推播失敗告警
  - 「從其他 lang 複製」+ admin UI byLang grid + admin UI i18n key

## 版本

v0.3.25（[version.ts](version.ts)）

## 已知留尾（非阻塞）

- LangSwitcher 切 lang 失敗時只 `console.warn`（不通知 user）— 體驗上接受（cookie 已切，下次 login 自動同步）
- driver 端目前尚未做 i18n switcher UI（design.md §0.2 記錄）；server-side endpoint 已備好（PATCH /api/self/lang passenger / driver 共用）
- prod 0 個 user 有 lang field（migration 不適用 users — 只 grandfather richmenu doc）；後續 user 開始切 lang 後 lang field 才會逐步填入

## §6.1 完整驗收 Checklist

詳見 [tasks.md §5.2](tasks.md)。
