# LINE Template Expansion — 自動訊息整合進 admin 編輯（2026-05-23）

> 把所有「business-critical 自動發送 LINE 訊息」整合進 `/admin/line-management?tab=templates`，admin 可直接編輯文案，不必改 code + 部署。
> Brain AI（架構師）與 Claude（Execution AI）多輪討論後 2026-05-23 拍板。

## Why

目前 LINE 自動訊息分散在三個地方維護：

1. **template-registry**（5 個 order Flex 模板，admin 可編）— `/admin/line-management?tab=templates`
2. **bot_replies collection**（2 個 webhook reply 文字，admin 可編）— `/admin/line-management?tab=bot-replies`
3. **hardcoded 在 server code**（21 個事件）— 改文案要工程師動 code + 部署

問題：

- **改文案頻率高**：dispatch / driver-notify / softmatch 是司機體驗第一線，文字需要持續打磨（emoji、語氣、CTA 文字）
- **多語系不對等**：訂單事件已模板化三語（passenger），但派發/配對的 Flex 還是 hardcoded 繁中
- **i18n-message.ts + template-registry 雙路徑冗餘**：每個觸發點要寫「load → buildFlex → fallback to i18n text」雙路徑、yaml 三語要同步維護
- **F8 公告 / F9 推薦分享卡**已分別在 `/admin/notifications` / `/admin/referral` 編輯，**這次不動**

一句話：**讓 admin 在單一頁面（`/admin/line-management`）能編輯所有 business-critical 自動訊息文案，並能在列表直觀分辨手動/自動、Flex/文字、單語/多語**。

## What Changes

### 範圍（12 個新模板 + 既有 7 個整合進 category UI）

| 觸發事件 | 對象 | 輸出 | 多語 | 來源 |
|---|---|---|---|---|
| F1 訂單派發給司機 | Driver | Flex | 繁中 | hardcoded → 模板化 |
| F4 司機中選通知 | Driver | Flex | 繁中 | hardcoded → 模板化 |
| F3 配對成功 hard match | Passenger | Flex | 三語 | hardcoded → 模板化 |
| F5 軟性配對選擇 | Passenger | Flex | 三語 | hardcoded → 模板化（hybrid）|
| F6 重新配對中 | Passenger | Flex | 三語 | hardcoded → 模板化 |
| T3 訂單取消通知司機 | Driver | Text | 繁中 | hardcoded → 模板化 |
| T4 訂單取消通知 bidders | Driver | Text | 繁中 | hardcoded → 模板化 |
| T5 訂單完成 → 司機收入入帳 | Driver | Text | 繁中 | hardcoded → 模板化 |
| T6 軟配未中選 | Driver | Text | 繁中 | hardcoded → 模板化 |
| T7 司機申請已送出 | Driver applicant | Text | 繁中 | hardcoded → 模板化 |
| T8 司機證件審核（核准/駁回） | Driver | Text | 繁中 | hardcoded → 模板化（2 條訊息合 1 模板）|
| T9 司機車型 profile 審核 | Driver | Text | 繁中 | hardcoded → 模板化（2 條訊息合 1 模板）|

**已模板化不重做**（整合進新 category UI）：F2 / F7×4（5 個 order Flex）+ R1 / R2（2 個 bot reply）

### 不模板化（Brain AI 拍板留 hardcoded）

| 事件 | 不做理由 |
|---|---|
| T10/T11 司機提交 → admin | 內部訊息 |
| T12 admin 改 roles → user | 年度幾次 |
| T13 推薦碼綁定 | 一句確認 |
| T15-T17 adminNotify | admin 自己看 |
| Postback whitelist 8 entry | 純路由文字 |
| R4 軟配 postback 成功訊息（accept/wait/cancel）| reply token 流程，改機率極低 |
| T1/T2/T14（i18n fallback）| **i18n fallback 整套拔除** |

### 不整合進來（user 拍板）

- F8 公告 → 留 `/admin/notifications`
- F9 推薦分享卡 → 留 `/admin/referral`

### 設計拍板（5 個）

1. **多語策略**：passenger 三語、driver/admin 繁中
2. **i18n fallback 拔除**：專案未上線無歷史相容需求；`fallbackI18nKey` 欄位拔掉、`i18n-message.ts` 整套 deprecate；模板缺值用 registry `defaultContent` 兜底
3. **F5/F1 hybrid 條件區塊**：外殼（標題、副標、按鈕 label）可編；內部（動態 list、postback action、formatter）鎖死
4. **權限分層**：dispatch/driver-notify 類限 super only；order/softmatch 類 admin+ 可改（用既有 P18 `isSuper`）
5. **Audit log**：只記 `actor + timestamp + templateKey`（不存 diff）

## 批次切分（3 批 prod 推送）

### 批次 1：Backend Schema + Registry + 觸發點（W2-W4，1 次 prod push）

- TemplateMeta schema 擴 `outputType` / `audience` / `i18nMode` / `triggerType`
- `buildTemplateText` helper（純文字模板渲染）
- Registry 加 12 個 entry
- F5/F1 hybrid 內部鎖死區塊處理
- 拔除 `i18n-message.ts` + 12 處觸發點改單路徑

### 批次 2：Frontend UI（W5-W7，1 次 prod push）

- `/admin/line-management?tab=templates` 加 category sub-tab（5 類：order/dispatch/driver-notify/softmatch/bot-reply）
- 列表加三 badge（trigger type / output type / i18n mode）
- TemplateEditor.vue 加 outputType 切換 + 純文字編輯器
- 多語 tab（passenger 模板才顯示）
- 簡易卡片預覽（不做 Flex Simulator）

### 批次 3：驗收 + Audit + 留尾（W8-W9，1 次 prod push）

- 12 個模板 e2e 驗證
- Audit log 寫入（put / reset endpoint）
- bot-replies 整合進 templates tab（或保留獨立 sub-tab、看 W5 設計）
- OpenSpec archive

## 為什麼這樣切批次

**批次 1 純後端**：schema + registry + 觸發點，後端推 prod 後行為跟現況一致（用 defaultContent fallback），不破壞既有流程。

**批次 2 前端**：UI 變更獨立，後端已就緒，admin 開始可以編輯所有模板。

**批次 3 收尾**：驗收 + audit + archive。

## Impact

- **Admin 端**：所有 business-critical 自動訊息文案可在單一頁面編輯，不必工程介入
- **代碼維護**：i18n-message.ts 拔除 → 三語 yaml 不必同步維護 → 維護成本下降
- **多語系策略一致**：passenger 三語、driver/admin 繁中（避免「明明 driver 是繁中但卻有英日文 yaml」浪費）
- **權限細粒度**：dispatch/driver-notify 影響營運的訊息限 super only
- **零行為退化**：模板缺值用 defaultContent 兜底（registry 寫死的中文/三語預設）

## 拍板紀錄

Brain AI 2026-05-23 拍板：

1. ✅ 範圍只含 business-critical 12 個（5 Flex + 7 Text），其他 hardcoded 保留
2. ✅ passenger 三語、driver/admin 繁中
3. ✅ i18n fallback 整套拔除（含 i18n-message.ts）
4. ✅ F5/F1 採 hybrid（外殼可編、內部鎖死）
5. ✅ 權限：dispatch/driver-notify 限 super only；order/softmatch 限 admin+
6. ✅ Audit log 只記 actor + timestamp + templateKey
7. ✅ /admin/notifications 不整合（F8 留原處）
8. ✅ /admin/referral 不整合（F9 留原處）
9. ✅ 預覽用簡易卡片，不做 Flex Simulator
10. ✅ 每個批次直接上 prod，不用 preview deploy
