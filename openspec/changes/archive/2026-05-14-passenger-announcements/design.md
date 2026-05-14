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

5 個觸發點（**Brain AI 拍板：移除 arrived_pickup、新增 pending**）：

| 觸發時機 | 寫入檔案 | 推送內容（繁中為例，需三語） |
|---|---|---|
| **訂單建立**（status=pending） | [orders/index.post.ts](server/routes/nuxt-api/orders/index.post.ts) Firestore write 後 | 📝 訂單已建立\n您的訂單已送出，正在媒合司機，請耐心稍候。 |
| `* → confirmed`（已確認） | [orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) status 切換區塊 | ✅ 司機已接單\n司機已接受您的訂單，準備前往接您。 |
| `* → en_route` | 同上 | 🚗 司機已出發\n司機正在前往上車點，請至約定地點等候。 |
| `* → completed` | 同上 | 🎉 行程已完成\n感謝您搭乘 Destination Anywhere！期待再次為您服務。 |
| `* → cancelled` | 同上 | ⚠️ 訂單已取消\n{cancelReason ? '原因：${cancelReason}\\n' : ''}如需協助請聯絡客服。 |

**移除原因**：
- ~~`en_route → arrived_pickup`~~：乘客通常已在現場等候，多一條 LINE 訊息反而干擾；司機端會看到 status 切換、有需要可直接撥電話聯繫（P36 已實作真實電話撥號）

**i18n**：依 `users/{lineUid}.lang` 取乘客偏好語系（zh / en / ja），fallback zh。新增 `server/utils/i18n-message.ts` helper 維護三語訊息表（首版只做這 5 個 trigger）。

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
    .LayoutFrontDesk__logo(@click="navigateTo('/home')") //- 左 logo（點擊回首頁）
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
        //- Brain AI 拍板順序（2026-05-14）：最新消息為主軸放最上
        nav.LayoutFrontDesk__drawer-nav
          NuxtLink(to="/notifications")
            | 最新消息
            span.badge(v-if="unreadCount > 0") {{ unreadCount }}
          NuxtLink(to="/booking") 訂車
          NuxtLink(to="/upcoming") 我的行程
          NuxtLink(to="/orders") 歷史訂單
          NuxtLink(to="/fleet") 車型介紹
          NuxtLink(to="/profile") 個人設定
          a(:href="lineOaAddUrl" target="_blank") 客服
        .LayoutFrontDesk__drawer-bottom
          //- 不放登出（沿用乘客端無登出政策 commit 473ada0）
          .version v{{ appVersion }}

  //- 主內容（無底部 tab，padding-bottom 砍掉）
  main.LayoutFrontDesk__body
    slot
```

**頁面 label 對映**（route 不變，只改 menu 文字）：

| Route | 舊 menu | 新 menu |
|---|---|---|
| `/notifications` | （無） | **最新消息**（本次新增）|
| `/booking` | 訂車 | 訂車 |
| `/upcoming` | 我的行程 | 我的行程 |
| `/orders` | 訂單 | **歷史訂單**（重命名）|
| `/fleet` | 車隊 | **車型介紹**（重命名）|
| `/profile` | （無對應 tab） | 個人設定 |
| 外連 LINE OA | （banner only） | 客服 |
| `/home` | 首頁（tab） | （logo 點擊，不放 menu） |

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

### 8.6 為什麼 announcement status 可循環流轉（Brain AI 拍板）

**決議**：draft ↔ published ↔ archived 任意流轉；published / archived 都可編輯與刪除；archived 可重新發佈（重發會再推 LINE，admin 須有意識）。

**理由**：
- 活動公告有重複性（節慶 / 月度活動），允許重發避免每次都重建一篇
- archived 不等於刪除，是「暫時收起」的概念
- 編輯彈性給 admin 改錯字 / 補圖
- 但編輯 published 不重推 LINE，避免騷擾使用者（重推必須走 archived → published 路徑，admin 有意識）

**LINE push 觸發點精確定義**：
- ✅ 觸發：`status: draft → published`
- ✅ 觸發：`status: archived → published`（重發）
- ❌ 不觸發：`status: published → published`（純編輯內容）
- ❌ 不觸發：`status: * → archived`（下架）
- ❌ 不觸發：`status: * → draft`（收回草稿）

App 內列表顯示規則：
- 草稿（draft）：不顯示
- 已發佈（published）：顯示
- 已下架（archived）：**不顯示**（已讀過的使用者也看不到）

### 8.7 為什麼移除 arrived_pickup 推播（Brain AI 拍板）

乘客在出發前已知司機資訊 + 預計抵達時間，且通常已在現場等候。司機抵達時：
- in-app 訂單狀態會顯示 arrived_pickup（推流式更新）
- 司機可直接撥電話（P36 真實電話撥號已實作）

多一條 LINE 訊息反而干擾現場上車情境。

## 9. 開放問題（implementation 時若遇到再回頭問）

- ❓ Flex Message 在 LINE OA 推送失敗時是否 fallback 成 text？→ 預設 fallback（altText 已備）
- ✅ archived announcement 是否還在 App 內列表顯示？→ **不顯示，只 admin 看**（§8.6 確認）
- ✅ announcement 是否要支援編輯後重推？→ **archived 可重發、編輯 published 不重推**（§8.6 確認）
- ❓ 訂單事件推 4 個 status change + 1 個 create 會不會洗版？→ 5 個關鍵節點實際時間跨度大（從建單到完成至少幾十分鐘），不會洗版
