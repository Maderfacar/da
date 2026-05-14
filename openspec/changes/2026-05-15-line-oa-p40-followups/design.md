# Design — P40 LINE OA 系統收尾

> 對應 [proposal.md](proposal.md)。以**推 spec 預設**（Q1=runtimeConfig / Q2=2a / Q3=3b / Q4=4b / Q5=5a）展開設計。

## 1. Postback Whitelist 補入（Q1）

### 1.1 LIFF URL 設定

新增 `runtimeConfig.public.liffBaseUrl`（如 `https://liff.line.me/{liffId}` 或 `https://da-line-liff-app.vercel.app`）。Postback handler 從此組各頁 URL：

```typescript
const liffBase = useRuntimeConfig().public.liffBaseUrl;
const bookingUrl = `${liffBase}/booking`;
const notificationsUrl = `${liffBase}/notifications`;
// ...
```

如已存在 `NUXT_PUBLIC_LIFF_BASE_URL` 或對等 env var → 沿用；否則新增。

### 1.2 Whitelist 內容

[server/utils/line-postback-handlers.ts](server/utils/line-postback-handlers.ts) `POSTBACK_WHITELIST` 補入：

```typescript
export const POSTBACK_WHITELIST: PostbackEntry[] = [
  // ── Passenger OA ─────────────────────────────────────
  {
    data: 'OPEN_BOOKING',
    label: '開啟訂車 LIFF',
    channel: 'passenger',
    handler: async ({ lineUid }) => ({
      replyMessages: [{
        type: 'text',
        text: `請點此開啟訂車：${useRuntimeConfig().public.liffBaseUrl}/booking`,
      }],
    }),
  },
  {
    data: 'OPEN_NOTIFICATIONS',
    label: '開啟通知中心',
    channel: 'passenger',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `查看最新消息：${useRuntimeConfig().public.liffBaseUrl}/notifications`,
      }],
    }),
  },
  {
    data: 'CONTACT_SUPPORT',
    label: '聯絡客服',
    channel: 'both',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `客服 LINE：${useRuntimeConfig().public.lineOaAddUrlDriver ?? '請於 OA 內留言，我們將盡快回覆。'}`,
      }],
    }),
  },
  {
    data: 'MY_TRIP',
    label: '查看我的行程',
    channel: 'passenger',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `查看您的行程：${useRuntimeConfig().public.liffBaseUrl}/orders`,
      }],
    }),
  },

  // ── Driver OA ────────────────────────────────────────
  {
    data: 'OPEN_DASHBOARD',
    label: '開啟司機儀表板',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `司機儀表板：${useRuntimeConfig().public.liffBaseUrl}/driver/dashboard`,
      }],
    }),
  },
  {
    data: 'PENDING_LIST',
    label: '搶單列表',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `查看可接訂單：${useRuntimeConfig().public.liffBaseUrl}/driver/pending`,
      }],
    }),
  },
  {
    data: 'MY_PROFILE',
    label: '司機個人頁',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `個人資料：${useRuntimeConfig().public.liffBaseUrl}/driver/profile`,
      }],
    }),
  },
  {
    data: 'TRIP_GPS',
    label: '任務 GPS',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `任務 GPS 導航：${useRuntimeConfig().public.liffBaseUrl}/driver/trip`,
      }],
    }),
  },
];
```

第一版**簡單 reply text 訊息**；之後可進化成 Flex Bubble。

### 1.3 Admin UI 補強

[richmenu Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue) + [TemplateEditor.vue](app/components/admin/line-management/TemplateEditor.vue) 內 postback action 編輯：
- 新增 `GET /nuxt-api/admin/line-postback-whitelist?channel=passenger|driver|both`（admin client 取 whitelist）
- 表單 input 改 `<el-select>` 從 whitelist 選；free-form 仍允許但 disabled 警示「whitelist 外的 data 需 dev 接 handler」

## 2. Bot Replies Template 化（Q2=2a）

### 2.1 Firestore Schema

新 collection `bot_replies/{replyKey}`：

```typescript
{
  replyKey: 'passenger.follow' | 'passenger.text' | 'driver.follow' | 'driver.text',
  enabled: boolean,
  text: string,                  // 1-500，純文字
  updatedBy: string,
  updatedAt: Timestamp,
}
```

### 2.2 Server util 改

[server/utils/line-channel.ts](server/utils/line-channel.ts) 加 loader：

```typescript
async function _loadBotReply(
  db: Firestore,
  client: LineClient,
  type: 'follow' | 'text',
): Promise<string> {
  try {
    const snap = await db.collection('bot_replies').doc(`${client}.${type}`).get();
    if (snap.exists) {
      const d = snap.data();
      if (d?.enabled !== false && typeof d?.text === 'string' && d.text.length > 0) {
        return d.text;
      }
    }
  } catch (err) {
    console.warn(`[bot-reply] load ${client}.${type} failed:`, err);
  }
  // fallback hard-coded
  return type === 'follow' ? FOLLOW_MESSAGES[client] : TEXT_REPLY_MESSAGES[client];
}
```

`handleLineWebhook` 的 follow / text 分支改 call `_loadBotReply` 取得文案。

### 2.3 Admin Endpoints + UI

| Method | Path | 用途 |
|---|---|---|
| GET | `/nuxt-api/admin/bot-replies` | 列 4 個 replyKey（doc 不存在回 hard-coded default 預覽） |
| PUT | `/nuxt-api/admin/bot-replies/[key]` | upsert（text + enabled） |

Admin UI：/admin/line-management 「自動回覆」tab：
- 4 個 row × { channel 標籤 + type 標籤 + enabled toggle + textarea + 字數計 }
- 動作：儲存 / 還原預設

Firestore rules：`bot_replies` admin read，server-only write。

Audit log 加 `line.bot_reply.update`。

## 3. 公告系統整合（Q3=3b 混合）

### 3.1 共用 Flex builder

[server/utils/announcement-flex.ts](server/utils/announcement-flex.ts) `buildAnnouncementFlex` 改為內部 wrap `buildTemplateFlex`：

```typescript
import { buildTemplateFlex, type TemplateContent } from '@@/utils/template-registry';

export function buildAnnouncementFlex(ann: {
  title: string; body: string; coverImageUrl: string | null;
  ctaButton: { label: string; url: string } | null;
}): LineMessage {
  const content: TemplateContent = {
    title: ann.title,
    body: ann.body.replace(/<[^>]+>/g, '').slice(0, 200),  // 公告 HTML strip
    coverImageUrl: ann.coverImageUrl,
    ctaButton: ann.ctaButton ? {
      label: ann.ctaButton.label,
      action: { type: 'uri', url: ann.ctaButton.url },
    } : null,
  };
  const flex = buildTemplateFlex(content, {});
  // buildTemplateFlex 可能回 null（缺 title/body），公告不應允許這種情況
  if (!flex) throw new Error('Announcement missing title/body');
  return flex;
}
```

### 3.2 公告 admin UI 不變

[/admin/notifications](app/pages/admin/notifications/index.vue) + [announcement/Edit.vue](app/components/open/dialog/announcement/Edit.vue) 維持現狀（target 過濾 / channels.line/inApp / multicast 流程都不動）。

通用 TemplateEditor 不含公告 category（公告是動態多筆 doc，不適合 registry 靜態 schema）。

## 4. Diagnostics MVP（Q4=4b）

### 4.1 Richmenu Sync Overview

新 endpoint：
- `GET /nuxt-api/admin/line-richmenus/sync-overview?channel=passenger|driver`
  - 對指定 channel 撈本地 active richmenu + LINE listRichmenus + LINE getDefaultRichmenuId
  - 回 `{ local: { activeDoc, lineRichMenuId }, line: { defaultId, allMenus: [{id, name, size}...] }, match: boolean, inconsistencies: string[] }`

Admin UI：Diagnostics tab：
- passenger / driver 兩個 panel
- 顯示「本地 active doc.lineRichMenuId vs LINE default richMenuId」一致性
- 顯示 LINE 端孤兒 richmenu（在 LINE 列表但本地無對應 doc）
- 顯示本地有但 LINE 端不存在的 stale lineRichMenuId（doc 紀錄被 LINE 端清掉）
- 不一致時「重試 sync」按鈕 + 「清理孤兒」按鈕

### 4.2 不做（4a 內容延後 P43）

- `line_event_logs` / `line_api_errors` collection — 延後
- Webhook event raw list — 延後
- LINE API error raw list — 延後

## 5. A1 cleanup（Q5=5a 本案處理）

### 5.1 移除清單

- **Firestore collection**：`admin_settings_notification_templates`（透過 firebase MCP 或一次性 endpoint 刪 `order-pending` doc）
- **Server endpoints**：
  - `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts` 刪
  - `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts` 刪
- **Server util**：`server/utils/order-pending-flex.ts` 刪（caller 改直接 call template-registry）
- **Server caller 改**：`server/routes/nuxt-api/orders/index.post.ts` 把 `loadOrderPendingTemplate` / `buildOrderPendingFlex` 改 `loadTemplate('order.pending')` / `buildTemplateFlex(...)`
- **Admin UI**：
  - 移除 [app/pages/admin/settings/index.vue](app/pages/admin/settings/index.vue) NOTIFICATIONS section
  - 移除 `AdminSettingsNotificationTemplate.vue` 元件（auto-import 取消，元件檔本身刪）
  - 移除 `app/protocol/fetch-api/api/admin/index.ts` `GetOrderPendingTemplate` / `PutOrderPendingTemplate` 兩個 method
- **Audit log alias**：[server/utils/audit-log.ts](server/utils/audit-log.ts) `AuditAction` 移除 `notification_template.update`（不影響歷史 audit_logs，僅型別不再 export 那 string literal；如有讀取 audit_logs UI 仍可顯示舊紀錄因為 doc 內存 string）

### 5.2 Firestore Rules

`firestore.rules` 移除 `admin_settings_notification_templates` 規則（若有）— 實際上 P38 沒加進 rules（rule 預設拒絕），所以不需動。

### 5.3 驗證

A1 doc 在 prod 不存在（2026-05-15 firestore MCP check 確認），新 collection 流程在 P38 上線時已驗證。cleanup 可一次性執行不會破壞既有流程。

## 6. 開放問題（待 Brain AI 拍板）

### Q1 — Postback LIFF URL 取值來源

| 選項 | 描述 |
|---|---|
| **1a 推 spec 預設**：用 `runtimeConfig.public.liffBaseUrl`（先檢查既有 env var，沒有再新增） |
| 1b 新增專屬 env var（如 `NUXT_PUBLIC_LIFF_PASSENGER_BASE` / `_DRIVER_BASE`）— 雙 LIFF app 場景 |

### Q2 — Bot Replies 抽離方式

| 選項 | 描述 | 利 | 弊 |
|---|---|---|---|
| **2a 推 spec 預設**：專屬 collection `bot_replies` | 輕量（純 text）| collection 數 +1 |
| 2b 併進 `notification_templates` | 統一 registry | bot reply 純 text vs template 有 Flex schema 不對稱 |
| 2c 只抽進 i18n 檔 | 最簡 | admin 不可改、需 PR |

### Q3 — 公告系統整合

| 選項 | 描述 |
|---|---|
| 3a 不動 |
| **3b 推 spec 預設**：混合（內部共用 buildTemplateFlex，外部行為不變） |
| 3c 完全併（重構大，建議延後 P42） |

### Q4 — Diagnostics 範圍

| 選項 | 描述 |
|---|---|
| 4a 完整（event log + error log + sync overview）|
| **4b 推 spec 預設**：MVP（只 sync overview + 孤兒清理）|
| 4c 延後 P43 |

### Q5 — A1 cleanup 時機

| 選項 | 描述 |
|---|---|
| **5a 推 spec 預設**：本案處理（A1 doc 不存在已驗證，cleanup 風險低） |
| 5b 延後 P41（保守）|

## 7. 決策紀錄

**2026-05-15 Brain AI 拍板：Q1-Q5 全部採推 spec 預設。**

| Q | 拍板 | 摘要 | 連動影響 |
|---|---|---|---|
| Q1 | **1a** | LIFF URL 取自 `runtimeConfig.public.liffBaseUrl`（先查既有 env，缺則新增） | Phase 1 開工先驗 prod 是否已設 `NUXT_PUBLIC_LIFF_BASE_URL`；若缺則列 Vercel UI 設定為 User 行動（MCP 無工具） |
| Q2 | **2a** | 抽進專屬 `bot_replies/{client}.{type}` collection（4 doc：`passenger.follow` / `passenger.text` / `driver.follow` / `driver.text`） | Phase 2 新增 1 個 Firestore collection + 1 條 rules + Claude 自跑 `firebase deploy --only firestore:rules`；audit log 加 `line.bot_reply.update` + `bot_reply` targetType |
| Q3 | **3b** | 公告整合走混合策略：`announcement-flex.ts` 內部改 call `buildTemplateFlex` 共用 Flex builder，對外簽名 + admin UI / multicast 流程完全不變 | Phase 3 動 `announcement-flex.ts` 一檔；公告 admin UI 不動；e2e 跑公告發佈確認 Flex 結構與 P38 一致 |
| Q4 | **4b** | Diagnostics MVP：只做 richmenu sync overview（GET 本地 active vs LINE listRichmenus / getDefaultRichmenuId 比對 + 孤兒/stale 一致性 dashboard + 重試 sync + 清理孤兒）；不寫 `line_event_logs` / `line_api_errors` collection | Phase 3 新增 1 endpoint + admin Diagnostics tab；零 Firestore 寫入成本；event/error log 完整版延後 P43 |
| Q5 | **5a** | 本案處理 A1 cleanup：移除 A1 collection + 2 endpoint + admin/settings NOTIFICATIONS section + `AdminSettingsNotificationTemplate.vue` + `order-pending-flex.ts` wrapper + `AuditAction.notification_template.update` alias；`orders/index.post.ts` 改直接 call `loadTemplate('order.pending')` | Phase 4 內處理；A1 doc prod 已驗證不存在，cleanup 風險最低；無 P41 留尾 |

### 7.1 Q1=1a 細節

第一版 8 個 entry handler 全部 reply text 訊息（含 LIFF URL），不做 Flex Bubble；後續視使用情境再進化。Admin UI（[richmenu Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue) + [TemplateEditor.vue](app/components/admin/line-management/TemplateEditor.vue)）postback action input 改 `<el-select>` 從 `GET /nuxt-api/admin/line-postback-whitelist?channel=...` 撈；free-form 仍允許但 disabled 警示「whitelist 外的 data 需 dev 接 handler」。

### 7.2 Q2=2a 細節

`bot_replies` schema：`{ replyKey, enabled, text(1-500), updatedBy, updatedAt }`。`_loadBotReply(db, client, type)` helper 內 fallback hard-coded `FOLLOW_MESSAGES` / `TEXT_REPLY_MESSAGES`（保留既有字串作為 default 預覽 + 還原預設按鈕）。Admin tab 4 row × { type 標籤 + enabled toggle + textarea + 字數計 + 儲存 / 還原預設 }。

### 7.3 Q3=3b 細節

`buildAnnouncementFlex` 接受相同 input → 內部組 `TemplateContent` → call `buildTemplateFlex` → `null` 結果視為錯誤（公告必有 title/body）。公告 HTML strip 維持現狀（`replace(/<[^>]+>/g, '').slice(0, 200)`）。通用 TemplateEditor **不含**公告 category（公告是動態多筆 doc，與 registry 靜態 schema 不對稱）。

### 7.4 Q4=4b 細節

`GET /admin/line-richmenus/sync-overview?channel=passenger|driver` 回 `{ local: {activeDoc, lineRichMenuId}, line: {defaultId, allMenus[]}, match, inconsistencies[] }`。Diagnostics tab 兩 panel（passenger / driver），不一致時提供「重試 sync」+「清理孤兒」按鈕（後者復用 DELETE / 新增 cleanup endpoint）。

### 7.5 Q5=5a 細節

cleanup 順序：
1. 改 `orders/index.post.ts` caller 改 call template-registry path（無 import wrapper）
2. 移除 `order-pending-flex.ts`
3. 移除 A1 endpoint 2 個
4. 移除 admin/settings NOTIFICATIONS section + `AdminSettingsNotificationTemplate.vue`
5. 移除 protocol 2 method + interface
6. 移除 `AuditAction.notification_template.update` alias（targetType `notification_template` 保留供新 action 使用）
7. firestore MCP 驗 prod doc 不存在（已驗 / 跳過）

P41 留尾項目本案吸收，無後續 cleanup wave 待辦。
