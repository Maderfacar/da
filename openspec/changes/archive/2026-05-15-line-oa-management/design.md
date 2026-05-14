# Design — Admin LINE OA 管理系統（P38）

> 對應 [proposal.md](proposal.md)。本檔以**推 spec 預設**（Q1-Q8）展開技術設計，Brain AI 改 default 後對應 section 同步重寫。
> 推 spec 預設：Q1=single-active + multi-draft / Q2=純上傳 / Q3=uri+message+postback / Q4=4a server hard-coded registry / Q5=5b alias / Q6=6b A1+P39 / Q7=與 Q3 對齊 / Q8=8b 獨立頁

## 1. LINE Messaging API 整理（richmenu 部分）

### 1.1 Endpoint 清單

| Method | URL | 用途 |
|---|---|---|
| POST | `https://api.line.me/v2/bot/richmenu` | 建立 richmenu（json body：size + areas） |
| POST | `https://api-data.line.me/v2/bot/richmenu/{id}/content` | 上傳圖片（binary body，image/jpeg or image/png） |
| GET | `https://api.line.me/v2/bot/richmenu/list` | 列所有 richmenu |
| GET | `https://api.line.me/v2/bot/richmenu/{id}` | 單筆詳情 |
| DELETE | `https://api.line.me/v2/bot/richmenu/{id}` | 刪除（一併刪圖） |
| POST | `https://api.line.me/v2/bot/user/all/richmenu/{id}` | 設為全 user 預設 |
| DELETE | `https://api.line.me/v2/bot/user/all/richmenu` | 清預設 |
| GET | `https://api.line.me/v2/bot/user/all/richmenu` | 取得目前預設 id（404 = 無） |
| POST | `https://api.line.me/v2/bot/user/{userId}/richmenu/{id}` | per-user 綁定（測試用） |
| DELETE | `https://api.line.me/v2/bot/user/{userId}/richmenu` | per-user 解除 |

兩個 OA 都用相同 endpoint，差別只在 Authorization header 用哪個 access token（passenger / driver — 沿用 `getLineChannel(client)`）。

### 1.2 Image 規格（嚴格）

| 項 | 限制 |
|---|---|
| 格式 | JPEG 或 PNG |
| 大尺寸 | 2500 × 1686 px |
| 緊湊尺寸 | 2500 × 843 px |
| 檔案大小 | ≤ 1 MB |
| 寬高比 | 必須與建立時 `size.width / size.height` 完全一致 |

若 admin 上傳寬高不符或超檔 → LINE 回 400。本系統 server 端用 `sharp` 預先驗證寬高，filesize 在 Storage upload 前 client 端 check。

### 1.3 Area 規格

```typescript
// 單一 area
{
  bounds: { x: number; y: number; width: number; height: number },  // 像素，相對 richmenu 圖
  action:
    | { type: 'uri'; uri: string; label?: string }                    // 外連
    | { type: 'message'; text: string; label?: string }               // 送文字訊息
    | { type: 'postback'; data: string; displayText?: string; label?: string },  // 觸發 webhook
}
```

- max 20 個 areas
- bounds 不可超出 size 範圍
- bounds 可重疊（LINE 不強制，但 UX 不建議）
- `label`：1-20 字（screen reader 用）

### 1.4 Richmenu metadata

```typescript
{
  size: { width: 2500; height: 1686 | 843 },
  selected: boolean,    // 預設打開或收起；true=打開
  name: string,         // 1-300，僅 admin 用，user 看不到
  chatBarText: string,  // 1-14 字，OA chat 底部那條字
  areas: Area[],
}
```

### 1.5 Sync 順序（建立 + publish 為 default）

1. POST `/v2/bot/richmenu` → 拿到 `richMenuId`
2. POST `/v2/bot/richmenu/{id}/content` 上傳 image binary
3. （若要設預設）POST `/v2/bot/user/all/richmenu/{id}`
4. 寫回本系統 Firestore doc 的 `lineRichMenuId` 欄位 + sync 狀態

刪除順序：先 DELETE `/v2/bot/user/all/richmenu`（若該 menu 是 default）→ DELETE `/v2/bot/richmenu/{id}`。

## 2. Firestore Schema

### 2.1 `line_richmenus/{richmenuId}` — Richmenu 主檔

```typescript
{
  // 識別
  id: string;                       // doc id（auto-id）
  channel: 'passenger' | 'driver';  // 屬於哪個 OA
  status: 'draft' | 'active' | 'archived';  // 同 channel 同時最多 1 個 active
  name: string;                     // admin 用名稱（如「Passenger 主選單 v1」）

  // LINE 同步狀態
  lineRichMenuId: string | null;    // LINE 端對應 id（建立後寫回；null = 尚未 push 到 LINE）
  syncStatus: 'not_synced' | 'syncing' | 'synced' | 'sync_failed';
  syncError: string | null;
  lastSyncedAt: Timestamp | null;

  // 圖片
  imageUrl: string | null;          // Firebase Storage URL（admin 上傳）
  imageSize: { width: 2500; height: 1686 | 843 };
  imageBytes: number;

  // Richmenu 內容
  chatBarText: string;              // 1-14
  selected: boolean;                // 預設打開或收起
  areas: Area[];                    // max 20，§1.3 規格

  // 後設
  createdBy: string;                // admin lineUid
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  publishedAt: Timestamp | null;    // 第一次切 active 的時間
  archivedAt: Timestamp | null;
}
```

**單一 active 約束**：同 channel 內若有 active，publish 新 active 需先把舊 active 切 archived（在 PATCH endpoint 內 transaction 保證）。

### 2.2 `notification_templates/{templateKey}` — 通用模板（A1 泛化）

> **Q5=5b 推 spec 預設**：保留 A1 既有 collection `admin_settings_notification_templates/order-pending`；新 collection `notification_templates` 為通用版本，A1 endpoint 內部 alias 改讀新 collection；舊 doc 一次性 migrate（Phase 3 內 script）。
> 若 Q5=5a → 維持 A1 collection 不動，新 collection 並存（風險最低）；5c → 直接 break，admin UI 統一切新 collection。

```typescript
{
  // 識別
  templateKey: string;              // doc id（如 'order.pending' / 'order.confirmed' / 'announcement.default' / 'bot.follow.passenger'）
  category: 'order' | 'announcement' | 'bot' | 'broadcast';
  enabled: boolean;                 // false = 推送時 fallback i18n text（沿用 A1 行為）

  // 內容（同 A1 結構，但 ctaButton.action 擴充）
  title: string;                    // 1-60
  body: string;                     // 1-1000
  coverImageUrl: string | null;     // HTTPS Firebase Storage URL
  ctaButton: {
    label: string;                  // 1-20
    action:
      | { type: 'uri'; url: string }
      | { type: 'message'; text: string }
      | { type: 'postback'; data: string; displayText?: string };
  } | null;

  // 後設
  updatedBy: string;
  updatedAt: Timestamp;
}
```

### 2.3 `bot_replies/{replyKey}` — Bot 自動回覆（若 Q6=6c）

```typescript
{
  replyKey: string;                 // 'passenger.follow' / 'passenger.text' / 'driver.follow' / 'driver.text'
  enabled: boolean;
  text: string;                     // 1-500，純文字（不走 Flex，避免歡迎訊息過 fancy）
  updatedBy: string;
  updatedAt: Timestamp;
}
```

### 2.4 Firestore Rules

```javascript
match /line_richmenus/{id} {
  allow read: if request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
  allow write: if false;  // 強制走 server endpoint（image binary push + audit log）
}

match /notification_templates/{key} {
  allow read: if request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
  allow write: if false;
}

match /bot_replies/{key} {
  allow read: if request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
  allow write: if false;
}
```

### 2.5 Composite Indexes

`line_richmenus`：`(channel ASC, status ASC, updatedAt DESC)` — list 頁分 channel + status 過濾用。

`notification_templates`：`(category ASC, enabled ASC, templateKey ASC)` — 列表分類過濾用。

## 3. Template Registry（Q4=4a 推 spec 預設）

新增 `server/utils/template-registry.ts`：

```typescript
import type { LineMessage } from '@@/utils/line-push';

export type TemplateCategory = 'order' | 'announcement' | 'bot' | 'broadcast';

export interface PlaceholderDef {
  key: string;                       // {key}
  label: string;                     // admin UI 顯示「下單時間」
  example: string;                   // 預覽時填入「2026-05-15 14:30」
  required: boolean;                 // 缺值時是否警告
}

export interface TemplateMeta {
  templateKey: string;
  category: TemplateCategory;
  displayName: string;               // admin UI 顯示「訂單建立通知」
  description: string;               // 說明文（用途 / 觸發時機）
  placeholders: PlaceholderDef[];    // 該模板支援的變數
  defaultContent: {                  // 還原預設按鈕用
    title: string;
    body: string;
  };
  fallbackI18nKey?: string;          // 模板未啟用時 fallback 的 i18n-message key（沿用 A1 邏輯）
}

export const TEMPLATE_REGISTRY: Record<string, TemplateMeta> = {
  'order.pending': {
    templateKey: 'order.pending',
    category: 'order',
    displayName: '訂單建立通知',
    description: '乘客建單成功瞬間推播。最高頻 push，行銷觸達關鍵點。',
    placeholders: [
      { key: 'date', label: '下單時間', example: '2026-05-15 14:30', required: true },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: true },
      { key: 'vehicle', label: '車型', example: '豪華轎車', required: true },
      { key: 'fare', label: '預估車資', example: '1,800', required: true },
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
    ],
    defaultContent: {
      title: '📝 訂單已建立',
      body: '您的訂單已送出，正在媒合司機，請耐心稍候。\n\n預計搭乘：{date}\n上車地點：{pickup}\n車型：{vehicle}\n預估車資：NT$ {fare}',
    },
    fallbackI18nKey: 'order.pending',
  },
  'order.confirmed': {
    templateKey: 'order.confirmed',
    category: 'order',
    displayName: '司機接單通知',
    description: 'admin / 系統指派司機後推播。',
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'driverName', label: '司機名稱', example: '王先生', required: true },
      { key: 'vehiclePlate', label: '車牌號碼', example: 'ABC-1234', required: false },
    ],
    defaultContent: {
      title: '✅ 司機已接單',
      body: '司機 {driverName} 已接受您的訂單，準備前往接您。\n車牌：{vehiclePlate}',
    },
    fallbackI18nKey: 'order.confirmed',
  },
  // 'order.en_route' / 'order.completed' / 'order.cancelled' — 同結構（Q6=6b 包含）
  // 'bot.follow.passenger' / 'bot.text.passenger' / 'bot.follow.driver' / 'bot.text.driver' — Q6=6c 才加
};

// ── Builder：通用化 A1 buildOrderPendingFlex ───────────────────────

export interface TemplateContent {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: {
    label: string;
    action:
      | { type: 'uri'; url: string }
      | { type: 'message'; text: string }
      | { type: 'postback'; data: string; displayText?: string };
  } | null;
}

export function buildTemplateFlex(
  template: TemplateContent | null,
  params: Record<string, string>,
): LineMessage | null;
// 邏輯沿用 A1 order-pending-flex.ts，差別：
//   - placeholder set 從 params keys 動態決定，不再 hard-coded 5 個
//   - ctaButton.action 三型別分支生成 LINE action object
//   - 缺 title/body 回 null（呼叫端 fallback）

export async function loadTemplate(
  db: Firestore,
  templateKey: string,
): Promise<TemplateContent | null>;
```

**設計重點**：
- Registry 在 server code 寫死，**新增 template key 必須改 code + 部署**（Q4=4a）。這是刻意設計，因為每個 template 的 placeholder set 必須與「呼叫端推送邏輯」對齊（如 `orders/index.post.ts` 對 `order.pending` 傳哪些 params），admin 動態新增 key 沒對應 caller 等於擺著沒用。
- Q4=4b（Firestore 動態 registry）的問題：admin 新增 key 沒推送邏輯呼叫；要 admin 自由發揮 = 公告系統 P37 已經做了。
- 既有 A1 `server/utils/order-pending-flex.ts`：
  - **5b 策略**：保留檔案、改 internal 走通用 builder，外部 export 維持 `loadOrderPendingTemplate / buildOrderPendingFlex` 簽名，內部呼叫 `loadTemplate(db, 'order.pending')` + `buildTemplateFlex(...)`。
  - 之後 P39 改寫 `orders/[orderId].patch.ts` 直接呼通用 builder 不經 A1 wrapper。

## 4. Endpoints

### 4.1 Richmenu CRUD（admin / canBroadcast）

| Method | Path | 用途 |
|---|---|---|
| GET | `/nuxt-api/admin/line-richmenus?channel=passenger\|driver&status=...` | 列表 |
| GET | `/nuxt-api/admin/line-richmenus/[id]` | 單筆詳情 |
| POST | `/nuxt-api/admin/line-richmenus` | 建草稿（body：channel / name / size） |
| PATCH | `/nuxt-api/admin/line-richmenus/[id]` | 編輯（chatBarText / selected / areas / status） |
| DELETE | `/nuxt-api/admin/line-richmenus/[id]` | 刪除（draft / archived 才可；active 必須先 unpublish） |
| POST | `/nuxt-api/admin/line-richmenus/[id]/upload-image` | multipart → Firebase Storage → 寫 imageUrl + size + bytes |
| POST | `/nuxt-api/admin/line-richmenus/[id]/publish` | publish 為 channel default（複合動作：sync LINE + transaction archive 舊 active + 設新 default） |
| POST | `/nuxt-api/admin/line-richmenus/[id]/unpublish` | 取消 default（archive，不刪） |
| POST | `/nuxt-api/admin/line-richmenus/[id]/sync-status` | 主動詢問 LINE 同步狀態（GET LINE richmenu list + 比對本地 lineRichMenuId） |
| POST | `/nuxt-api/admin/line-richmenus/[id]/test-bind` | 把 menu 綁特定 lineUid（admin 測試用）/ body { lineUid: string } |

**publish 流程**：

```typescript
// PATCH .../publish
1. tx begin
2. 確認 menu.imageUrl 已設 + areas 已設 + chatBarText 已設
3. 若 channel 有現存 active menu A：
   - 把 A.status 設 archived（保留 lineRichMenuId 為了 rollback）
4. 把目前 menu.status 設 active、publishedAt = now
5. tx commit
6. （tx 外）呼 LINE API：
   - 若本 menu lineRichMenuId 為 null → POST /richmenu 建立 → POST /content 上傳圖
   - POST /user/all/richmenu/{id} 切預設
7. 成功：syncStatus='synced'；失敗：syncStatus='sync_failed' + syncError
8. audit log: line.richmenu.publish
```

### 4.2 Template CRUD（admin / canBroadcast）

| Method | Path | 用途 |
|---|---|---|
| GET | `/nuxt-api/admin/notification-templates` | 列表（依 registry keys 撈所有 doc，缺值用 default） |
| GET | `/nuxt-api/admin/notification-templates/[key]` | 單筆 |
| PUT | `/nuxt-api/admin/notification-templates/[key]` | upsert（同 A1 PUT 結構，但 templateKey 動態） |
| POST | `/nuxt-api/admin/notification-templates/[key]/upload-cover` | 圖上傳（路徑 `notification-templates/{key}/cover.{ext}`） |
| POST | `/nuxt-api/admin/notification-templates/[key]/reset` | 還原 registry defaultContent + 清 cover/CTA |

**Q5=5b alias**：A1 既有 endpoint `/nuxt-api/admin/settings/notification-templates/order-pending.{get,put}.ts` 內部改 call 新 endpoint logic（共用 handler），確保前端 A1 元件依然能跑、新前端走通用 endpoint。

### 4.3 Bot Replies CRUD（若 Q6=6c）

| Method | Path | 用途 |
|---|---|---|
| GET | `/nuxt-api/admin/bot-replies` | 列 4 個 replyKey |
| PUT | `/nuxt-api/admin/bot-replies/[key]` | upsert（text + enabled） |

`server/utils/line-channel.ts` 內 `_reply()` 呼叫處改成讀 `bot_replies/{client}.{follow|text}` doc；doc.enabled=false 或 doc 不存在 → fallback hard-coded `FOLLOW_MESSAGES` / `TEXT_REPLY_MESSAGES`（向下兼容）。

## 5. LINE Richmenu API Client（`server/utils/line-richmenu.ts`）

```typescript
import { getLineChannel, type LineClient } from '@@/utils/line-channel';

interface RichmenuCreatePayload {
  size: { width: 2500; height: 1686 | 843 };
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: Array<{
    bounds: { x: number; y: number; width: number; height: number };
    action: object;  // 由 builder 組
  }>;
}

const API_BASE = 'https://api.line.me/v2/bot/richmenu';
const DATA_BASE = 'https://api-data.line.me/v2/bot/richmenu';

export async function createRichmenu(
  client: LineClient,
  payload: RichmenuCreatePayload,
): Promise<{ richMenuId: string }>;

export async function uploadRichmenuImage(
  client: LineClient,
  richMenuId: string,
  imageBuffer: Buffer,
  mime: 'image/png' | 'image/jpeg',
): Promise<void>;

export async function setDefaultRichmenu(
  client: LineClient,
  richMenuId: string,
): Promise<void>;

export async function clearDefaultRichmenu(
  client: LineClient,
): Promise<void>;

export async function getDefaultRichmenuId(
  client: LineClient,
): Promise<string | null>;  // 404 → null

export async function listRichmenus(
  client: LineClient,
): Promise<Array<{ richMenuId: string; size: object; name: string; chatBarText: string }>>;

export async function deleteRichmenu(
  client: LineClient,
  richMenuId: string,
): Promise<void>;

export async function linkRichmenuToUser(
  client: LineClient,
  userId: string,
  richMenuId: string,
): Promise<void>;
```

**錯誤處理**：所有 helper 內部 catch + rethrow `LineApiError`（自訂 class，含 `statusCode` / `details`）。endpoint 層處理：4xx 顯示給 admin（如 image format 錯），5xx retry 1 次後寫 syncStatus='sync_failed'。

**Image fetch**：admin 上傳到 Firebase Storage 後，server publish 時用 admin SDK 直接讀 binary（`storage.bucket().file(path).download()`），不走 public URL。

## 6. Admin UI 設計（Q8=8b 推 spec 預設）

### 6.1 路由

新增 `app/pages/admin/line-management/index.vue`，4 tab：

| Tab | 內容 | 顯示條件 |
|---|---|---|
| **Richmenu** | passenger / driver 子 tab → 各自 richmenu list + 編輯器 | Q1 |
| **Flex Templates** | 模板 list（依 registry category 分組）+ 編輯器 | Q4 + Q5 |
| **Bot Replies** | 4 個自動回覆編輯 | 若 Q6=6c |
| **Diagnostics** | webhook event log + LINE API error log + sync status | 若 Q8=8b 含此 |

`/admin/settings` 內 A1 NOTIFICATIONS section（既有）：
- Q5=5b 推 spec 預設：保留 A1 section（仍可從這裡編 order-pending），但加 banner「⇢ 進入 LINE 管理頁編所有模板」link 到新頁
- Q5=5c：移除 A1 section，admin 必須走新頁

### 6.2 Richmenu Tab

```pug
.LineManagement__richmenu
  //- channel 切換（passenger / driver 顏色區分）
  .LineManagement__channel-tabs
    button(:class="{ 'is-active': ch === 'passenger' }" @click="ch = 'passenger'") 乘客 OA
    button(:class="{ 'is-active': ch === 'driver' }" @click="ch = 'driver'") 司機 OA

  //- 該 channel 的 richmenu list
  .LineManagement__richmenu-list
    .LineManagement__richmenu-card(v-for="m in richmenus" :key="m.id")
      .status-badge(:class="`is-${m.status}`") {{ statusLabel[m.status] }}
      .name {{ m.name }}
      .chatBarText {{ m.chatBarText }}
      .sync-status {{ syncStatusLabel[m.syncStatus] }}
      .actions
        button(@click="ClickEdit(m)") 編輯
        button(v-if="m.status === 'draft'" @click="ClickPublish(m)") 發佈為預設
        button(v-if="m.status === 'active'" @click="ClickUnpublish(m)") 取消預設
        button(v-if="m.status !== 'active'" @click="ClickDelete(m)") 刪除

  button.new(@click="ClickNew") + 新增 richmenu
```

**編輯彈窗**（`app/components/open/dialog/line-richmenu/Edit.vue`）：

- **基本資訊**：name / chatBarText / selected（toggle）
- **圖片上傳**：拖放上傳，預覽，顯示寬高 + filesize；換圖前提示「area 座標基於目前圖計算，換圖需重設 area」
- **Area 編輯器**（核心）：
  - 上方 canvas 顯示圖 + overlay grid（2x3 / 3x2 / 自訂）
  - 預設模板：1×1 / 2×2 / 2×3 / 3×2 / 3×3 quick set
  - 每 area：拖拉框選 / 手動輸入 x/y/w/h（百分比 + 像素並存）/ action 設定
  - Action 編輯（依 Q3=三選）：radio 選 uri / message / postback
    - uri：input URL（須 https:// 或 line://）
    - message：input text（max 300）
    - postback：select 從白名單（OPEN_BOOKING / CONTACT_SUPPORT / MY_TRIP / DRIVER_PENDING_LIST / ...）+ optional displayText
  - 拖拉時 snap to grid，避免 sub-pixel
- **預覽**：右側 mock LINE chat UI 顯示 richmenu 縮圖 + chatBarText
- **動作**：儲存草稿 / 儲存並發佈 / 取消

### 6.3 Flex Templates Tab

```pug
.LineManagement__templates
  //- 左側 list（依 registry category 分組）
  aside.LineManagement__template-list
    h3 訂單事件
    button(v-for="t in orderTemplates" :class="{ 'is-active': sel === t.key }" @click="sel = t.key")
      | {{ t.displayName }}
      span.indicator(:class="{ 'is-customized': t.enabled }") ●
    h3 公告
    h3 Bot 自動回覆  //- Q6=6c 才有

  //- 右側編輯器
  main.LineManagement__template-editor
    //- 沿用 A1 NotificationTemplate.vue 結構，差別：
    //- 1) placeholder chip 動態從 registry 來
    //- 2) CTA action 三選（Q7=與 Q3 對齊）
    //- 3) 多一個 enabled toggle（false 時推送走 fallback i18n text）
```

**A1 NotificationTemplate.vue migration 策略**（Q5=5b）：
- A1 元件保留在 `/admin/settings` 內可繼續編 order-pending（向下兼容）
- 新通用元件 `app/components/admin/line-management/TemplateEditor.vue` 不限定 templateKey，依 props 動態決定 placeholder set
- A1 元件 deprecate 注釋，未來 P40 移除

### 6.4 Bot Replies Tab（Q6=6c）

簡單 form：4 個 reply key × { enabled toggle + textarea }。

### 6.5 Diagnostics Tab（Q8=8b 含 + 可選不做）

- LINE Webhook event log（最近 50 筆，按 channel filter）
- LINE API call error log（push fail / multicast fail / richmenu sync fail）
- richmenu sync 狀態總覽（本地 active doc vs LINE actual default ID + 不一致時 highlight）

**資料來源**：需新增 collection `line_event_logs`（webhook handler 每次寫 1 doc，TTL 7d）+ `line_api_errors`（catch 內統一寫）。

## 7. Postback Whitelist（Q3 含 postback）

`server/utils/line-postback-handlers.ts`：

```typescript
export const POSTBACK_WHITELIST: Array<{
  data: string;        // 配對 user 點擊送回的 postback.data
  label: string;       // admin UI 顯示
  channel: LineClient | 'both';
  handler: (event: H3Event, lineUid: string, data: string) => Promise<void>;
}> = [
  {
    data: 'OPEN_BOOKING',
    label: '開啟訂車 LIFF',
    channel: 'passenger',
    handler: async (event, lineUid) => {
      // 回 LIFF URL 訊息給 user
      await sendLinePush('passenger', lineUid, [{
        type: 'text',
        text: `請點此開啟訂車：${liffUrl}`,
      }]);
    },
  },
  // CONTACT_SUPPORT / MY_TRIP / DRIVER_PENDING_LIST / DRIVER_PROFILE / ...
];
```

**Webhook 整合**：`server/utils/line-channel.ts` `handleLineWebhook` 加 `postback` event 分支，查 whitelist → 跑 handler；查不到 → log warn + reply error text。

Admin UI 編 richmenu area action 時，postback option 從 whitelist 撈下拉選單，避免亂打 data。

## 8. 安全 & 權限

- 所有 admin endpoint 套 `hasPermission(auth, 'canBroadcast')`（沿用 A1）
- richmenu publish / unpublish + template PUT + bot reply PUT 全寫 audit log
- audit action 命名規範：
  - `line.richmenu.create` / `line.richmenu.update` / `line.richmenu.publish` / `line.richmenu.unpublish` / `line.richmenu.delete` / `line.richmenu.sync`
  - `line.template.update` / `line.template.reset`
  - `line.bot_reply.update`
- A1 既有 `notification_template.update` 保留 alias（Q5=5b PUT endpoint 內同時寫舊 + 新 action，過渡期）；migrate 完成後 P40 移除舊 action
- Firestore rules: `bot_replies` / `notification_templates` / `line_richmenus` 全 server-only write
- Storage rules:
  - `line-richmenus/{channel}/{id}/image.{ext}`：admin 寫、public read（LINE 需取）
  - `notification-templates/{key}/cover.{ext}`：同上
- Rate limit: richmenu publish 每 admin 每小時 ≤ 5 次（避免燒 LINE quota），template PUT ≤ 30 次（沿用 broadcast.post.ts pattern）

## 9. 部署策略

| Phase | 內容 | Push prod | 風險 |
|---|---|---|---|
| Phase 0 | spec + Brain AI 拍板 | ✅ commit | 0 |
| Phase 1 | richmenu schema + LINE API client + sync logic + endpoints（無 UI） | ✅ 但無入口 | 低（無 UI 觸發點） |
| Phase 2 | richmenu admin UI + image upload + area editor | ✅ | 中（首次推真實 LINE） |
| Phase 3 | template registry + 通用 builder + endpoints；A1 endpoint alias | ✅ | 中（A1 流程不能 break — 內含 e2e 建單測） |
| Phase 4 | template admin UI 統一介面 + A1 migration link | ✅ | 低 |
| Phase 5 | （Q6=6c）bot replies + 公告整合 / Diagnostics | ✅ | 低 |
| Phase 6 | e2e 手測（兩 OA 真實 push + 訂單事件回歸）+ archive | ✅ | 0 |

**回滾策略**：
- Phase 2 失敗：admin UI 撤頁 + DB doc 不刪（可下次 retry）；LINE 端若已有 richmenu push，可手動透過 LINE Console 移除
- Phase 3 失敗（A1 break）：A1 endpoint 內 try/catch fallback 回讀舊 collection `admin_settings_notification_templates/order-pending`，確保 prod 推播不斷

## 10. 開放問題（待 Brain AI 拍板）

> Spec 以「推 spec 預設」展開設計，Brain AI 確認後 spec 凍結 → 進 Phase 1。

### Q1 — Richmenu 單 default vs 多 draft 策略

| 選項 | 描述 | 利 | 弊 |
|---|---|---|---|
| **1a 推 spec 預設**：每 channel 同時 1 個 active + 多個 draft / archived | 維持彈性、有 rollback 路徑 | 複雜度可控 | DB 設計多狀態 |
| 1b 每 channel 同時最多 1 個 doc（覆寫式編輯） | 最簡 | 無 rollback、無預先準備備案 |
| 1c 支援 alias / 分頁切換 | 進階 | 複雜度高、第一版不需要 |

### Q2 — Richmenu 圖片來源

| 選項 | 描述 |
|---|---|
| **2a 推 spec 預設**：admin 上傳成品 PNG/JPEG（設計師外部工具產出） |
| 2b 內建 grid builder + 文字 overlay 自動合成 |

### Q3 — Richmenu area action 範圍

| 選項 | 描述 |
|---|---|
| **3a 推 spec 預設**：uri / message / postback 三選（postback 需 whitelist） |
| 3b 只 uri / message 兩選（最簡，無 webhook handler 負擔） |
| 3c 全選（含 richmenuswitch / datetimepicker / 等） |

### Q4 — Template registry 位置

| 選項 | 描述 | 利 | 弊 |
|---|---|---|---|
| **4a 推 spec 預設**：server code hard-coded（`template-registry.ts`） | placeholder schema 與 caller 強一致 | 新 event 必須 PR + 部署 |
| 4b Firestore 動態 doc（`admin_settings_template_registry`） | admin 可自由新增 key | placeholder 沒對應 caller = 無效 |
| 4c 混合：registry 在 code，placeholder 可 admin 擴 optional 變數 | 折衷 | 邏輯複雜 |

### Q5 — A1 endpoint 處理

| 選項 | 描述 |
|---|---|
| 5a 並存：A1 endpoint 保留不動，新通用 endpoint 並存（不切換） |
| **5b 推 spec 預設**：A1 endpoint 內部 alias 走新通用 logic（向下相容），admin UI 逐步切新介面 |
| 5c 直接 break：移除 A1 endpoint，admin UI 立刻切新 |

### Q6 — Phase 1（含 Phase 3-4）template 範圍

| 選項 | 描述 |
|---|---|
| 6a 最小：只搬 A1（order.pending）進通用編輯器 |
| **6b 推 spec 預設**：A1 + 另 4 個訂單事件（confirmed / en_route / completed / cancelled） |
| 6c 全包：A1 + P39 + bot follow / text reply + 公告 |

### Q7 — CTA action 範圍

| 選項 | 描述 |
|---|---|
| **7a 推 spec 預設**：與 Q3 對齊（uri / message / postback） |
| 7b 只 uri（沿用 A1 既有） |

### Q8 — Admin 入口位置

| 選項 | 描述 |
|---|---|
| 8a `/admin/settings` 加 LINE section（既有頁已 4 section） |
| **8b 推 spec 預設**：新獨立頁 `/admin/line-management` 含 4 tab |
| 8c 拆兩頁 `/admin/line-richmenu` + `/admin/line-templates` |

---

### 其他待 Brain AI 答（implementation 時遇到回頭問）

- ❓ Richmenu 預設圖長相 / 文案 / area config 要不要 spec 內附 mock？或 Phase 2 才設計？建議 Phase 2 設計師另外提
- ❓ Postback whitelist 第一版要含哪些 action？建議 Phase 2 開始時列：
  - passenger：OPEN_BOOKING / OPEN_NOTIFICATIONS / CONTACT_SUPPORT / MY_TRIP
  - driver：OPEN_DASHBOARD / PENDING_LIST / MY_PROFILE / TRIP_GPS
- ❓ Diagnostics tab 是否本 change 內做？建議 Phase 5 視時間決定（可延 P40）
- ❓ Storage 圖片刪除策略：richmenu doc archive / delete 時是否同步清 Storage？建議：archive 不清（rollback 用），delete 才清

## 11. 決策紀錄

> **2026-05-15 Brain AI 拍板：8 個 Q 全用推 spec 預設**（單句指令：「spec 預設」）

### 11.1 Q1 — Richmenu single-active + multi-draft（**1a**）

每 channel 同時最多 1 個 `status=active`，其餘為 `draft` / `archived`。publish 新 active 自動把舊 active 切 archived（transaction 保證原子性）。

**理由**：彈性 + rollback 路徑 + 預先準備備案。複雜度可控（archived 不刪 doc，rollback 只需重新 publish 即可）。

### 11.2 Q2 — Richmenu 圖片來源（**2a**）

admin 上傳成品 PNG/JPEG（≤ 1MB，2500×1686 large 或 2500×843 compact）。**不做** grid builder / 文字 overlay 自動合成。

**理由**：設計師外部工具（Figma / Sketch / Photoshop）產出效果遠優於 server 端合成；第一版工程量 vs 邊際效益不成比例。

### 11.3 Q3 — Richmenu area action 範圍（**3a**）

三選：`uri` / `message` / `postback`。

- `uri`：外連 URL（須 `https://` 或 `line://`）
- `message`：送 user 文字訊息給 OA（max 300 字）
- `postback`：觸發 webhook → server 自訂回應；admin 只能從 whitelist 選（避免亂打 data）

**不做** `richmenuswitch`（alias 分頁切換 → P42）/ `datetimepicker` / `location` / `camera` / `cameraRoll`。

### 11.4 Q4 — Template registry 位置（**4a**）

server code hard-coded（`server/utils/template-registry.ts`）。新 template key 必須改 code + 部署。

**理由**：每個 template 的 placeholder set 必須與「呼叫端推送邏輯」對齊（如 `orders/index.post.ts` 對 `order.pending` 傳哪些 params）。admin 動態新增 key 沒對應 caller = 擺著沒用；要 admin 自由發揮 → 公告系統（P37）已經做了。

### 11.5 Q5 — A1 endpoint 處理（**5b**）

A1 既有 endpoint（`/nuxt-api/admin/settings/notification-templates/order-pending.{get,put}.ts`）內部改 call 新通用 logic（shared handler），對外簽名 100% 維持。同時新增通用 endpoint `/nuxt-api/admin/notification-templates/[key]` 並存。

- A1 endpoint 維持原 collection 讀寫，過渡期同時雙寫新 collection `notification_templates/order.pending`
- 新 endpoint 讀新 collection，缺值 fallback 舊 collection（保證向下相容）
- Phase 3 內含 migration script（讀舊 collection → 寫新 collection），part of one-shot deploy

**理由**：A1 prod 流程（建單 push）絕對不能 break。5b 保留兩條路徑，failure isolation 最佳。

### 11.6 Q6 — Phase 1 template 範圍（**6b**）

A1（`order.pending`）+ P39 另 4 個訂單事件（`order.confirmed` / `order.en_route` / `order.completed` / `order.cancelled`）共 **5 個 templateKey**。

**不含** `bot.follow.*` / `bot.text.*` / `announcement.*` — 留 P40 / 後續 wave。

**Phase 5 對應變更**：bot replies / 公告整合 移除（純剩 diagnostics 可選）。tasks.md Phase 5 範圍收斂。

### 11.7 Q7 — CTA action 範圍（**7a**）

與 Q3 對齊：`uri` / `message` / `postback`。

A1 既有 ctaButton schema `{ label, url }` migrate 成 `{ label, action: { type: 'uri', url } }`（migration script 處理）。

### 11.8 Q8 — Admin 入口位置（**8b**）

新獨立頁 `app/pages/admin/line-management/index.vue`，4 tab：

| Tab | 內容 | 範圍 |
|---|---|---|
| **Richmenu** | passenger / driver 子 tab → 各自 richmenu list + 編輯器 | Phase 1-2 |
| **Flex Templates** | 5 個 order template（依 registry 分組） | Phase 3-4 |
| **Bot Replies** | （Q6=6b 移除） | — |
| **Diagnostics** | webhook event log + LINE API error log + sync status | Phase 5（可選） |

`/admin/settings` 內 A1 NOTIFICATIONS section（既有）保留 + 加 banner link「⇢ 進入 LINE 管理頁編所有模板」。

admin 端 layout / 主導航加 `/admin/line-management` 入口。

