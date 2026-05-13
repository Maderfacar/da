# Design — 乘客端發佈消息（Passenger Announcements）

## 1. Firestore Schema

### 1.1 `announcements/{announcementId}` — 公告主檔

```typescript
{
  // 識別
  id: string;                    // doc id（auto-id）
  status: 'draft' | 'published' | 'archived';

  // 內容（L1 rich content）
  title: string;                 // 必填，max 60 字
  body: string;                  // 必填，max 1000 字（TinyEditor HTML，需 sanitize）
  coverImageUrl: string | null;  // Firebase Storage URL，optional，1024×1024 jpg/png/gif < 10MB
  ctaButton: {
    label: string;               // max 20 字
    url: string;                 // 必須 https:// 開頭
  } | null;

  // 目標分群（Q2 + 解耦 b）
  targetType: 'all' | 'passenger' | 'driver' | 'order';
  targetOrderId: string | null;  // 當 targetType='order' 才有值
  channels: {
    line: boolean;               // ☐ 推 LINE OA
    inApp: boolean;              // ☐ 顯示 App 內列表
  };

  // 後設
  createdBy: string;             // admin lineUid
  createdAt: Timestamp;
  publishedAt: Timestamp | null; // status='published' 時設值
  archivedAt: Timestamp | null;

  // 推播統計
  pushStats: {
    targetCount: number;         // 計算當下目標人數
    sentCount: number;           // 實際推送成功數
    failedCount: number;
  } | null;
}
```

### 1.2 `announcement_reads/{lineUid}/items/{announcementId}` — 已讀狀態

```typescript
{
  announcementId: string;
  readAt: Timestamp;
}
```

**為什麼用 sub-collection 而不是 announcement 內 `readBy: lineUid[]` 陣列**：
- 陣列方案：announcement 100 人讀 = 100 元素，updateDoc 競爭高、Firestore 1MB 上限風險
- Sub-collection：每位使用者一個 doc，independent write、無上限、未讀計數可用 collection-group query

### 1.3 既有 collection 不動

- `users` / `orders` / `drivers` / `admins` 無 schema 變動

## 2. Endpoints 設計

### 2.1 Admin endpoints（全套 `canBroadcast` 權限 + audit log）

| Method | Path | 用途 |
|---|---|---|
| GET    | `/nuxt-api/admin/announcements` | 列表（query: `status=draft|published|archived`，分頁） |
| GET    | `/nuxt-api/admin/announcements/[id]` | 單筆詳情 |
| POST   | `/nuxt-api/admin/announcements` | 建立草稿 |
| PATCH  | `/nuxt-api/admin/announcements/[id]` | 編輯 / 變更 status（含 publish / archive） |
| DELETE | `/nuxt-api/admin/announcements/[id]` | 刪除（純 draft / archived 才可，published 只能 archive） |
| POST   | `/nuxt-api/admin/announcements/upload-cover` | 圖片上傳 Firebase Storage，回傳 url |

**publish 觸發 LINE 推送邏輯**（在 PATCH endpoint 當 status 從 `draft` → `published` 時）：
1. 撈 target 群（依 `targetType`）
2. 若 `channels.line === true`，依群 push（text or Flex）
3. 寫 `pushStats`
4. 寫 audit log `announcement.publish`
5. 套用 rate-limit 10/hr/admin（沿用 broadcast.post.ts 模式）

### 2.2 Passenger endpoints

| Method | Path | 用途 |
|---|---|---|
| GET  | `/nuxt-api/passenger/announcements` | 列出乘客可見的 published announcement（依 roles + targetUserId 過濾），分頁，含 `isRead` 欄位 |
| GET  | `/nuxt-api/passenger/announcements/[id]` | 單筆（順帶寫 announcement_reads） |
| GET  | `/nuxt-api/passenger/announcements/unread-count` | 未讀數（drawer 紅點用），cache 30s |

### 2.3 訂單事件推送（Q2 a）

在 [orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) 既有 status 切換區塊內 inline 加 `sendLinePush('passenger', orderOwnerLineUid, ...)`，不開新 endpoint。

5 個觸發點：

| status 變化 | 推送內容（繁中為例，需三語） |
|---|---|
| `pending → confirmed` | ✅ 訂單已確認\n司機已接單，準備出發前往接您。 |
| `confirmed → en_route` | 🚗 司機已出發\n預計 N 分鐘後抵達上車點。 |
| `en_route → arrived_pickup` | 📍 司機已抵達\n請至上車地點上車。 |
| `* → completed` | 🎉 行程已完成\n感謝您搭乘 Destination Anywhere！ |
| `* → cancelled` | ⚠️ 訂單已取消\n{cancelReason ? '原因：${cancelReason}\\n' : ''}如需協助請聯絡客服。 |

**i18n**：依 `users/{lineUid}.lang` 取乘客偏好語系（zh / en / ja），fallback zh。新增 `server/utils/i18n-message.ts` helper 維護三語訊息表（首版只做這 5 個 status）。

### 2.4 Admin 手動推單筆（Q2 b）

**檔案**：[admin/orders/[orderId]/notify.post.ts](server/routes/nuxt-api/admin/orders/[orderId]/notify.post.ts) 已存在，目前推給 driver。擴充加 query param `target=passenger|driver`，預設 driver 維持既有行為。

訂單詳情頁 [admin/orders/[orderId]](app/pages/admin/orders/[orderId].vue) 加「通知乘客」按鈕，開彈窗 → 填訊息 → POST 上述 endpoint with `target=passenger`。

## 3. LINE Flex Message L1 規格

```typescript
{
  type: 'flex',
  altText: title,  // 通知欄顯示用，max 400 字
  contents: {
    type: 'bubble',
    hero: coverImageUrl ? {
      type: 'image',
      url: coverImageUrl,
      size: 'full',
      aspectRatio: '20:13',  // 適合公告 horizontal banner
      aspectMode: 'cover',
    } : undefined,
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: body.replace(/<[^>]+>/g, '').slice(0, 200), wrap: true, size: 'sm', color: '#666666', margin: 'md' },
      ],
    },
    footer: ctaButton ? {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        action: { type: 'uri', label: ctaButton.label, uri: ctaButton.url },
        style: 'primary',
        color: '#D4860A',  // amber，對齊 site theme
      }],
    } : undefined,
  },
}
```

**注意事項**：
- LINE Flex body 只能放純文字，TinyEditor HTML 要 strip tag + 限 200 字 preview
- App 內顯示時可保留 HTML（sanitize 過 — 用 DOMPurify）
- coverImageUrl 必須 HTTPS + LINE 可訪問（Firebase Storage public read OK）

## 4. Layout 改造

### 4.1 Drawer 結構

```pug
.LayoutFrontDesk
  //- 頂部 nav（簡化）
  nav.LayoutFrontDesk__top
    .LayoutFrontDesk__logo  //- 左 logo
    .LayoutFrontDesk__title //- 中 頁面標題（由 route meta 傳入）
    .LayoutFrontDesk__right
      LangSwitcher
      button(@click="drawerOpen = true") //- hamburger icon

  //- 左側抽屜（teleport to body，slide-in）
  Teleport(to="body")
    transition(name="drawer")
      .LayoutFrontDesk__drawer-mask(v-if="drawerOpen" @click="drawerOpen = false")
    transition(name="drawer-slide")
      .LayoutFrontDesk__drawer(v-if="drawerOpen")
        .LayoutFrontDesk__drawer-user
          img(:src="lineProfile.pictureUrl")
          .name {{ lineProfile.displayName }}
        nav.LayoutFrontDesk__drawer-nav
          NuxtLink(to="/home") 首頁
          NuxtLink(to="/booking") 訂車
          NuxtLink(to="/upcoming") 我的行程
          NuxtLink(to="/orders") 訂單
          NuxtLink(to="/fleet") 車隊
          NuxtLink(to="/notifications")
            | 最新消息
            span.badge(v-if="unreadCount > 0") {{ unreadCount }}
          NuxtLink(to="/profile") 個人設定
        .LayoutFrontDesk__drawer-bottom
          button(@click="ClickSignOut") 登出
          a(:href="lineOaAddUrl") 客服

  //- 主內容（無底部 tab，padding-bottom 砍掉）
  main.LayoutFrontDesk__body
    slot
```

### 4.2 桌機 vs 手機

| 螢幕 | 行為 |
|---|---|
| 手機 < 768px | hamburger 觸發 drawer slide-in 280px |
| 桌機 ≥ 768px | drawer 預設**收合**（仍 hamburger 觸發），保持 mobile-first 一致體感；不做 sticky 側欄（避免桌機 layout 跟手機差太多增加測試負擔） |

**為什麼桌機也 hamburger**：本專案以 LIFF 手機為主要場景，桌機進來機率低；維持單一 layout 邏輯。

### 4.3 主 CTA「訂車」

底部 tab 移除後「訂車」失去主入口，補救：
- home hero 區塊保留大尺寸「立即訂車」CTA 按鈕（已存在，加強）
- 頂部 nav 右側在非 booking 頁時顯示 mini「+ 訂車」浮鈕（手機友善）

## 5. 已讀狀態 + 未讀計數

### 5.1 已讀寫入時機

`GET /nuxt-api/passenger/announcements/[id]` 內部同時寫 `announcement_reads/{lineUid}/items/{announcementId}` doc（idempotent，已寫過再寫不影響）

### 5.2 未讀計數查詢

`GET /nuxt-api/passenger/announcements/unread-count`：
1. 撈 `announcements` 中 `status='published'` 且乘客可見的 id 集合（A）
2. 撈 `announcement_reads/{lineUid}/items` 中所有 id（B）
3. 回傳 |A − B|
4. 30s server-side cache（用 Firestore Timestamp 不太需要，但 LIFF webview 場景值得加）

### 5.3 紅點 polling

drawer 內 /notifications 入口的紅點：
- layout 內 30s setInterval call unread-count（沿用 orders 端 polling 模式）
- onUnmounted 清 timer
- visibility 切回時 refresh

## 6. 圖片上傳

- 用 Firebase Storage `announcements/{announcementId}/cover.{ext}` 路徑
- admin endpoint `/nuxt-api/admin/announcements/upload-cover` 接 multipart/form-data
- 驗證：mime in ['image/jpeg', 'image/png', 'image/gif']、size < 10MB、寬高 < 2048px
- Storage rule：admin 才可寫 announcements/，public read
- 編輯草稿時上傳的圖：先存 temp/{adminLineUid}/{timestamp}.{ext}，published 才搬正式路徑

## 7. 三語訊息（i18n-message helper）

新增 `server/utils/i18n-message.ts`：

```typescript
type MessageKey = 'order.confirmed' | 'order.en_route' | 'order.arrived_pickup' | 'order.completed' | 'order.cancelled';

const MESSAGES: Record<MessageKey, Record<'zh_tw' | 'en' | 'ja', (params?: Record<string, string>) => string>> = {
  'order.confirmed': {
    zh_tw: () => '✅ 訂單已確認\n司機已接單，準備出發前往接您。',
    en: () => '✅ Order confirmed\nYour driver has accepted and will be on the way.',
    ja: () => '✅ ご注文確定\nドライバーが受注し、間もなく出発します。',
  },
  // ...
};

export function getOrderMessage(key: MessageKey, lang: 'zh_tw' | 'en' | 'ja' = 'zh_tw', params?: Record<string, string>): string {
  return MESSAGES[key][lang](params);
}
```

讀使用者偏好語系：[users/{lineUid}.lang](server/routes/nuxt-api/auth/line-exchange.post.ts)（既有欄位）；缺值 fallback 'zh_tw'。

## 8. 決策紀錄

### 8.1 為什麼 sub-collection 而非 readBy 陣列

寫頻次高（每位使用者開一篇就 write）+ 預期單篇可達數千讀者 → 陣列方案會踩 Firestore 1MB doc 限制 + 高 contention。Sub-collection 是 Firestore 公告/通知系統的 canonical pattern。

### 8.2 為什麼 i18n 訊息走 server 而非 client

訂單事件推 LINE 是 server-side 觸發（在 PATCH endpoint 內），無 client i18n 可用。維護一份 server 版三語訊息表，與 client `i18n/locales/*.js` 分離但對齊（透過命名規則 `order.confirmed` 等）。

### 8.3 為什麼 admin 編輯器用 TinyEditor 而非自製

`.claude/knowledge/frontend-conventions.md` 已記載 TinyEditor 是本專案標準富文本編輯器；自製 contenteditable 無 i18n / 圖片 / 連結維護成本太高。L1 用得到的功能（粗體 / 斜體 / 連結 / 列表）TinyEditor 預設足夠。

### 8.4 為什麼 channels.line 與 channels.inApp 兩個獨立 checkbox（Q4 b）

User 明確選擇。實作上極簡：DB 多兩個 boolean 欄位 + UI 多兩個 checkbox + publish 邏輯依 channels.line 決定要不要走 sendLinePush、依 channels.inApp 決定要不要列入 passenger 列表查詢結果。

### 8.5 為什麼 layout 桌機也 hamburger

LIFF 場景手機 > 95%，避免桌機獨立 layout 增加 surface 維護面積。drawer 280px 在桌機展開仍佔比合理（1440 寬螢幕 < 20%）。

## 9. 開放問題（implementation 時若遇到再回頭問）

- ❓ Flex Message 在 LINE OA 推送失敗時是否 fallback 成 text？→ 預設 fallback（altText 已備）
- ❓ archived announcement 是否還在 App 內列表顯示？→ 不顯示，只 admin 看
- ❓ announcement 是否要支援編輯後重推？→ 第一版不做，published 後只能 archive 不能 republish
- ❓ 訂單事件推 5 個區塊都加會不會洗版？→ 5 個關鍵節點實際時間跨度大（從接單到完成至少幾十分鐘），不會洗版
