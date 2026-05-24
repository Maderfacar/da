# Design — LINE Template Expansion

## Schema 變更

### `TemplateMeta` 擴充（`server/utils/template-registry.ts`）

```typescript
export type TemplateCategory =
  | 'order'           // 既有
  | 'announcement'    // 既有（不動）
  | 'bot'             // 既有（不動）
  | 'broadcast'       // 既有（保留）
  | 'dispatch'        // 新增：派發 / 配對（F1/F3/F4）
  | 'softmatch'       // 新增：軟性配對（F5/F6）
  | 'driver-notify';  // 新增：司機通知（T3-T9）

export type TemplateOutputType = 'flex' | 'text';
export type TemplateAudience = 'passenger' | 'driver' | 'admin' | 'both';
export type TemplateI18nMode = 'multi' | 'single';  // multi = 三語、single = 繁中
export type TemplateTriggerType = 'auto' | 'manual';  // 預留 manual 給之後

export interface TemplateMeta {
  templateKey: string;
  category: TemplateCategory;
  displayName: string;
  description: string;
  triggerEvent: string;                  // 新增：「訂單狀態切 cancelled 時推給指派司機」
  outputType: TemplateOutputType;        // 新增
  audience: TemplateAudience;            // 新增
  i18nMode: TemplateI18nMode;            // 新增（multi 才會給 admin 三語 tab）
  triggerType: TemplateTriggerType;      // 新增（Phase 1 全 'auto'）
  requiresSuperLevel: boolean;           // 新增（dispatch/driver-notify=true，order/softmatch/bot=false）
  placeholders: PlaceholderDef[];
  defaultContent: TemplateContentBase;   // 結構依 outputType 而異（見下）
  // ⚠️ `fallbackI18nKey` 欄位拔除（Brain AI 拍板）
}

// outputType='flex' 時
interface TemplateContentFlex {
  title: string;
  body: string;
  coverImageUrl?: string | null;
  ctaButton?: TemplateCtaButton | null;
}

// outputType='text' 時
interface TemplateContentText {
  body: string;   // 純文字，含 placeholder
}

type TemplateContentBase = TemplateContentFlex | TemplateContentText;
```

### Firestore `notification_templates/{key}` 文件結構

```typescript
{
  templateKey: string;
  enabled: boolean;          // admin 可關閉，關閉即用 defaultContent

  // i18nMode='multi' 時三語各一份
  content?: {
    zh_tw?: TemplateContentBase;
    en?:    TemplateContentBase;
    ja?:    TemplateContentBase;
  };

  // i18nMode='single' 時只用 zh_tw key
  // content.zh_tw 即為唯一語系內容

  updatedAt: Timestamp;
  updatedBy: string;        // line uid
}
```

## 12 個新模板清單

### Dispatch / Matching（5 個 Flex）

| Key | audience | i18n | 鎖死區塊 | placeholder |
|---|---|---|---|---|
| `dispatch.driver-pending` | driver | single | 「我要接單」postback / 人數+車資 formatter | orderId, date, pickupAddress, dropoffAddress, paxSummary, estimatedFare |
| `dispatch.driver-selected` | driver | single | （無動態區塊）| orderId, date, pickupAddress, dropoffAddress, paxSummary |
| `dispatch.passenger-matched` | passenger | multi | （無動態區塊）| orderId, date, pickupAddress, dropoffAddress, driverName, vehiclePlate, fare |
| `softmatch.passenger-choose` | passenger | multi | ✓/✗ list 渲染 + 3 個 postback 按鈕 action | orderId, date, driverName, vehiclePlate, matchCount, preferenceCount, completedOrders, matchedList, unmatchedList |
| `softmatch.passenger-rematching` | passenger | multi | （無動態區塊）| orderId, date |

### Driver Notify（7 個 Text）

| Key | audience | i18n | placeholder |
|---|---|---|---|
| `driver.order-cancelled-assigned` | driver | single | orderId, cancelReason |
| `driver.order-cancelled-bidders` | driver | single | orderId |
| `driver.order-completed-earnings` | driver | single | orderId, fare |
| `driver.softmatch-rejected` | driver | single | orderId |
| `driver.application-submitted` | driver | single | applicantName |
| `driver.document-review` | driver | single | result (approved/rejected), reason |
| `driver.vehicle-profile-review` | driver | single | result (approved/rejected), reason |

## buildTemplate API

```typescript
// server/utils/template-registry.ts

/** 通用 build：依 outputType 分派到 buildTemplateFlex 或 buildTemplateText */
export function buildTemplate(
  template: ResolvedTemplate,           // loadTemplate 已解出 lang-specific content
  params: Record<string, string>,
): LineMessage | null;

/** 既有：Flex bubble builder */
export function buildTemplateFlex(...): LineMessage | null;

/** 新增：純文字 message builder */
export function buildTemplateText(
  content: TemplateContentText,
  params: Record<string, string>,
): LineMessage | null;
```

```typescript
// loadTemplate 升級：接受 lang 參數
export async function loadTemplate(
  db: Firestore,
  templateKey: string,
  lang: 'zh_tw' | 'en' | 'ja' = 'zh_tw',
): Promise<ResolvedTemplate | null>;
```

## 觸發點改造範例

### Before（hardcoded text）

```typescript
// orders/[orderId].patch.ts:394
await sendLinePush('driver', driverLineUid, [{
  type: 'text',
  text: `⚠️ 訂單已取消\n訂單 #${orderId.slice(0, 8).toUpperCase()} 已被取消。\n${reasonLine}如有疑問請聯絡客服。`,
}]);
```

### After（template-driven）

```typescript
const tpl = await loadTemplate(db, 'driver.order-cancelled-assigned');  // single i18n 不傳 lang
const msg = buildTemplate(tpl, {
  orderId: orderId.slice(0, 8).toUpperCase(),
  cancelReason: body.cancelReason ?? '',
});
if (msg) await sendLinePush('driver', driverLineUid, [msg]);
```

註：模板 disabled 或不存在時 `loadTemplate` 回 `defaultContent`-based template；只有 `templateKey` 完全錯誤才回 null（safety net）。

### Multi-lang 觸發點範例（passenger）

```typescript
const lang = await getUserLang(db, passengerLineUid);  // 'zh_tw' | 'en' | 'ja'
const tpl = await loadTemplate(db, 'softmatch.passenger-choose', lang);
const msg = buildTemplate(tpl, { orderId, date, ... });
if (msg) await sendLinePush('passenger', passengerLineUid, [msg]);
```

## F5/F1 Hybrid 區塊處理

### F5 軟配 Flex 結構

```
┌──────────────────────────────────┐
│ {title}  ← 模板可編              │
│ {subtitle: {matchCount}/{preferenceCount}}  ← 模板可編
├──────────────────────────────────┤
│ 🔖 {orderId}                     │ ← 內部鎖死
│ 🚗 {driverLabel}:{driverName}    │ ← 內部鎖死
│ 📅 {pickupLabel}:{date}          │
│ ✓ {completedLabel(completedOrders)}│
├──────────────────────────────────┤
│ {matchedHeader}                  │ ← 模板可編（header 文字）
│ {matchedList}                    │ ← 內部鎖死（演算法產生，多行）
│ {unmatchedHeader}                │ ← 模板可編
│ {unmatchedList}                  │ ← 內部鎖死
├──────────────────────────────────┤
│ [{btnAcceptLabel}] [{btnWaitLabel}] [{btnCancelLabel}]  ← label 可編、action 鎖死
└──────────────────────────────────┘
```

**實作**：`build_SoftMatchFlex` builder 仍在 server code（不從模板組整個 Flex），但接受 `content.title / subtitle / matchedHeader / unmatchedHeader / btn*Label` 替換對應文字節點。內部 list + button action 不可改。

### F1 訂單派發 Flex 同理

外殼可編：title、訂單摘要欄位的 label（📍 上車點 → 📍 起點）  
內部鎖死：人數摘要 formatter、估算車資 formatter、「我要接單」按鈕 postback data

## Admin UI 設計

### `/admin/line-management?tab=templates` Sub-tab

```
[全部] [📦 訂單] [🚖 派發/配對] [👤 司機通知] [🔁 軟配] [🤖 自動回覆]
```

> bot-replies（R1/R2）合併進 templates tab 的「🤖 自動回覆」sub-tab；舊 `?tab=bot-replies` 做 redirect。

### 列表卡片（每個模板一張）

```
┌──────────────────────────────────────────────────────────┐
│ 📅 自動  🎴 Flex  🌏 三語  🧑‍✈️ 乘客   [權限：admin]    │ ← 4 個 badge
│ 訂單建立通知 · order.pending                              │
│ 「乘客建單成功瞬間推播」                                    │ ← triggerEvent
│ [編輯]  [預覽]  [還原預設]                                 │
└──────────────────────────────────────────────────────────┘
```

Badge 對應：
- `triggerType` → 📅 自動 / ✋ 手動
- `outputType` → 🎴 Flex / 💬 文字
- `i18nMode` → 🌏 三語 / 🇹🇼 繁中
- `audience` → 🧑‍✈️ 乘客 / 🚗 司機 / 👤 管理員 / 🌐 全體
- `requiresSuperLevel` → 額外標 super-only 鎖頭（非 super 時 [編輯] 鈕 disabled）

### TemplateEditor.vue 分支

```typescript
if (template.outputType === 'flex') {
  // 既有 TemplateEditor：title / body / cover / CTA
  // + i18nMode='multi' 時顯三語 tab
} else {
  // 新加 純文字編輯器：body textarea + placeholder hint
  // + i18nMode='multi' 時顯三語 tab
}
```

### 簡易卡片預覽（不做 Flex Simulator）

```
┌─ Flex 預覽 (繁中) ──────────────┐
│ [封面圖]                       │
│ {title}                       │ ← bold
│ {body}                        │ ← 多行
│ [{ctaLabel}]                  │
└───────────────────────────────┘

┌─ 文字預覽 (繁中) ──────────────┐
│ {body}                        │ ← 原樣顯示 placeholder
│                               │
│ Placeholder 範例：             │
│   {orderId} → ABCD1234         │
│   {fare}    → 1,800            │
└───────────────────────────────┘
```

## 權限分層（沿用 P18 isSuper）

| Category | super | admin | assistant |
|---|---|---|---|
| order | ✅ | ✅ | ❌ |
| softmatch | ✅ | ✅ | ❌ |
| bot | ✅ | ✅ | ❌ |
| **dispatch** | ✅ | ❌ | ❌ |
| **driver-notify** | ✅ | ❌ | ❌ |

實作：
- 列表 [編輯] 按鈕在 `requiresSuperLevel && !isSuper` 時 disable + 顯鎖頭
- Server endpoint `PUT /admin/notification-templates/:key` 收到 `requiresSuperLevel=true` 模板時校驗 admin level=super；非 super 回 403

## i18n-message.ts 拔除步驟

1. 移除 `getOrderMessage` / `getReferralPushMessage` 函式
2. 移除 `i18n-message.ts` + 對應 yaml（如有獨立 i18n yaml）
3. 觸發點改為走 `loadTemplate + buildTemplate` 單路徑
4. `fallbackI18nKey` 欄位從 `TemplateMeta` interface + 5 個既有 entry 移除

## Audit Log

```typescript
// 既有 audit-log.ts 已支援 action
await writeAuditLog({
  event,
  auth,
  action: 'notification_template.update',
  targetType: 'notification_template',
  targetId: templateKey,
  payload: { /* 空 — 不存 diff */ },
});
```

對應 endpoint：
- `PUT /admin/notification-templates/:key`
- `POST /admin/notification-templates/:key/reset`

## 不變動的事

- `template-registry.ts` `buildTemplateFlex` 既有實作不動（只新增 buildTemplateText + buildTemplate 分派器）
- `/admin/notifications` 公告管理頁完全不動
- `/admin/referral` 推薦活動頁完全不動
- `notification_templates` collection schema 主要 key 不變（只擴 lang 欄位）
- richmenu / diagnostics / event-logs / api-errors 完全不動
- LINE webhook handler 完全不動

## 設計風險與緩解

| 風險 | 緩解 |
|---|---|
| F5/F1 hybrid 內部 builder 改動破壞既有渲染 | 保留既有 builder 函式簽名、加 optional `customLabels` 參數；既有 caller 不傳則用既有 hardcoded 文字 |
| 模板 disabled 後訊息變空 | `loadTemplate` 一律回 defaultContent-based template；只有完全找不到 key 才回 null |
| Admin 不小心刪掉必要 placeholder | reset 按鈕一鍵還原 registry default；audit log 可追溯 |
| 三語 / 繁中切換錯位 | i18nMode='single' 的模板 server 端強制讀 zh_tw key，無視 lang 參數 |
| 12 個觸發點改動有 regression | 每個觸發點改完跑一次 LINE 推播實測；批次 1 推 prod 後 Brain AI 在 LINE 確認所有觸發場景 |

## OpenSpec 留尾（不在 Phase 1）

- F8 公告整合進 line-management（need user 拍板，目前不做）
- F9 推薦分享卡整合進 line-management（同上）
- T15-T17 adminNotify 模板化
- R4 軟配 postback 成功訊息模板化
- 完整 Flex Simulator 預覽
- 條件區塊編輯器（給未來新增非標準 Flex 用）
- 模板 i18n 自動翻譯（gpt 輔助）
