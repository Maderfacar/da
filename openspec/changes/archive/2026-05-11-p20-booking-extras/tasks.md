# Tasks — P20 Booking 表單擴充

## Stage 0：理解現況

- [x] 0.1 讀 `app/pages/booking/index.vue` 既有 4 步驟 form 架構
- [x] 0.2 讀 `i18n/locales/zh.js` 既有 booking key 命名規則（如 `booking.form.* / booking.confirm.*`）
- [x] 0.3 grep `contactPhone\|flightNumber\|terminal\|notes` 確認沒有意外被佔用

## Stage 1：server 端

- [x] 1.1 修 `server/routes/nuxt-api/orders/index.post.ts`：
  - `CreateOrderBody` interface 加 4 欄位（contactPhone string, flightNumber/terminal/notes string|undefined）
  - 驗證 contactPhone 格式（^09\d{8}$ regex），不符合 → badRequestError
  - notes length 上限 200 字，超過 → badRequestError
  - Firestore set 寫入新欄位（undefined 時不寫，避免 doc 欄位污染）
- [x] 1.2 lint 通過

## Stage 2：client API type 對齊

- [x] 2.1 修 `app/protocol/fetch-api/api/order/type.d.ts`：
  - `CreateOrderParams` 加 contactPhone（必填）+ flightNumber / terminal / notes（optional）
- [x] 2.2 lint 通過

## Stage 3：booking 表單 UI

- [x] 3.1 修 `app/pages/booking/index.vue`：
  - 在合適 step 加 4 個欄位（建議 step 3 或最後 step）
  - contactPhone：UiInput type=tel inputmode=numeric maxlength=10 + 即時格式驗證
  - flightNumber / terminal：v-if="orderType in airport-*" 才顯示
    - flightNumber：UiInput maxlength=10
    - terminal：UiSelect 選項 T1 / T2 (`value-on-clear=""`)
  - notes：UiInput type=textarea maxlength=200 + 字數計
  - CreateOrder 呼叫加上 4 欄位
- [x] 3.2 lint 通過

## Stage 4：i18n 三語對齊

- [x] 4.1 修 `i18n/locales/zh.js`、`en.js`、`ja.js`（三檔結構必須對齊）：
  ```
  booking.form.contactPhone        = '聯絡電話' / 'Contact phone' / '連絡電話'
  booking.form.contactPhonePlaceholder = '0912345678' / 同 / 同
  booking.form.contactPhoneError   = '請輸入正確的手機號碼' / 'Please enter a valid phone number' / '正しい電話番号'
  booking.form.flightNumber        = '航班編號' / 'Flight number' / 'フライト番号'
  booking.form.flightNumberPlaceholder = 'BR123' / 同 / 同
  booking.form.terminal            = '航廈' / 'Terminal' / 'ターミナル'
  booking.form.terminalT1          = '第一航廈' / 'Terminal 1' / '第1ターミナル'
  booking.form.terminalT2          = '第二航廈' / 'Terminal 2' / '第2ターミナル'
  booking.form.notes               = '備註' / 'Notes' / '備考'
  booking.form.notesPlaceholder    = '特殊需求請填寫' / ... / ...
  booking.form.notesLengthError    = '備註上限 200 字' / 'Notes max 200 chars' / '200文字以内'
  ```
- [x] 4.2 lint 通過

## Stage 5：文件 + commit

- [x] 5.1 寫 `docs/decision-log.md` P20 條目（背景 + 強制規範：「booking 表單欄位異動三語言對齊 + Firestore schema 新欄位 nullable 容錯」）
- [x] 5.2 docs/tasks.md v3.11 標 P20 完成
- [x] 5.3 一次性 commit + push（fast-forward）

## Stage Gate

- [x] G1 lint
- [x] G2 booking 表單能填 4 欄位 + 提交成功
- [x] G3 必填驗證：contactPhone 空 → 錯誤訊息阻擋送出
- [x] G4 格式驗證：contactPhone 不是 09 開頭 / 非 10 碼 → 錯誤訊息
- [x] G5 條件顯示：orderType 切到 charter/transfer 時 flightNumber/terminal 隱藏
- [x] G6 driver/trip modal 看到新訂單顯示 contactPhone（不再「請透過 LINE 聯絡」）+ flightNumber + terminal + notes（如有）
- [x] G7 既有訂單（無這些欄位）driver 端開 modal 仍正常顯示，4 欄位區塊安靜隱藏或顯示「—」
- [x] G8 三語切換 booking 表單 label 正確
