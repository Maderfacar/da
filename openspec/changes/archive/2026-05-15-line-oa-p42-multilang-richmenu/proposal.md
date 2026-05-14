# 2026-05-15 — P42 LINE Richmenu 多語版本（per-user 依 users.lang 自動切）

> **狀態**：Phase 0 spec 草案 — 等 Brain AI 拍板 Q1-Q7 後才進 Phase 1。
> **前置**：P40 完工（v0.3.23）+ P43 完工（v0.3.24，commits ..1632867 push main）。
> **規模**：中等（預估 1.5-2.5 工作天 / 5 Phase）。
> **獨立新視窗**：與 P43 archive memory 內留尾項一致 — `richmenu 多語版本（per-user 依 users.lang 自動切）`。

## Why

P38 落地的 richmenu 是「全 channel 共用一個 active doc」設計（同 channel `status='active'` 同時只允許 1 個 doc；publish 走 `setDefaultRichmenu` 對全 user 生效）。**但 DA 是三語系產品**（zh / en / ja，i18n 已落地三檔），目前 LINE OA 圖文選單上的中文字 button label / chatBarText 對非中文使用者並不友善：

- **乘客場景**：英文使用者打開 LINE 看到「立即訂車 / 我的行程 / 客服 / 通知」中文 chip 與圖文按鈕 — 對應 booking.* / fleet.* / contact 等 i18n 鍵在 LIFF 內已三語化，但 LINE OA 圖文選單卡在中文版
- **司機場景**：同理，driver dashboard / pending / trip 對非中文司機（含未來日文司機）也是中文 UI
- **設計實作落差**：i18n locales 三檔齊全 + `users/{lineUid}.lang` field 已存在（`server/utils/i18n-message.ts:122` `getUserLang` 已實作 fallback zh_tw）；但 **richmenu 系統未對齊**，全部 user 都吃同一個中文版 active richmenu

實作面缺口：
1. `line_richmenus` doc schema 沒有 lang 維度（單 channel 單 active）
2. publish 流程只能設「channel default」（`/v2/bot/user/all/richmenu/{id}`），對全 user 同樣呈現
3. webhook follow event 走 fallback i18n 文字回覆，但 LINE 隨後顯示的 richmenu 仍是中文版（user lang 對應的版本不存在 / 沒人寫綁定邏輯）
4. **users.lang 寫入路徑目前是空的** — `line-exchange.post.ts` 不寫 lang field、沒有 `PATCH /api/self/lang` endpoint、前端 i18n switcher 只切 cookie / store 不 persist 到 Firestore（getUserLang 全部 return fallback zh_tw）

P42 範圍：建立 lang 維度的 richmenu 管理 + per-user 依 `users.lang` 自動綁對應 lang richmenu 的機制。

## What Changes

### 1. line_richmenus schema 加 lang 維度（Q1 拍板）

依 Q1 拍板選 1a / 1b：

- **1a 每 lang 一獨立 doc**（推 spec 預設）
  - schema 加 `lang: 'zh_tw' | 'en' | 'ja'` field
  - unique 約束改為 `channel × lang × status='active'` 同時 ≤ 1 個 doc
  - 既有資料 grandfather：所有現存 active doc 視為 `lang='zh_tw'`（Q7=7a）

- **1b 單 doc 多 lang variants**
  - 單 doc 內 `contents: { zh_tw: RichmenuContent, en: RichmenuContent, ja: RichmenuContent }` 結構
  - 每筆 contents 各別維護 lineRichMenuId（LINE 端 3 個 richmenu）
  - admin UI 走「群組編輯」一次改 3 lang

### 2. webhook follow event 內 per-user 綁 richmenu（Q2-Q3-Q5 拍板）

[server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` follow event 分支：

```typescript
if (ev.type === 'follow' && ev.source.userId) {
  // 既有：loadBotReply + _reply
  // 新增：取 user lang → 找該 lang active richmenu → linkRichmenuToUser
  const lang = await resolveUserLang(db, ev.source.userId, ev.source.language);
  const richmenu = await loadActiveRichmenuForLang(db, client, lang);
  if (richmenu?.lineRichMenuId) {
    await linkRichmenuToUser(client, ev.source.userId, richmenu.lineRichMenuId);
  }
}
```

`resolveUserLang(db, lineUid, eventLang?)` 行為依 Q3 拍板：
- **3a**：從 LINE event `source.language` 取（webhook 才有；LIFF 主動 push 取不到 → 落回 default）
- **3b**：從 `users/{lineUid}.lang` 取（**順帶加 user lang persist 機制**，見 §4）
- **3c**：兩者並存（首選 users.lang，fallback LINE event lang）

fallback chain 依 Q5：
- **5a zh→en→ja**：找不到該 lang 的 active richmenu → 依序找 zh_tw / en / ja active doc（推 spec 預設）
- **5b 系統 default**：admin 在 settings 設「fallback lang」單一值
- **5c 永遠 zh**：簡單但對外國使用者不友善

### 3. user lang 切換時觸發 re-bind（Q2=2b 路徑）

依 Q2 拍板：
- **2a**：純 follow event + admin force re-bind（簡單；user 改 lang 後不重綁，仍看舊版）
- **2b**：含 user lang 切換時 trigger 重綁（推 spec 預設；最 robust）

2b 路徑：新加 `PATCH /api/self/lang`（passenger 端）/ `PATCH /api/drivers/me/lang`（driver 端）endpoint：
1. validate body.lang ∈ {zh_tw, en, ja}
2. update `users/{lineUid}.lang`
3. 取該 client 對應 lang active richmenu
4. linkRichmenuToUser（若有；無 fallback 對應 lang chain）

前端 i18n switcher 改成 call 此 endpoint（passenger + driver 兩端）。

### 4. admin UI per-lang richmenu management（Q4 拍板）

[/admin/line-management](app/pages/admin/line-management/index.vue) Richmenu tab：

- **4a 各 lang 獨立編輯**（推 spec 預設）
  - channel sub-tab 內加 lang sub-tab（zh / en / ja）
  - 每 lang × channel × status filter 獨立卡片 list
  - publish / unpublish 按鈕作用範圍：該 channel × 該 lang
  - 「複製」按鈕：從一個 lang 複製 areas + image 到另一個 lang（方便先建 zh_tw 再翻譯）

- **4b 群組編輯**
  - 單一編輯器同時改 3 lang（每 lang 一個 tab pane 在彈窗內）
  - publish 一次發 3 lang，少數 lang 缺 → 整體 fail

### 5. Publish / unpublish 流程改 lang-aware（依 Q1 + Q2 動）

依 Q1=1a：
- publish 不再 `setDefaultRichmenu`（會對 fallback user 把該 lang richmenu 覆蓋成全 user default — 不要）
- 改為：
  1. Firestore tx 切該 channel × lang 的 active 狀態
  2. 取該 channel × lang 過去綁定的所有 user（依 `users.lang` 過濾）
  3. 對每個 user 呼 `linkRichmenuToUser`（per-user batch）
  4. `setDefaultRichmenu` 改為「設 lang=zh_tw 版本當系統 default」（給未綁定 / 未知 lang user 預設看 zh）

- batch size ≤ 100 user 同步呼叫；超過 → throw + 顯示 admin 提示「user 數過多需 cron job」（本案不做 cron；列為 P50+ 範圍）

### 6. Cleanup-orphan + sync-overview 對齊 lang 維度

[server/routes/nuxt-api/admin/line-richmenus/sync-overview.get.ts](server/routes/nuxt-api/admin/line-richmenus/sync-overview.get.ts) + [cleanup-orphan.post.ts](server/routes/nuxt-api/admin/line-richmenus/cleanup-orphan.post.ts)：

- 既有：local docs vs LINE listRichmenus 比對 + 孤兒刪除
- 新增：每筆 local doc 帶 `lang` 顯示；UI 卡片 grid `channel × lang` 三維展示

## Out of Scope（明確不做）

- ❌ **Per-user 綁定查詢 admin tool**（「U12345 目前綁哪個 richmenu」） — 屬 P50+ admin tool 範圍
- ❌ **batch re-bind cron job**（> 100 user 的批次重綁） — 本案先做 single-batch 同步；超量警示 admin（P50+ 範圍）
- ❌ **richmenu alias / richmenuswitch action** — P43 archive 留尾項，獨立 wave
- ❌ **LINE quota / push limit 監控**（multicast / pushMessage quota） — P50+ 範圍
- ❌ **richmenu 圖層合成器**（admin 自製多語圖不用外部設計師） — P44 留尾範圍
- ❌ **areas 拖拉互動 / resize handle** — P44 留尾範圍
- ❌ **i18n locale 新增**（如加韓文 ko）— 本案僅鎖三語 zh_tw / en / ja
- ❌ **driver 端 i18n switcher UI**（目前 driver 端 i18n switcher 尚未完整實作） — Q3=3b/3c 路徑只在 driver 端 i18n switcher 落地後才有意義；本案做後端 endpoint，前端待後續 wave 補

## Impact

### 影響範圍

依 Q1-Q7 拍板會浮動：

- **改動 Firestore schema**：`line_richmenus` 加 `lang` field（Q1=1a）/ 改 `contents` 結構（Q1=1b）
- **新增 endpoint**：
  - `PATCH /nuxt-api/self/lang`（passenger，2b 路徑）
  - `PATCH /nuxt-api/drivers/me/lang`（driver，2b 路徑）
  - 既有 `GET /admin/line-richmenus` 加 lang query filter
  - 既有 `POST /admin/line-richmenus/[id]/publish` 改 lang-aware（不破壞 contract）
- **改動既有 server util**：
  - `server/utils/line-richmenu-doc.ts`（加 lang field + validator）
  - `server/utils/line-channel.ts`（follow event 內加 resolveUserLang + linkRichmenuToUser）
  - 新增 `server/utils/line-richmenu-binding.ts`（resolveUserLang + loadActiveRichmenuForLang + bindRichmenuForUser helper）
- **改動既有 admin UI**：
  - `app/pages/admin/line-management/index.vue` Richmenu tab 加 lang sub-tab
  - `app/components/open/dialog/line-richmenu/Edit.vue`（依 Q4=4a 加 lang select；Q4=4b 改群組編輯器）
- **改動 firestore.rules / indexes**：lang 加進 query filter index
- **改動既有 passenger / driver 前端**：i18n switcher 改 call PATCH endpoint（Q3=3b/3c 路徑）

### 風險

| 風險 | 緩解 |
|---|---|
| 既有 active richmenu 自動轉成 zh_tw（Q7=7a grandfather） | Migration endpoint 冪等 + dry-run mode（先 list 影響 doc）+ 跑前 audit log；既有 user 已綁 default 不受影響（只是 lang field 由 null → 'zh_tw'） |
| publish 改為 batch re-bind 對既有 user 一次 N 千次 API call | 本案先做 single-batch（≤ 100 user）同步；超量 throw 並警示「需 cron」；P50+ 範圍補批次 worker |
| user 切 lang 但對應 lang 版 richmenu 不存在 | fallback chain（Q5=5a zh→en→ja）保底；admin UI 顯示「該 channel × lang 無 active doc」警示 |
| 沒 user lang persist 路徑 + Q3=3b → 全部 fallback 同一 lang | 本案順帶加 `PATCH /api/self/lang` + driver 對應 endpoint；前端 i18n switcher 改 call（passenger 必做；driver 端 i18n switcher UI 不在本案範圍但 endpoint 也加） |
| LINE Messaging API rate limit（linkRichmenuToUser 每 user 一次 call） | LINE 公開額度足夠（單一 OA 每分鐘 1000 req；100 user batch 約 1-2 秒）；batch 間 throttle 100ms 留 buffer |
| Q1=1b 單 doc 多 variant 設計使 admin UI 編輯複雜度上升 | Q1 推 spec 預設 1a；若 Brain AI 改 1b 預期增加 0.5d UI 設計 |
| 既有 i18n 用 `zh_tw / en / ja` 三 lang code；推 spec 預設要對齊（不混用 `zh` / `zh-TW`） | schema validator 明確列舉三值；既有 `server/utils/i18n-message.ts` Lang type 已定義 — 直接 import |

### 估時

| Phase | 內容 | 估時 |
|---|---|---|
| 0 | spec + Brain AI 拍板 Q1-Q7 | 0.25d |
| 1 | schema migration（line_richmenus 加 lang field）+ binding helper（resolveUserLang / loadActiveRichmenuForLang / bindRichmenuForUser）+ webhook follow integration | 0.5d |
| 2 | user lang persist endpoint（PATCH /api/self/lang + /api/drivers/me/lang）+ re-bind hook（Q2=2b 路徑） | 0.5d |
| 3 | admin UI per-lang management（lang sub-tab + edit 對齊 + 複製按鈕） | 0.5d |
| 4 | publish / unpublish lang-aware（batch re-bind + Q5 fallback 邏輯）+ sync-overview / cleanup-orphan 對齊 | 0.5d |
| 5 | e2e + version bump + HANDOFF + archive + memory + i18n switcher 前端 call endpoint（passenger） | 0.25-0.5d |
| **總計** | | **1.5-2.5d** |

## Brain AI 拍板的關鍵決策（必須先給）

詳見 [design.md §6](design.md#6-開放問題待-brain-ai-拍板)。共 **7 個關鍵問題**：

1. **Q1**：line_richmenus schema 設計 — 1a 每 lang 一獨立 doc（簡單，最多 3 lang × 2 channel = 6 active doc）/ 1b 單 doc 多 lang variants（doc 內 contents 為 Record<lang, ...>）
2. **Q2**：lang 切換觸發點 — 2a follow event + admin force re-bind / 2b 含 user lang 切換 webhook（新加 PATCH /api/self/lang endpoint）
3. **Q3**：lang 偵測來源 — 3a LINE event `source.language`（webhook 場景才有）/ 3b `users/{lineUid}.lang`（本案順帶加 persist 機制）/ 3c 兩者並存（首選 users.lang，fallback event lang）
4. **Q4**：admin UI 編輯入口 — 4a 各 lang 獨立編輯（簡單）/ 4b 群組編輯器（單 UI 改 3 lang）
5. **Q5**：fallback lang 策略 — 5a zh→en→ja 鏈式 / 5b 系統 default（admin 在 settings 設）/ 5c 永遠 zh
6. **Q6**：本案範圍 — 6a 三語全做 zh/en/ja / 6b 先 zh + en，待後續 wave 補 ja
7. **Q7**：既有 active richmenu 兼容 — 7a 視為 zh_tw 版本自動 grandfather / 7b 強制 admin 補 en/ja 後才能 publish

未拍板前 spec 以**推 spec 預設**（Q1=1a / Q2=2b / Q3=3b / Q4=4a / Q5=5a / Q6=6a / Q7=7a）展開設計，Brain AI 改 default 後 spec 同步重寫。

## 落地的 P38 / P40 / P43 約束（不可破壞）

- P38 既有 schema 核心欄位（imageUrl / areas / chatBarText / status / lineRichMenuId）— 向下相容，僅在外圍加 `lang` field
- P40 Postback whitelist（8 entry）/ Bot Replies template / 公告 builder — 不動
- P40 Diagnostics MVP（sync-overview + cleanup-orphan） — 行為對齊 lang 維度（新增欄位顯示，不破壞既有 GET contract）
- P43 Event Log / Error Log — 不動；本案 user lang 切換 endpoint 失敗時透過 audit log 記錄（與 P38 pattern 一致）
- `server/utils/i18n-message.ts` Lang type / getUserLang helper — 直接 import 重用，不改其 fallback 行為

## 留尾（後續 Wave）

- **P44**：richmenu 圖層合成器 + area editor 拖拉互動 + resize handle（獨立新視窗）
- **P50+**：
  - Per-user 綁定查詢 admin tool（「U12345 綁哪 richmenu」）
  - Batch re-bind cron / Worker（> 100 user 場景）
  - richmenu alias / richmenuswitch action
  - i18n locale 擴充框架（如加 ko）
  - LINE quota 監控 / 推播失敗告警
