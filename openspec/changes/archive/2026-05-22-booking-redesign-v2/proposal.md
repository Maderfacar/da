# Booking Redesign v2 — 流程重編排 + 車型卡市面命名 + 聯絡人/乘車人拆分（2026-05-22）

> 在 Phase 1D（booking-tag-pricing）之後的進一步重構。
> Brain AI（架構師）與 Claude（Execution AI）多輪討論後定案。

## Why

目前 booking 流程跑了 Phase 1D 後，期望特徵（preference tags）只是「藏在 Step 4 的摺疊面板」，使用者要走到送出前一頁才看得到，**篩車邏輯不通**。同時：

- **車型概念重疊**：Step 3 的計費級距（sedan/suv/van/premium）跟 tag 系統的 `vehicleType` group（MPV/SUV/CUV/轎車/9 人座 Van）語意重複，使用者無從區分
- **車型卡命名維度錯亂**：sedan/suv/van 是「車形」維度、premium 是「等級」維度，跟市面命名（經濟/豪華/旗艦/商務 + 人座）不一致
- **車型卡是空殼**：只顯示 sedan/suv/van/premium 名稱 + 容量 + 起價，沒有給使用者「選擇決策依據」
- **加值服務跟 equipment tag 重複**：「兒童座椅」「寵物友善」「無障礙坡道」在 `EnabledExtras` 跟 `equipment` tag 兩處都有
- **Step 4 明細過載**：行駛距離 / 預估時間 / tag 加價 / 折前後總額 訊息密度高，使用者其實只關心「應付多少」
- **聯絡資訊不夠**：只有「聯絡電話」一個欄位，沒有區分「聯絡人」跟「乘車人」（包車業務常有第三方下單）

→ 一句話：**目前 booking 是「叫車模型」（車種選擇 + 加值服務），但 DestinationAnywhere 業務本質是「包車模型」（容量 + 預算 + Optional）**，計費跟 UX 都該對齊包車模型。

## What Changes

### 設計哲學

1. **車型卡 vs tag 分層職責**
   - 車型卡 = 容量 + 預算（4 個級距、市面命名）
   - tag = 車輛規格 + 派遣偏好（純電/真皮/英文司機等）
2. **業務本質匹配**：包車 = 套裝價 + Optional 加價（同租車公司、Klook、KKday 包車模型）
3. **不挑剔的客戶不該被擋路**：人數 → 行李 → 車型 → 下一步即可完成
4. **所見即所得、最少資訊噪音**：不顯加價金額、不顯符合度徽章、不顯車資明細

### 計費邏輯 — 完全不動

```
fareV2.raw = baseFare + 變動費 + 加項費 + extras + 時段加價 - promoDiscount
fareV2.final = ⌈ raw / 50 ⌉ × 50
最終車資 = max(0, fareV2.final + tagSurcharge(取 max) - discount)
```

→ Fare V2 + tagSurcharge max + 折扣，**全部保留現況**（這部分 Brain AI 確認已建全）。

### Booking 流程變動

**Step 1（日期 + 時間 + 訂單類型 + 航班）— 不動**
**Step 2（上下車 + 停靠點）— 不動**

**Step 3 — 重編排**：
- 排序：人數 → 行李 → 車型卡 → 特殊需求提示 → 期望特徵 chip
- 人數拆「大人」+「兒童」兩個 stepper（容量校驗：大人+兒童 ≤ capacity）
- 車型卡改 slider（手機 swipe / 桌面左右按鈕 / 一次顯 1.5 張 / 滑動 snap）
- 期望特徵從摺疊改直接顯示
- 加值服務區塊整個移除（功能納入 equipment tag）
- 車型卡與特徵之間加提示「💡 如有特殊需求請從下方選擇」

**Step 4 — 重編排**：
- 移除：行駛距離 / 預估時間 / 喜好標籤加價（單獨明細）/ 折後總額（單獨明細）
- 新增：聯絡人欄位（LINE displayName 預填）
- 新增：乘車人欄位（含「同聯絡人」checkbox，勾選後同步名字）
  - 取消勾選後：保留同步過的名字、可繼續編輯
- 備註 placeholder 改為：「小孩需安全座椅、行李較多或特殊規格、多人數或特殊接駁需求」
- 總價只顯「應付車資 NT$ X」一行

### Tag 系統調整

| Group | Booking 可見？ | 變動 |
|---|---|---|
| ~~vehicleType~~（MPV/SUV/CUV/轎車/9 人座）| ❌ 拿掉 | 給司機端標車輛、admin 分類車隊 |
| power（純電/油電/汽油/柴油）| ✅ 可勾 | 加價（max） |
| origin（進口/國產）| ✅ 可勾 | 加價（max） |
| interior（真皮/航空椅/隔音）| ✅ 可勾 | 加價（max） |
| equipment（兒童座椅/寵物/無障礙）| ✅ 可勾 | 加價（max） + 取代 extras |
| driverSkill（英文/日文/商務/女司機）| ✅ 可勾 | 加價（max） + 派遣 hint |

實作上：booking 頁 `ApiLoadActiveVehicleTags` 改成 server 端 filter 掉 `group=vehicleType`。

### 車型卡命名（市面標準）

| 既有 id | 新 label（zh） | 新 label（en） | 新 label（ja） |
|---|---|---|---|
| sedan | 經濟五人座 | Economy 5-seater | エコノミー 5 人乗り |
| suv | 豪華五人座 | Luxury 5-seater | ラグジュアリー 5 人乗り |
| van | 商務九人座 | Business 9-seater | ビジネス 9 人乗り |
| premium | 旗艦七人座 | Premium 7-seater | プレミアム 7 人乗り |

- **id 保留不動**（避免 migration、不影響既有訂單）
- 透過 admin 後台手動編輯 label + icon + 新增 tagline 欄位完成

### Schema 新增欄位（向後相容）

```typescript
// shared/pricing.ts
interface FleetVehicle {
  // ...既有
  tagline?: I18nLabel;  // 新增：使用情境文案（三語、optional）
}

// 訂單 schema（CreateOrderParams、Firestore order doc）
{
  // ...既有
  // passengerCount: number  ← 既有，保留向後相容
  adultCount?: number;       // 新增：大人數
  childCount?: number;       // 新增：兒童數（≥ 0）
  contactName?: string;      // 新增：聯絡人姓名
  passengerName?: string;    // 新增：乘車人姓名
}
```

→ 既有欄位 `passengerCount` 保留（後端 fallback：`adultCount + childCount` 或舊 `passengerCount`）。

### 加值服務（Extras）處理

- booking 頁的 EnabledExtras 區塊整個移除（功能納入 equipment tag）
- `fleet_extras` collection **暫不刪除**（避免破壞舊訂單顯示）
- Admin 後台 `Fleet → Extras` tab 保留（之後決定哪些移除）

## 為什麼這樣切批次

### 批次 1（純前端 UX + Schema 加 optional 欄位）

不破壞既有資料、不跨系統改動，**這個視窗即可完成**。

包含：
- shared/pricing.ts: tagline 欄位
- BookingStepOptions.vue: Step 3 重排 + 移除 extras + 特徵直顯
- BookingStepConfirm.vue: Step 4 加聯絡人/乘車人/同步 + 移除明細
- 訂單 schema: 加 contactName / passengerName（adult/child 留批次 2）
- Server orders endpoints: accept 新欄位
- Admin SettingsFleetVehicles: 加 tagline 輸入
- Tag endpoint: filter vehicleType group
- i18n × 3 補翻譯
- 註：**車型卡 slider 留批次 2**（slider 互動需試錯時間）
- 註：**人數拆 adult/child 留批次 2**（跨系統破壞性、要 audit）

### 批次 2（破壞性 + Slider）

需要 audit 跨系統影響、Slider 試錯時間，**另開視窗執行**。

包含：
- 人數拆 adult/child 全系統改造（server orders、admin order list、driver 端、LINE 通知模板、backward-compat）
- 容量校驗改大人+兒童
- 車型卡 slider 元件
- 完成後 push to prod

### 批次 3（產品操作 + 收尾）

純 admin 後台操作 + 內容撰寫，**Brain AI 親自做**。

包含：
- Admin 編 4 個級距 label / icon / tagline 為市面命名
- 評估 EnabledExtras 哪些保留 / 移除
- 司機端 vehicleType tag 標註 onboarding（如需要）

## 拍板紀錄

Brain AI（使用者）多輪討論後拍板：

1. ✅ tagSurcharge 保留 max（不改 sum）
2. ✅ vehicleType tag 從乘客 booking 拿掉、只給司機端標車輛用
3. ✅ 車型卡採市面命名（經濟/豪華/旗艦/商務 + 人座）
4. ✅ 車型卡加 tagline 三語欄位
5. ✅ Step 3 順序：人數 → 行李 → 車型卡 → 提示 → 特徵
6. ✅ 大人 + 兒童 ≤ capacity（兒童佔 1 座位）
7. ✅ 車型卡 slider：手機 swipe / 桌面按鈕 / 1.5 張 / snap
8. ✅ 同聯絡人 checkbox 取消後：保留同步過的名字
9. ✅ Step 4 總價：只顯「應付車資 NT$ X」一行
10. ✅ 加值服務區塊：booking 頁移除、納入 equipment tag

Brain AI 拍板「不會顯示車隊符合度徽章」「車型卡不顯加價」「chip 不顯個別金額」三項減噪設計。

## Impact

- **乘客體驗大幅提升**：流程更短、決策更直觀、文案貼近業務本質
- **計費邏輯零變動**：保護現有 Fare V2 + tagSurcharge + 折扣機制
- **資料層向後相容**：新增 optional 欄位、不破壞既有訂單
- **跨系統影響可控**：批次 1 不碰 passengerCount 拆分、批次 2 才動
