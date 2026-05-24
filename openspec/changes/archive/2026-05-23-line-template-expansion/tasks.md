# Tasks — LINE Template Expansion

> 批次 1 = Backend Schema + Registry + 觸發點（W2-W4，1 次 prod push）
> 批次 2 = Frontend UI（W5-W7，1 次 prod push）
> 批次 3 = 驗收 + Audit + 留尾（W8-W9，1 次 prod push）

---

## W2 — Backend Schema 擴充

### TemplateMeta interface

- [x] `server/utils/template-registry.ts`：`TemplateCategory` enum 加 `'dispatch' | 'softmatch' | 'driver-notify'`
- [x] 加 `TemplateOutputType / TemplateAudience / TemplateI18nMode / TemplateTriggerType` type
- [x] `TemplateMeta` interface 加 `outputType / audience / i18nMode / triggerType / triggerEvent / requiresSuperLevel`
- [x] 拔除 `fallbackI18nKey` 欄位（registry 5 個既有 entry 同步移除）
- [x] `TemplateContent` 拆 `TemplateContentFlex | TemplateContentText`

### buildTemplate helper

- [x] 加 `buildTemplateText(content, params): LineMessage`（純文字 + placeholder 替換）
- [x] 加 `buildTemplate(template, params, outputType)`：依 `outputType` 分派到 `buildTemplateFlex` 或 `buildTemplateText`
- [x] `loadTemplate` 簽名加 `lang?: 'zh_tw' | 'en' | 'ja' = 'zh_tw'` 參數
- [x] Firestore 文件結構改：`content.{zh_tw|en|ja}.{title|body|...}`（i18nMode='multi'）或 `content.zh_tw.{...}`（i18nMode='single'）
  - loadTemplate 同時容錯 pre-W2 root-level legacy doc，避免推 prod 後既有資料失效
  - GET /admin/notification-templates(/[key]) 也讀 nested + legacy 雙路徑
  - PUT /admin/notification-templates/[key] 寫 `content.{lang}.{...}`（W6 多語 editor 上線前 lang 預設 zh_tw）

### 既有 5 個 order template 升級

- [x] `order.pending`：加 audience='passenger' / i18nMode='multi' / outputType='flex' / requiresSuperLevel=false / triggerEvent
- [x] `order.confirmed`：同上
- [x] `order.en_route`：同上
- [x] `order.completed`：同上
- [x] `order.cancelled`：同上
- [x] 移除 5 個 entry 的 `fallbackI18nKey`

### i18n-message.ts 拔除

> W2 階段先保留 i18n-message.ts；callers 在 W4 完成 12 個觸發點遷移後一併 delete。

- [x] 確認 `getOrderMessage` / `getReferralPushMessage` 的所有 caller 已遷移後再 delete *(W4)*
- [x] `server/utils/i18n-message.ts` 整檔 delete（Lang / getUserLang 拆到 `user-lang.ts`） *(W4)*
- [x] `server/utils/referral.ts` 內 `getReferralPushMessage` import / call 同步處理（caller 改 hardcoded 三語直寫） *(W4)*

### Build 驗證

- [x] `pnpm lint` 綠燈
- [x] `pnpm build` 綠燈
- [x] commit + push（不上 prod；批次 1 W4 結束才推）

---

## W3 — Registry 加 12 個 entry + Hybrid builder

### Dispatch Flex (3 個)

- [x] `dispatch.driver-pending`：F1 訂單派發給司機（hybrid：「我要接單」按鈕鎖死、人數+車資 formatter 鎖死）
- [x] `dispatch.driver-selected`：F4 司機中選通知
- [x] `dispatch.passenger-matched`：F3 配對成功 hard match passenger

### Softmatch Flex (2 個)

- [x] `softmatch.passenger-choose`：F5 軟配（hybrid：✓/✗ list + 3 個 postback 按鈕 action 鎖死）
- [x] `softmatch.passenger-rematching`：F6 重新配對中

### Driver-notify Text (7 個)

- [x] `driver.order-cancelled-assigned`：T3
- [x] `driver.order-cancelled-bidders`：T4
- [x] `driver.order-completed-earnings`：T5
- [x] `driver.softmatch-rejected`：T6
- [x] `driver.application-submitted`：T7
- [x] `driver.document-review`：T8（核准/駁回合 1 模板，placeholder `result`）
- [x] `driver.vehicle-profile-review`：T9（核准/駁回合 1 模板，placeholder `result`）

### Hybrid builder

- [x] `line-soft-match-push.ts` `buildSoftMatchPassengerFlex` 加 optional `customLabels` 參數（title/subtitle/matchedHeader/unmatchedHeader/btn*Label）
- [x] `line-dispatch-push.ts` `buildDispatchFlex` 加 optional `customLabels` 參數（title/subtitle/orderIdLabel/dateLabel/pickupLabel/dropoffLabel/paxLabel/fareLabel/ctaLabel）
- [x] Builder 內 list 渲染 + button action 完全不動（人數/車資 formatter、postback data、CTA URI 均沿用既有）

### Build 驗證

- [x] `pnpm lint` + `pnpm build` 綠燈
- [x] commit + push（不上 prod）

---

## W4 — 12 處觸發點改造 + 批次 1 上 prod

### Dispatch / Match 觸發點

- [x] F1 `pushOrderDispatchToDrivers`：改走 `resolveTemplate('dispatch.driver-pending') + buildDispatchFlex + customLabels`（caller 改帶 `db`）
- [x] F4 `pushOrderAssignedToDriver`：擴 `buildAssignedDriverFlex` 加 `AssignedDriverCustomLabels` + 改走 `dispatch.driver-selected`
- [x] F3 `pushOrderAssignedToPassenger`：擴 `buildAssignedPassengerFlex` 加 `AssignedPassengerCustomLabels` + 改走 `dispatch.passenger-matched`（多語）
- [x] F5 `pushSoftMatchToPassenger`：改走 `softmatch.passenger-choose`（多語；caller 改帶 `db`）
- [x] F6 `pushPassengerRematch`：改 `buildTemplate(...,'flex')` + `buildPassengerRematchFlex` 整個拔除 + `REMATCH_TEXT` 多語表拔除

### Driver-notify 觸發點

- [x] `orders/[orderId].patch.ts:394`：T3 改走 `driver.order-cancelled-assigned`（cancelReason 預組「原因：…\n」或空字串）
- [x] `line-dispatch-push.ts` `pushOrderCancelledToBidders`：T4 改走 `driver.order-cancelled-bidders`（caller 改帶 `db`）
- [x] `orders/[orderId].patch.ts:507`：T5 改走 `driver.order-completed-earnings`（fare 已帶千分位）
- [x] `line-soft-match-push.ts:265`：T6 改走 `driver.softmatch-rejected`（caller 改帶 `db`）
- [x] `driver/apply.post.ts:206`：T7 改走 `driver.application-submitted`（applicantName = body.driverName）
- [x] `admin/drivers/[uid]/document-review.post.ts:116,137`：T8 改走 `driver.document-review`（approved / rejected 各組 reason）
- [x] `admin/drivers/[uid]/vehicle-profile-review.post.ts:126,153`：T9 改走 `driver.vehicle-profile-review`（approved / rejected 各組 reason）

### 訂單模板既有觸發點驗證（不動，但要確認 lang 參數加入）

- [x] `orders/index.post.ts:412` 確認 `resolveTemplate('order.pending', lang)` 傳 lang
- [x] `orders/[orderId].patch.ts:622` 同上 4 個 status template

### 批次 1 prod 推送

- [x] `pnpm lint` 綠燈
- [x] `pnpm build` 綠燈
- [x] commit + push main（commit 4249fff 已 push，Vercel 自動部署 prod）
- [x] Brain AI prod 實測：4 個關鍵場景（建單 / 派發 / 軟配 / 訂單取消）LINE 推播文案正常（Brain AI 確認後已進入批次 2）
- [x] 確認後進入批次 2（batch 2 commit f3174b1 已完成）

---

## W5 — Frontend Templates Tab Category

- [x] `app/pages/admin/line-management/index.vue`：`templates` tab 加 category sub-tab（all / order / dispatch / softmatch / driver-notify / bot-reply）
- [x] URL query 同步：`?tab=templates&category=dispatch`
- [x] 列表 filter 邏輯：按 category 過濾
- [x] bot-replies 整合進 templates tab（舊 `?tab=bot-replies` 做 redirect 到 `?tab=templates&category=bot-reply`）

---

## W6 — TemplateEditor outputType 切換 + 純文字編輯器

- [x] `app/components/admin/line-management/TemplateEditor.vue`：根據 `template.outputType` 切換編輯器
- [x] 純文字編輯器：body textarea + placeholder hint chips + char count
- [x] Flex 編輯器既有不動
- [x] PUT endpoint payload schema 統一處理（content 結構依 outputType）

---

## W7 — 多語 Tab UI + Badge + 簡易預覽 + 批次 2 上 prod

### Multi-lang Tab

- [x] `i18nMode='multi'` 模板顯三語 tab（繁中 / EN / JA）
- [x] `i18nMode='single'` 模板不顯 tab（編輯區直接是繁中）
- [x] 切換 tab 時切換 content 來源（不重新 fetch；langCache + form 同步）

### 列表 Badge

- [x] 卡片加 4 個 badge：triggerType / outputType / i18nMode / audience
- [x] `requiresSuperLevel=true` 且 `!isSuper` 時：[編輯] 按鈕 disabled + tooltip「需 super 權限」（列表 entry disable click + 🔒 icon + tooltip + EnsureSelectedTemplateInCategory 自動跳過 locked）

### 簡易卡片預覽

- [x] Flex 預覽：title / body / cover / CTA（無 LINE Bubble 完整模擬）（W6 已完成）
- [x] Text 預覽：body 原樣顯示 + placeholder 範例對照（W6 已完成）
- [x] 切 placeholder 範例值看渲染（範例值取自 PlaceholderDef.example）（W6 已完成）

### Backend 微調（W7 多語 GET 必要）

- [x] `server/routes/nuxt-api/admin/notification-templates/[key].get.ts` 加 `contentByLang: Record<TemplateLang, TemplateContent | null>` 欄位（additive，保留 legacy `content` 指向 zh_tw）
- [x] `NotificationTemplateDetailRes` 同步擴 `contentByLang`

### 批次 2 prod 推送

- [x] `pnpm lint` + `pnpm build` 綠燈
- [x] commit + push main（commit f3174b1 已 push，Vercel 自動部署 prod）
- [x] Brain AI prod 實測：admin 可編輯各 category 模板、權限限制正確、預覽正常、三語 tab 可切換 + 各自編輯（Brain AI 確認後已進入批次 3）
- [x] 確認後進入批次 3（batch 3 commit 2d25919 已完成）

---

## W8 — Audit Log + 驗收

### Audit log 寫入

- [x] `server/routes/nuxt-api/admin/notification-templates/[key].put.ts`：成功後 `writeAuditLog({ action: 'notification_template.update', targetType: 'notification_template', targetId: templateKey, payload: {} })`（W2 已寫入，W8 把 action 從 `line.template.update` 改名為 `notification_template.update` 對齊 design）
- [x] `server/routes/nuxt-api/admin/notification-templates/[key]/reset.post.ts`：同上 `action: 'notification_template.reset'`（同上改名）

### Permission enforcement

- [x] PUT/reset endpoint：讀 `meta.requiresSuperLevel` 後校驗 `auth.level === 'super'`；非 super 回 403 + 三語錯誤訊息
- [ ] e2e：assistant 嘗試改 `dispatch.driver-pending` → 403（待 Brain AI prod 實測）

### 12 個模板 e2e 驗證（Brain AI prod 實測）

- [ ] F1 派發 → driver 收 Flex 文案正常
- [ ] F3 配對成功 → passenger 收 Flex 三語
- [ ] F4 中選通知 → driver 收 Flex
- [ ] F5 軟配 → passenger 收 Flex + ✓/✗ list 正常 + 按鈕可點
- [ ] F6 重新配對 → passenger 收 Flex
- [ ] T3-T9 → driver/applicant 收純文字、placeholder 替換正常

### Fallback 路徑（Brain AI prod 實測）

- [ ] 模板 enabled=false 時：loadTemplate 回 null → resolveTemplate fallback registry default，推播文案為預設
- [ ] 模板 doc 不存在時：同上

---

## W9 — OpenSpec Archive + Memory Update + 留尾

### OpenSpec

- [x] proposal.md / design.md / tasks.md 反映最終狀態（含修改紀錄；W2 nested content / W7 contentByLang / W8 super 校驗 / audit log action 改名統一全部勾選）
- [ ] `openspec validate 2026-05-23-line-template-expansion`（local 無 openspec CLI；Brain AI 用 /opsx:verify 驗證）
- [ ] `/opsx:archive` 移到 `archive/`（待 Brain AI prod 驗 W5-W8 後執行）

### Memory update

- [x] 更新 `memory/project-line-template-expansion.md`（OpenSpec 完工記錄，已記 batch 1+2+3 全完成）
- [x] 更新 `MEMORY.md` index（已標 batch 1+2+3）

### 批次 3 prod 推送

- [x] 最終一次 `pnpm lint` + `pnpm build` 綠燈
- [x] commit + push main（W8 audit log action 改名 + requiresSuperLevel 校驗）
- [ ] Brain AI 最終確認（W5-W8 全功能 prod 實測）→ 確認後 Brain AI 觸發 archive

### Phase 2 留尾（不做、記錄）

- [ ] F8 公告整合進 line-management（need user 拍板）
- [ ] F9 推薦分享卡整合進 line-management
- [ ] T15-T17 adminNotify 模板化
- [ ] R4 軟配 postback 成功訊息模板化
- [ ] 完整 Flex Simulator
- [ ] 條件區塊編輯器
