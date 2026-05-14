# 2026-05-14 — 訂單建立通知模板（Order Pending Notification Template / Wave 3-A1）

## Why

P37 訂單事件推播（`server/utils/i18n-message.ts`）目前**寫死在程式碼**，admin 無法調整文案。痛點：

1. **無法 A/B 文案**：行銷想試「📝 訂單已建立」vs「✅ 已收到您的訂單」這類字眼差異，必須改 code + 部署
2. **無法加宣傳**：訂單建立瞬間是品牌觸達的黃金時機，目前只能純文字 emoji，無封面圖也無 CTA 按鈕
3. **無法即時改字眼**：節慶 / 促銷活動期間想換問候語（如「中秋連假，行程平安」），改 code 走 PR 流程過慢
4. **與 P37 announcement 結構不對稱**：announcement 已支援 Flex（hero / body / CTA），但訂單事件還是 raw text，UX 跳 tier

P37 announcement-flex.ts 已建好 Flex builder pattern，本案沿用同套結構讓 admin 在 `/admin/settings` 編輯訂單建立通知模板，第一階段只做 **`order.pending`** 一個事件（最高頻、最值得行銷化）。

## What Changes

### 1. Firestore Schema

新增 `admin_settings/notification-templates/order-pending`（單一 doc，path 固定）：

```typescript
{
  title: string;                 // 必填，with placeholder {date}/{pickup}/{vehicle}/{fare}/{orderId}
  body: string;                  // 必填，with placeholder
  coverImageUrl: string | null;  // optional，Firebase Storage URL，1024×1024 jpg/png/gif < 10MB
  ctaButton: {
    label: string;               // max 20 字
    url: string;                 // https://... 或含 placeholder 如 https://example.com/orders/{orderId}
  } | null;
  updatedBy: string;             // admin lineUid
  updatedAt: Timestamp;
}
```

**三語策略**：模板**只存繁中**，依 `users/{lineUid}.lang` 顯示時 fallback `zh_tw`（不做 admin 三語編輯介面，避免複雜度爆炸）。en / ja 使用者仍收到繁中 Flex 卡片（與 P37 announcement target=all 行為一致）。

### 2. Server：Flex Builder

新增 `server/utils/order-pending-flex.ts`：

```typescript
export interface OrderPendingTemplate {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: { label: string; url: string } | null;
}

export interface OrderPendingParams {
  date: string;
  pickup: string;
  vehicle: string;
  fare: string;
  orderId: string;
}

/** 套用 placeholder → 組 Flex Bubble；template 為 null 時回 null（呼叫端 fallback i18n text） */
export function buildOrderPendingFlex(
  template: OrderPendingTemplate | null,
  params: OrderPendingParams,
): LineMessage | null;
```

Placeholder 注入：`{date}`、`{pickup}`、`{vehicle}`、`{fare}`、`{orderId}` 在 title / body / ctaButton.url 內全部 string replace。

### 3. Admin Endpoints

- `GET /nuxt-api/admin/settings/notification-templates/order-pending`（read，需 `canBroadcast`）
- `PUT /nuxt-api/admin/settings/notification-templates/order-pending`（upsert，需 `canBroadcast`）
- 寫入時 audit log `notification_template.update`（沿用 P25-2 audit-log util）

### 4. orders/index.post.ts 改套模板

既有 `getOrderMessage('order.pending', lang, params)` text push → 改為：

```typescript
const template = await loadOrderPendingTemplate(db);  // 讀 admin_settings doc
const flex = buildOrderPendingFlex(template, params);
if (flex) {
  await sendLinePush('passenger', lineUserId, [flex]);
} else {
  // fallback：模板未設定（doc 不存在） → 退回 P37 既有 i18n text
  const text = getOrderMessage('order.pending', lang, params);
  await sendLinePush('passenger', lineUserId, [{ type: 'text', text }]);
}
```

### 5. Admin UI

`/admin/settings` 新增 section「訂單建立通知模板」：

- 表單欄位：title / body / coverImageUrl（**沿用既有圖片上傳 endpoint** — announcement 用的 driver-docs/upload 或 storage 上傳 helper）/ ctaButton.label / ctaButton.url
- 變數提示 chip：`{date}` `{pickup}` `{vehicle}` `{fare}` `{orderId}` — 點擊插入 cursor 位置
- LINE Flex 即時預覽（複用 P37 思路：右側卡片預覽 mockup）
- 動作：儲存（PUT） / 還原預設（清掉 cover/CTA、title/body 預填繁中預設文案）

## Out of Scope（明確不做）

- ❌ 其他 4 個訂單事件（confirmed / en_route / completed / cancelled）— 留 **P39** 做模板化
- ❌ admin 三語編輯介面（en / ja 模板）— 第一版只支援繁中
- ❌ 模板 A/B test split — 純單一模板
- ❌ 模板版本歷史 / 回滾 — 只記 updatedAt + updatedBy；要回滾 admin 手動改回去
- ❌ 修改 P37 announcement 系統（已 archive 不動）
- ❌ richmenu（P38 = Wave 4）

## Impact

### 影響範圍

- **新增 Firestore doc**：`admin_settings/notification-templates/order-pending`（單一 doc，不需 index）
- **新增 endpoint**：2 個（admin GET + PUT 共用 path）
- **新增 server util**：`server/utils/order-pending-flex.ts`
- **小改檔**：`server/routes/nuxt-api/orders/index.post.ts`（template 路徑 + fallback 邏輯）
- **大改頁面**：`app/pages/admin/settings/index.vue`（加 section + 表單 + Flex 預覽）
- **i18n**：admin 端 hardcode 繁中（policy 沿用 P37 admin 不 i18n）

### 風險

| 風險 | 緩解 |
|---|---|
| 模板存錯 / 缺少 placeholder 導致推播訊息怪 | server 端 validation：title/body 必填、length 限制；fallback 既有 i18n text |
| Flex 規格錯誤導致 LINE 推播失敗 | builder 內 validation：URL 必須 https://、cover 圖片 URL 規範同 P37 announcement-flex；catch 失敗時 fallback text |
| cover 圖片 URL placeholder 替換有 bug | placeholder 替換只走 title / body / ctaButton.url，**cover 不支援 placeholder**（簡化） |
| 變更 endpoint 後既有訂單建立流程 regression | fallback 設計確保模板缺失時行為與既有完全一致 |
| Phase 拆分時中間狀態破壞 prod | Phase 1 server 端完成後就具備 fallback；Phase 2 admin UI 上線前 prod 流程不受影響 |

### 估時

- Phase 0（spec）：~0.5h
- Phase 1（server）：~1.5h（util + 2 endpoint + post.ts 整合 + lint/build）
- Phase 2（admin UI）：~2.5h（表單 + Flex 預覽 + 變數 chip + 圖片上傳重用）
- Phase 3（驗收 + archive）：~0.5h

**總計 ~5h**，可單日內完成。
