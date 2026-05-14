# HANDOFF — 訂單建立通知模板（Wave 3-A1）

## ✅ 完工狀態（2026-05-14）

| Phase | Commit | 內容 |
|---|---|---|
| Phase 0 | `9ef5929` | openspec spec 三件套（proposal / design / tasks） |
| Phase 1 | `f2a56df` | server util + 2 endpoint + post.ts 套模板 + audit log type |
| Phase 2 | `f2c20e5` | admin UI（表單 + 變數 chip + 預覽 + 圖片上傳） |
| Phase 3 | — | archive openspec change + memory |

## 📦 變動清單

### 新增

- `server/utils/order-pending-flex.ts` — `buildOrderPendingFlex` + `loadOrderPendingTemplate`
- `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts`
- `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts`
- `app/components/admin/SettingsNotificationTemplate.vue`

### 修改

- `server/routes/nuxt-api/orders/index.post.ts` — pending push 改套模板 + fallback i18n text
- `server/utils/audit-log.ts` — 加 `notification_template.update` action / `notification_template` targetType
- `app/protocol/fetch-api/api/admin/index.ts` — 加 `GetOrderPendingTemplate` / `PutOrderPendingTemplate` + `OrderPendingTemplate` interface
- `app/pages/admin/settings/index.vue` — 加 NOTIFICATIONS section

## 🔍 驗收（手測項目，請在 prod 桌機 + 實機驗）

- [ ] admin 桌機開 `/admin/settings` → 看到「通知模板（訂單建立）」section
- [ ] 編輯 title + body，點變數 chip 插入 placeholder
- [ ] 上傳 cover 圖片 → 右側預覽即時顯示
- [ ] 填 ctaButton label + url → 預覽 footer 出現按鈕
- [ ] 點儲存 → 看到「已儲存」訊息，重整頁面值 persist
- [ ] 乘客端新訂單 → LINE OA 收 Flex 卡（含 cover + CTA）
- [ ] Firebase Console 砍 doc / 清空 title → 乘客新訂單 → 仍收到舊版 i18n text（fallback 生效）
- [ ] assistant level 無 canBroadcast → endpoint 回 403（看不到資料 / 不能編輯）
- [ ] audit_logs 寫入 `notification_template.update`

## ⚠️ 留尾（**非** Wave 3-A1 範圍）

- **P39（未開）**：其他 4 個訂單事件模板化（confirmed / en_route / completed / cancelled）
- 模板三語編輯介面 — 第一版只支援繁中（fallback 路徑保留 P37 三語 text）
- 模板版本歷史 / A/B test split — 不做
- richmenu = Wave 4 範圍

## 🧠 重要決策（已凍）

1. **Firestore path 用單獨 collection**：`admin_settings_notification_templates/{eventKey}`（不用 sub-collection 避免 path 嵌套深；未來加事件直接新增 doc）
2. **三語策略**：模板只存繁中；fallback 路徑（doc 不存在）才依 `users.lang` 走 P37 i18n-message 三語 text
3. **cover 不支援 placeholder**：純靜態圖（admin 上傳到 Storage），避免誤填 placeholder 導致 404
4. **CTA URL 支援 placeholder**：常見 case `https://example.com/orders/{orderId}`
5. **圖片上傳沿用 announcement upload-cover endpoint**：路徑歸到 `announcements/{adminLineUid}/cover-{ts}.{ext}`，避免重建 endpoint
6. **fallback 設計**：template 缺失（doc 不存在 / title 或 body 為空）→ builder 回 null → 呼叫端 fallback；確保模板未設定時 prod 行為與既有完全一致
7. **權限**：canBroadcast（admin / assistant 預設都有，super 自動有）

## 📝 commit chain

```
9ef5929 docs(Wave3-A1 Phase 0): openspec spec 三件套 — 訂單建立通知模板
f2a56df feat(Wave3-A1 Phase 1): 訂單建立通知模板 server 端
f2c20e5 feat(Wave3-A1 Phase 2): 訂單建立通知模板 admin UI
{Phase 3 commit hash}  chore(Wave3-A1): archive openspec change
```

Base：`7b92d6e`（Wave 2 P4 收尾 commit）
