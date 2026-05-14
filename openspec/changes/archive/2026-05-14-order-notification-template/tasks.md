# Tasks — 訂單建立通知模板（Wave 3-A1）

## Phase 0 — Spec 三件套（~0.5h）

- [ ] 建立 `openspec/changes/2026-05-14-order-notification-template/` 目錄
- [ ] 寫 `proposal.md`（Why / What Changes / Out of Scope / Impact）
- [ ] 寫 `design.md`（Schema / Server / UI / 部署計劃 / 驗收標準）
- [ ] 寫 `tasks.md`（本檔）
- [ ] commit `docs(Wave3-A1 Phase 0): openspec spec 三件套` + push

## Phase 1 — Server（~1.5h）

### 1.1 Flex Builder

- [ ] 建立 `server/utils/order-pending-flex.ts`
  - [ ] 介面：`OrderPendingTemplate`、`OrderPendingParams`
  - [ ] 函式：`buildOrderPendingFlex(template, params) → LineMessage | null`
  - [ ] 函式：`loadOrderPendingTemplate(db) → Promise<OrderPendingTemplate | null>`
  - [ ] placeholder 替換：`{date}`、`{pickup}`、`{vehicle}`、`{fare}`、`{orderId}`
  - [ ] cover URL 驗 https://；ctaButton URL 替換後再驗 https://
  - [ ] template 不合法（缺 title/body）→ 回 null

### 1.2 Admin Endpoints

- [ ] `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts`
  - [ ] 驗 auth + `hasPermission(auth, 'canBroadcast')`
  - [ ] 讀 `admin_settings_notification_templates/order-pending` doc
  - [ ] 不存在 → 回 `successResponse(null)`
  - [ ] 存在 → 回 OrderPendingTemplate shape

- [ ] `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts`
  - [ ] 驗 auth + `hasPermission(auth, 'canBroadcast')`
  - [ ] body validation：title 1-60、body 1-1000、cover null|https、CTA null|{label 1-20, url https}
  - [ ] Firestore set merge + updatedBy + updatedAt
  - [ ] audit log `notification_template.update`
  - [ ] 回 `successResponse({ ok: true })`

### 1.3 API Client + Type 宣告

- [ ] `app/protocol/fetch-api/api/admin/index.ts`：`GetOrderPendingTemplate` / `PutOrderPendingTemplate`
- [ ] 介面：`OrderPendingTemplate`（在 admin 區域宣告）

### 1.4 orders/index.post.ts 整合

- [ ] 替換 line 192-218 區塊
- [ ] template 不存在 → fallback 既有 `getOrderMessage('order.pending', lang, params)` text
- [ ] 保留 fire-and-forget pattern

### 1.5 驗證

- [ ] `pnpm lint` 通過
- [ ] `pnpm build` 通過（檢查 chunk 產出 `order-pending.get.mjs` / `.put.mjs`）
- [ ] commit `feat(Wave3-A1 Phase 1): 訂單建立通知模板 server 端` + push

## Phase 2 — Admin UI（~2.5h）

### 2.1 子元件

- [ ] 建立 `app/components/admin/settings/NotificationTemplate.vue`（沿用 AdminSettings* 命名）
  - [ ] script setup：form ref + ApiLoad + ApiSave
  - [ ] 變數 chip 列：5 個 chip + insertAtCursor helper
  - [ ] 表單：title / body / coverImageUrl 上傳 / ctaButton
  - [ ] 右側 Flex 即時預覽（樣式仿 announcement 預覽）
  - [ ] 字數計、URL https:// 驗證、儲存 disabled 狀態
  - [ ] 「還原預設」按鈕：清掉 cover/CTA，title/body 填預設

### 2.2 整合到 settings 頁

- [ ] `app/pages/admin/settings/index.vue` 加 section（在 Fleet 之後、系統設定之前）
- [ ] section 標題 `NOTIFICATIONS` / `通知模板（訂單建立）`
- [ ] 元件以 `<AdminSettingsNotificationTemplate />` 自動匯入

### 2.3 圖片上傳

- [ ] 沿用既有 announcement cover 上傳 endpoint（若不存在則沿用 driver-docs/upload 或新建）
- [ ] 上傳後設 `form.coverImageUrl = signedUrl`
- [ ] 「移除圖片」按鈕清空 coverImageUrl

### 2.4 驗證

- [ ] `pnpm lint` 通過
- [ ] `pnpm build` 通過
- [ ] commit `feat(Wave3-A1 Phase 2): 訂單建立通知模板 admin UI` + push

## Phase 3 — 手測 + Archive（~0.5h）

### 3.1 手測

- [ ] admin 桌機開 /admin/settings → 看到「通知模板（訂單建立）」section
- [ ] 編輯 title + body，點變數 chip 插入 placeholder
- [ ] 上傳 cover 圖片 → 預覽更新
- [ ] 填 ctaButton label + url → 預覽 footer 出現
- [ ] 點儲存 → 看到「已儲存」訊息
- [ ] 重整頁面 → 表單值 persist
- [ ] 乘客端新訂單 → LINE OA 收 Flex 卡（含 cover + CTA）
- [ ] Firebase Console 砍 doc → 乘客新訂單 → 仍收到舊版 text（fallback 生效）
- [ ] assistant level admin 無 canBroadcast → 403 看不到 / 不能編輯（看 endpoint 行為）

### 3.2 Archive

- [ ] 移動 `openspec/changes/2026-05-14-order-notification-template/` → `openspec/changes/archive/`
- [ ] commit `chore(Wave3-A1): archive openspec change — e2e 驗收通過` + push

### 3.3 Memory

- [ ] 寫 `memory/project-wave3-a1.md`（含 commit chain + 拍板決策 + 留尾）
- [ ] 更新 `MEMORY.md` index
