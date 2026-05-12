# Hand-off：TDX 航班 API 整合（Booking 階段排程驗證）

> 接續 [`2026-05-10-flight-registry-tracker/HANDOFF.md`](../2026-05-10-flight-registry-tracker/HANDOFF.md) Stage 3。

## 緣起

Aviation Edge 實測 LCC / 區域航空涵蓋率極差（LJ 0、SQ 3、KE 4 筆），純靠它 booking 頁查詢 UX 不可接受。本次補上**運輸部 TDX API**作為 booking 階段的主要排程資料源；Aviation Edge 暫時 hold，**之後**會在 Stage X 接回，但**只用於查單筆訂單當天的「實際執飛狀態」**（status / estimatedTime / actualTime / 延誤）— 跟 booking 階段的 schedule validation 完全分離。

## 需求拍板（user 已確認）

### 1. TDX API 認證

```
client_id     : youcool15-3c6ee725-7a8d-452c
client_secret : 330ea274-93b5-444d-bb5f-5d69e61abb5c
```

- 環境變數命名：`NUXT_TDX_CLIENT_ID` / `NUXT_TDX_CLIENT_SECRET`
- 流程：OAuth2 client_credentials grant
  - Token endpoint: `https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`
  - 拿到 `access_token`（24h TTL）→ 後續 API 帶 `Authorization: Bearer <token>`
- **絕不可外洩到 client**（同 Aviation Edge）

### 2. TDX 資料 endpoints

```
GET https://tdx.transportdata.tw/api/basic/v2/Air/GeneralSchedule/Domestic
GET https://tdx.transportdata.tw/api/basic/v2/Air/GeneralSchedule/International
```

- Booking 階段同時並行打兩個（速度優先；TDX rate limit 50/秒、50k/日，不擔心）
- 拿到後 union 結果，用 `flight.iataNumber === flightNoUpper` 二次過濾
- `?$format=JSON` query 強制 JSON 輸出（TDX 預設 XML）

### 3. Layer 順序（booking 階段）

```
Layer 1：in-memory hot cache（5 min, per process）
   ↓
Layer 2：Firestore flight_registry（含 tdx 子物件，60 天 TTL）
   ↓
Layer 3：TDX API（雙 endpoint 並行）→ self-learning 寫回 registry
   ↓
找不到 = 回 404
```

**Aviation Edge 在 booking 階段不打**（程式碼保留 `_queryAeTimetable` / `_queryAeFuture` / `_callAviationEdge` 三個函式，但 `_lookupFlight` 不調用，等之後接「即時狀態」階段才啟用）。

### 4. Token cache 策略：in-memory（方案 A）

```ts
let _tdxToken: { value: string; expiresAt: number } | null = null;
const _getToken = async (): Promise<string> => {
  if (_tdxToken && _tdxToken.expiresAt > Date.now() + 60_000) return _tdxToken.value;
  // 重拿 token，提早 1 分鐘 refresh 避免邊界
  ...
};
```

- 每個 Vercel cold start 重拿一次（一天約 50 次，遠低於 TDX rate limit）
- token TTL 24h，提早 1 分鐘 refresh 邊界保險

### 5. 驗證邏輯（4 條）

針對 booking 頁航班輸入欄位：

| # | 條件 | 失敗時 |
|---|------|--------|
| 1 | TDX 找得到該 `flightNo`（含 codeshare 雙向搜尋） | 回 404 → UI 顯示 `error.notFound` |
| 2 | 用車日期在 schedule 的 `EffectiveStartDate ~ EffectiveEndDate` 區間內 | 回 404 → UI 顯示 `error.notFound` |
| 3 | 用車日期當天的星期幾在該班的 `WeekDays` 清單內（如 `[1,3,5]` = 週一三五飛） | 回 404 → UI 顯示 `error.notFound` |
| 4 | 至少一端機場在台灣（TPE / TSA / KHH / RMQ） | 回 404 → UI 顯示 `error.notFound` |

**同一條 `notFound` 文案打通所有失敗情境**（user 拍板，避免冗長文案 + UI 簡單）。

`WeekDays` 格式用 `[1,3,5]`（1=週一，7=週日，符合 ISO 8601）。

### 6. Codeshare 處理（Stage 1 含進）

TDX `/Air/GeneralSchedule` 回傳含 `CodeShare` flag + `MarketingAirlineID` / `OperatingAirlineID`。Codeshare row 的 `FlightNumber` 是該航空公司「自己賣票的編號」，跟實體營運的航班號不同（例：JL 與 CI 共用，JL801 是實體，CI8401 是 codeshare row）。

**處理策略**：
- 第一輪比對：`row.AirlineID + row.FlightNumber === flightNoUpper`（精確匹配，含 codeshare）
- 若第一輪 miss，第二輪嘗試：在 result 中找 `OperatingAirlineID + OperatingFlightNumber === flightNoUpper`（保險措施，TDX 文件規格未必每筆都有，best-effort）
- 命中則用「實際營運的 airport / time」作為主資料（避免 codeshare row 缺欄位）

### 7. flight_registry doc 結構（擴充）

```ts
flight_registry/{FLIGHTNO}: {
  // ── 共用識別欄位（保留既有） ──
  flightNo: string                    // "CI102"
  airlineCode: string                 // "CI"
  airlineName: string                 // "中華航空"
  
  // ── TDX 來源（本 spec 新增） ──
  tdx: {
    isDomestic: boolean
    departureAirport: string          // "NRT"
    arrivalAirport: string            // "TPE"
    terminal: string                  // "1" / "2"（國內線可能為 ""）
    scheduledDeparture: string        // "10:30" (HH:mm)
    scheduledArrival: string          // "13:45"
    weekDays: number[]                // [1,3,5] (1=週一, 7=週日)
    effectiveStart: string | null     // "2026-03-30" (可空，全年飛無區間)
    effectiveEnd: string | null       // "2026-10-25" (可空)
    codeShare: boolean
    operatingAirlineCode: string | null   // codeshare 才有
    operatingFlightNumber: string | null  // codeshare 才有
    fetchedAt: Timestamp              // TDX 撈回來時間
  } | null                            // null 表示尚未從 TDX 學習過
  
  // ── Aviation Edge 來源（保留既有，本 spec 不動） ──
  // 既有 schedules: Record<string, FlightRegistrySchedule> 改名遷移到 aviationEdge.schedules
  // ⚠ 但既有 Firestore doc 已寫入 .schedules → 為避免 backfill 寫入失敗，schema 維持「extends」而非「rename」：
  schedules?: Record<string, FlightRegistrySchedule>  // 既有 Aviation Edge 寫入的，繼續存在不動
  
  // ── 共用 metadata ──
  lastUpdated: Timestamp              // 任一來源更新就刷新
  // 既有 departureAirport / arrivalAirport / terminal / status 既有欄位保留（Aviation Edge 寫入用），不動
  departureAirport?: string
  arrivalAirport?: string
  terminal?: string
  status?: string
}
```

**重要**：Aviation Edge 既有寫入的欄位 `schedules` / `departureAirport` / `arrivalAirport` / `terminal` / `status` **全保留不動**（避免破壞既有 prod 資料）。新增的 TDX 資料全部包在 `tdx` 子物件裡。

### 8. Booking UI 行為（最小改動）

[`BookingStepType.vue`](../../../app/components/passenger/BookingStepType.vue) 既有 `_LookupFlight` 邏輯：
- 用 `direction` (arrival/departure) + `date` 查 `/api/flight`
- 拿回 `FlightInfo` 顯示 terminal / 預計時間
- 送機額外檢查 `estimatedTime >= 用車時間 + 3h`，否則 `tooSoon`

**TDX 整合後的調整（user 拍板方案 a）**：
- TDX schedule 沒有 `estimatedTime` / `status: active|landed|delayed`，只有排程時間 `scheduledTime`
- 在 server map 時 `estimatedTime = scheduledTime`（即用排程時間當預計時間）
- `status` 一律填 `'scheduled'`
- 既有 booking UI **完全不動**（送機 3h 檢查邏輯沿用，因 estimatedTime 已 fallback 到 scheduledTime）

### 9. Aviation Edge 程式碼處置：方案 a（保留不調用）

`_queryAeTimetable` / `_queryAeFuture` / `_callAviationEdge` / `_mapAeFuture` / `_mapAeTimetable` 三個 helper + 兩個 mapper **全部保留在檔案內**，僅 `_lookupFlight` 不調用。等之後做「即時狀態查詢」階段再啟用（可能改成單獨 endpoint 如 `/api/flight/realtime`）。

`flight_registry` doc 內 Aviation Edge 既有寫入的 `schedules` 子物件**繼續保留**，本 spec 不動。

---

## Stage 拆解（每 stage 獨立 commit + 可獨立驗收）

| Stage | 範圍 | 預估 diff | 可中斷？ |
|---|---|---|---|
| 0 | 本 HANDOFF.md（spec 文件） | +400 行 | 自然 commit 點 |
| 1 | `server/utils/tdx-flight.ts` 新檔（OAuth + 雙 endpoint 並行 + parse + filter + codeshare 雙向）| +280 行 | 自然 commit 點（helper 可獨立 unit test） |
| 2 | `server/utils/flight-registry.ts` 擴 tdx 子物件 + read/write helper | +60 行 diff | 自然 commit 點 |
| 3 | `server/api/flight.get.ts` 插 Layer 3、拔 Aviation Edge 調用、改用 TDX self-learning | ~80 行 diff | 自然 commit 點（end-to-end 走通） |
| 4 | docs/decision-log + tasks.md + 推 main 觸發 prod 部署 | +60 行 | 收尾 commit |

**全部完成預估 ~1 個 session（context 緊就停在 Stage 1 或 Stage 2 commit 後，下個 session 接）。**

---

## 接手注意事項（給下個 session）

### 必讀順序

1. CLAUDE.md（強制規範）
2. 本 HANDOFF
3. 既有 [`2026-05-10-flight-registry-tracker/HANDOFF.md`](../2026-05-10-flight-registry-tracker/HANDOFF.md)（前一輪 4 層 fallback 設計）
4. memory `project-aviation-edge.md`（Aviation Edge 已驗證限制）

### 環境變數

User 已 confirm 自行設定（Vercel + 本地 `.env.dev`）：

```
NUXT_TDX_CLIENT_ID=youcool15-3c6ee725-7a8d-452c
NUXT_TDX_CLIENT_SECRET=330ea274-93b5-444d-bb5f-5d69e61abb5c
```

### TDX response 範例（預期欄位，待 Stage 1 實打驗證）

```json
[
  {
    "AirlineID": "CI",
    "FlightNumber": "0102",
    "DepartureAirportID": "NRT",
    "ArrivalAirportID": "TPE",
    "ScheduledDepartureTime": "10:30",
    "ScheduledArrivalTime": "13:45",
    "DepartureTerminal": "1",
    "ArrivalTerminal": "2",
    "WeekPattern": [1, 0, 1, 0, 1, 0, 0],   // [Mon,Tue,...,Sun] OR
    "WeekDays": [1, 3, 5],                  // 二擇一，TDX 文件需確認
    "EffectiveDate": "2026-03-30",
    "ExpireDate": "2026-10-25",
    "CodeShare": false,
    "OperatingAirlineID": null,
    "OperatingFlightNumber": null
  }
]
```

⚠ **欄位名稱需 Stage 1 實打第一次 response 後微調**（TDX 文件 vs 實際 response 偶有差異，例：`ScheduledDeparture` vs `DepartureTime` vs `STD`）。Stage 1 開頭可加一行 `console.log` debug。

### 部署/環境

- production: https://da-line-liff-app.vercel.app
- branch 模式：`git push origin <local-branch>:main` fast-forward
- 對話用繁中、commit message 用 Conventional Commits 繁中、attribution 已禁用
