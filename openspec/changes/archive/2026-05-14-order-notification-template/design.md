# Design — 訂單建立通知模板（Wave 3-A1）

## 1. Firestore Schema

### 1.1 `admin_settings/notification-templates/order-pending` — 訂單建立通知模板

**Path 固定**：collection `admin_settings` / doc `notification-templates` / sub-collection 不適用 — 改為**單一 doc path**：

```
admin_settings/{templateKey}
```

其中 `{templateKey}` 為 `notification-templates_order-pending`（**斜線在 doc id 不合法**，用底線分隔），或者更乾淨的方式：

```
admin_settings_notification_templates/{eventKey}    ← 單獨 collection
```

**Brain AI 拍板採用後者**（單獨 collection，未來 P39 加其他事件直接新增 doc，路徑乾淨）：

```
admin_settings_notification_templates/order-pending
```

```typescript
{
  // 內容
  title: string;                 // 必填，max 60 字，with placeholder
  body: string;                  // 必填，max 1000 字，with placeholder
  coverImageUrl: string | null;  // Firebase Storage URL（HTTPS），1024×1024 jpg/png/gif < 10MB
  ctaButton: {
    label: string;               // max 20 字
    url: string;                 // https://，支援 placeholder
  } | null;

  // 後設
  updatedBy: string;             // admin lineUid（去 'line:' prefix）
  updatedAt: Timestamp;
}
```

**Placeholder 列表**（5 個 + 替換規則）：

| Placeholder | 範例值 | 來源 |
|---|---|---|
| `{date}` | `2026-05-15 14:30` | `body.pickupDateTime.slice(0,16).replace('T', ' ')` |
| `{pickup}` | `桃園機場第一航廈` | `body.pickupLocation.address` |
| `{vehicle}` | `豪華轎車` | `vehicle.label.zh` |
| `{fare}` | `1,800` | `estimatedFare.toLocaleString()` |
| `{orderId}` | `ABCD1234` | `orderId.slice(0,8).toUpperCase()` |

**替換規則**：global string replace，未匹配的 placeholder 維持原樣（讓 admin 看得到有錯）；不做嚴格 schema 驗證（pragmatic）。

### 1.2 Firestore Rules

```javascript
match /admin_settings_notification_templates/{eventKey} {
  // 讀：所有 admin（任何 level）皆可讀
  // 寫：需 canBroadcast 權限（server 端 endpoint 驗，client SDK 不寫此 collection）
  allow read: if request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
  allow write: if false;  // 強制走 server endpoint（含 audit log）
}
```

### 1.3 Composite Index

**不需要**。單一 doc query by ID，無 where/orderBy 組合。

## 2. Server

### 2.1 `server/utils/order-pending-flex.ts`

```typescript
import type { LineMessage } from '@@/utils/line-push';

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

const MAX_ALT_TEXT = 400;
const MAX_LABEL = 20;

const _applyPlaceholders = (text: string, params: OrderPendingParams): string =>
  text
    .replaceAll('{date}', params.date)
    .replaceAll('{pickup}', params.pickup)
    .replaceAll('{vehicle}', params.vehicle)
    .replaceAll('{fare}', params.fare)
    .replaceAll('{orderId}', params.orderId);

export function buildOrderPendingFlex(
  template: OrderPendingTemplate | null,
  params: OrderPendingParams,
): LineMessage | null {
  if (!template || !template.title || !template.body) return null;

  const title = _applyPlaceholders(template.title, params);
  const body = _applyPlaceholders(template.body, params);
  const altText = title.slice(0, MAX_ALT_TEXT);

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true, color: '#222222' },
        { type: 'text', text: body, wrap: true, size: 'sm', color: '#666666', margin: 'md' },
      ],
    },
  };

  if (template.coverImageUrl && template.coverImageUrl.startsWith('https://')) {
    bubble.hero = {
      type: 'image',
      url: template.coverImageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  if (template.ctaButton && template.ctaButton.label && template.ctaButton.url.startsWith('https://')) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        action: {
          type: 'uri',
          label: template.ctaButton.label.slice(0, MAX_LABEL),
          uri: _applyPlaceholders(template.ctaButton.url, params),
        },
        style: 'primary',
        color: '#D4860A',
      }],
    };
  }

  return { type: 'flex', altText, contents: bubble };
}

/** 讀 Firestore admin_settings_notification_templates/order-pending；不存在或失敗回 null */
export async function loadOrderPendingTemplate(
  db: FirebaseFirestore.Firestore,
): Promise<OrderPendingTemplate | null> {
  try {
    const snap = await db
      .collection('admin_settings_notification_templates')
      .doc('order-pending')
      .get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data?.title || !data?.body) return null;
    return {
      title: String(data.title),
      body: String(data.body),
      coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
      ctaButton: data.ctaButton && data.ctaButton.label && data.ctaButton.url
        ? { label: String(data.ctaButton.label), url: String(data.ctaButton.url) }
        : null,
    };
  } catch (err) {
    console.error('[order-pending-flex] load failed:', err);
    return null;
  }
}
```

### 2.2 Admin Endpoints

#### 2.2.1 `GET /nuxt-api/admin/settings/notification-templates/order-pending`

```typescript
// server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts
- 驗 auth + hasPermission(auth, 'canBroadcast')
- 讀 Firestore doc
- 不存在 → 回 successResponse(null)；前端拿 null 顯示「使用預設文案 fallback」
```

#### 2.2.2 `PUT /nuxt-api/admin/settings/notification-templates/order-pending`

```typescript
// server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts
- 驗 auth + hasPermission(auth, 'canBroadcast')
- body validation：
  - title: string, 1 <= length <= 60
  - body: string, 1 <= length <= 1000
  - coverImageUrl: null | string (https://... 開頭)
  - ctaButton: null | { label: 1..20, url: https://... }
- Firestore set({ ...body, updatedBy: lineUid, updatedAt: serverTimestamp() }, { merge: true })
- audit log: writeAuditLog({ action: 'notification_template.update', targetType: 'notification_template', targetId: 'order-pending', payload: body })
- 回 successResponse({ ok: true })
```

### 2.3 orders/index.post.ts 整合

替換既有 push 段（line 192-218 區塊）：

```typescript
if (lineUserId) {
  const params = {
    date: body.pickupDateTime.replace('T', ' ').slice(0, 16),
    pickup: body.pickupLocation.address,
    vehicle: vehicle.label.zh || body.vehicleType,
    fare: estimatedFare.toLocaleString(),
    orderId: orderId.slice(0, 8).toUpperCase(),
  };

  void (async () => {
    try {
      const template = await loadOrderPendingTemplate(db);
      const flex = buildOrderPendingFlex(template, params);
      if (flex) {
        await sendLinePush('passenger', lineUserId, [flex]);
      } else {
        // Fallback：模板未設定 → 退回 P37 既有 i18n text（不 break）
        const lang = await getUserLang(db, lineUserId);
        const text = getOrderMessage('order.pending', lang, params);
        await sendLinePush('passenger', lineUserId, [{ type: 'text', text }]);
      }
    } catch (err) {
      console.error('[orders/post] pending push failed:', err);
    }
  })();
}
```

## 3. Admin UI

### 3.1 表單結構

放在 `/admin/settings` 既有 Fleet section 之後、系統設定（只讀）之前，命名 `.PageAdminSettings__section`：

```pug
.PageAdminSettings__section
  .PageAdminSettings__section-head
    span.PageAdminSettings__section-label NOTIFICATIONS
    span.PageAdminSettings__section-title 通知模板（訂單建立）
  AdminSettingsNotificationTemplate
```

抽元件 `app/components/admin/settings/NotificationTemplate.vue`（沿用 fleet 子元件目錄結構）。

### 3.2 元件內容

- **變數提示 chip 列**：5 個 chip（`{date}` 等），點擊 insert 到 focus input 的 cursor 位置
- **欄位**：
  - title（textarea, 1 row, maxlength 60, 字數計）
  - body（textarea, 6 rows, maxlength 1000, 字數計）
  - coverImageUrl（圖片上傳 — 沿用 P37 announcement 圖片上傳 endpoint `nuxt-api/file/announcement-cover`；顯示預覽 + 移除按鈕）
  - ctaButton.label（input, maxlength 20）
  - ctaButton.url（input, placeholder `https://...`）
- **動作**：儲存（PUT）/ 還原預設（清掉 cover/CTA，title/body 填繁中預設文案 `📝 訂單已建立` / `您的訂單已送出，正在媒合司機。`）

### 3.3 LINE Flex 即時預覽

右側放 mockup 卡：

```pug
.NotificationTemplate__preview
  .NotificationTemplate__preview-card
    img.NotificationTemplate__preview-hero(v-if="form.coverImageUrl" :src="form.coverImageUrl")
    .NotificationTemplate__preview-body
      .NotificationTemplate__preview-title {{ previewTitle }}
      .NotificationTemplate__preview-text {{ previewBody }}
    button.NotificationTemplate__preview-cta(v-if="form.ctaButton?.label")
      | {{ form.ctaButton.label }}
```

預覽 placeholder 用範例值：`{date}` → `2026-05-15 14:30`、`{pickup}` → `桃園機場第一航廈` 等（讓 admin 看到實際渲染樣子）。

## 4. 變數注入詳解

### 4.1 替換策略

- `replaceAll` 全域替換，**不**做 escape（純文字 + button URL，無 HTML 注入風險）
- 缺值 fallback：每個 placeholder 在呼叫 `orders/index.post.ts` 都有值（必填欄位），不會 undefined
- URL placeholder（ctaButton.url）替換後仍須 https:// 開頭，否則 Flex builder skip ctaButton

### 4.2 cover 不支援 placeholder

cover 為靜態圖片 URL（admin 上傳到 Firebase Storage），不做變數替換 — 簡化邏輯 + 避免 admin 誤填 placeholder 導致圖片 404。

## 5. 三語策略

- 模板**只存繁中**：admin 編輯時看到繁中 placeholder，預設文案也是繁中
- LINE 推播時不依 `users.lang` 切換 — 全部使用者收到同一張繁中 Flex 卡
- **理由**：
  - 訂單建立通知是「行銷觸達」優先（cover + CTA 行銷導向），非單純資訊傳遞
  - admin 不會想維護三套模板（管理成本爆炸）
  - en / ja 使用者大多看得懂繁中 emoji + 短句；如真要支援，P39 再開
- fallback path（template doc 不存在）才依 `users.lang` 用 P37 i18n-message 三語 text — 保持向下兼容

## 6. 部署計劃

| Phase | 內容 | Push prod | 風險 |
|---|---|---|---|
| **Phase 0** | spec 三件套（本檔 + proposal.md + tasks.md） | ✅ | 0 |
| **Phase 1** | server util + 2 endpoint + post.ts 改套模板 + fallback 邏輯 | ✅ | Low — fallback 確保模板缺失時行為與既有完全一致；既無模板 doc 時 prod 推播仍走 i18n text |
| **Phase 2** | admin UI + 圖片上傳 + Flex 預覽 | ✅ | Low — 純新增 section，不動既有 admin 流程 |
| **Phase 3** | 手測 + archive openspec change | ✅ | 0 |

每 Phase 收尾後 commit + push origin HEAD:main，Vercel 自動部署，下個 Phase 可基於 prod 狀態繼續。

## 7. 驗收標準

- [ ] admin 在 /admin/settings 看得到「通知模板（訂單建立）」section
- [ ] 編輯 title / body / cover / CTA + 儲存，PUT 200，Firestore doc 寫入正確
- [ ] 變數 chip 點擊插入 placeholder
- [ ] Flex 預覽即時反映表單
- [ ] 乘客建立新訂單後，LINE OA 收到 Flex 卡（含 cover + CTA）
- [ ] 清空模板（Firestore 刪 doc 或 admin 刪 title/body）後，建立新訂單仍收到舊版 i18n text（fallback 生效）
- [ ] audit log 寫入 `notification_template.update`
- [ ] 無 canBroadcast 權限的 admin 不能編輯（403）
- [ ] pnpm lint + pnpm build 通過每個 phase
