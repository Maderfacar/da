# Phase 0 — Google API 技術驗證結果

**日期**：2026-05-16
**測試路線**：台北車站 (25.0478, 121.5170) → 新竹高鐵站 (24.8068, 121.0407)
**參數**：`departureTime=2026-05-17T18:00:00Z`、`travelMode=DRIVE`、`routingPreference=TRAFFIC_AWARE_OPTIMAL`、`regionCode=TW`、`languageCode=zh-TW`

## 測試 1：Routes API v2 — Full FieldMask Dump

### 發送
```http
POST https://routes.googleapis.com/directions/v2:computeRoutes
X-Goog-FieldMask: *
Body: { ..., extraComputations: ["TOLLS","FUEL_CONSUMPTION","TRAFFIC_ON_POLYLINE"] }
```

### 回傳結構（30,657 bytes）

```
TOP KEYS: [ routes, geocodingResults ]

ROUTE KEYS: [
  legs, distanceMeters, duration, staticDuration, polyline,
  description, warnings, viewport, travelAdvisory, localizedValues,
  routeToken, routeLabels, polylineDetails
]

distanceMeters    : 70,637  m
duration          : 3,225 s  (53.8 min, 含交通)
staticDuration    : 3,894 s  (64.9 min, 不含交通)
polyline.encodedPolyline : 3,496 chars (1,072 個座標點)
```

### ❌ TOLLS（extraComputation）對台灣

```json
"travelAdvisory.tollInfo": {}
```

**空物件。Routes API TOLLS 不支援台灣。必須自建 toll engine。**

### ❌ speedReadingIntervals 道路層級用途

整路只回 1 個 interval，覆蓋整條路線標 `NORMAL`：

```json
"speedReadingIntervals": [
  { "startPolylinePointIndex": 0, "endPolylinePointIndex": 1071, "speed": "NORMAL" }
]
```

只有塞車程度，**無辨識道路層級的能力**。

### ❌ `roadFeatures` / `interventions` / 道路層級 enum

對整份回應做深度 regex 掃描 `roadFeature|intervention|roadClass|roadType|highway|motorway|freeway|trunk|class`：

```
NONE — Routes API v2 不會回道路層級 enum
```

**Brain AI 提到的 `routes.legs.steps.roadFeatures` 欄位在現行 v2 不存在。**

### ✅ step 內容範例（17 個 steps）

```json
{
  "distanceMeters": 68,
  "staticDuration": "30s",
  "polyline": { "encodedPolyline": "ke{wCsstdV..." },
  "startLocation": { "latLng": { "latitude": 25.048055, "longitude": 121.516261 } },
  "endLocation": { "latLng": { "latitude": 25.048644, "longitude": 121.516431 } },
  "navigationInstruction": {
    "maneuver": "DEPART",
    "instructions": "往北走承德路一段"
  },
  "travelMode": "DRIVE"
}
```

`navigationInstruction.instructions` 含「上國道一號」「進入國道三號」這類**文字**，可解析但**脆弱**（要靠 NLP / regex 維護多語言）。不推薦。

`maneuver` enum 含 `DEPART / TURN_LEFT / MERGE / FORK / ON_RAMP / OFF_RAMP / ROUNDABOUT / ...`，可間接推測「進出國道（ON_RAMP/OFF_RAMP）」但仍不夠 robust。

## 測試 2：Elevation API — Path Sampling

### 失敗嘗試 #1：`path=enc:${polyline}`

URL 編碼 polyline 含 `?@[\` 等保留字元，Google 回 `INVALID_REQUEST`。

### 成功方法：先解碼 polyline，再依 1km 等距取樣 → GET `locations=lat,lng|lat,lng|...`

```
原始 polyline 1,072 個點 → 1km 等距取樣 → 72 個點（覆蓋 70.63 km）
```

### 回傳

```
status: OK
result count: 72

first 5 samples:
  #0 elev: 2.8m   res: 76.4m
  #1 elev: 1.6m   res: 76.4m
  #2 elev: 0.5m   res: 76.4m
  #3 elev: 2.8m   res: 76.4m
  #4 elev: 2.0m   res: 76.4m

last 3 samples:
  #69 elev: 55.3m   res: 610.8m
  #70 elev: 50.5m   res: 610.8m
  #71 elev: 47.8m   res: 610.8m

--- STATS ---
min            : 0.5 m
max            : 296.1 m
elevationDiff  : 295.6 m   ← 訊號 1: 海拔起伏
avg resolution : 150.58 m/sample
```

✅ **完美可用。1 個 request 拿到整路海拔起伏。**

## 訊號計算驗證（所有 5 訊號可拿到）

```
=== 台北→新竹 訊號示範 ===
  路線距離       : 70.64 km
  直線距離       : 54.97 km  (haversine)
  曲折度         : 1.285        ← 訊號 2
  staticDuration : 64.9 min
  duration       : 53.8 min
  純塞車延誤     : 0.0 min      ← 訊號 3 (off-peak so 0)
  平均無塞車時速 : 65.3 km/h    ← 訊號 4

→ 山區判定（用 design.md 預設門檻）：
  海拔起伏 295.6m vs ≥ 400m       : ❌ (差 100m)
  曲折度 1.285  vs ≥ 1.3          : ❌ (差 0.015)
  無塞車時速 65.3 vs ≤ 40 km/h    : ❌ (差 25.3)
  → 累計 0 分 → multiplier = 1.00（不加成）

  ✅ 合理：北二高國道路線、平地、無壅塞，公式正確判定「非山區」。
```

道路層級 + 國道里程 + 跨縣市這 3 個訊號需要 OSM + 縣市 GeoJSON（design.md Phase 1）。

## 最終結論

| 訊號 | 來源 | 狀態 |
|---|---|---|
| 路線距離 | Routes API v2 `distanceMeters` | ✅ |
| 純塞車延誤 | Routes API v2 `max(0, duration − staticDuration)` | ✅ |
| 平均無塞車時速 | Routes API v2 `distanceMeters / staticDuration` | ✅ |
| 曲折度 | server 端 `haversine(origin, dest)` + 路線距離 | ✅ |
| 海拔起伏 | Elevation API path samples max-min | ✅ |
| 國道里程 | OSM 預處理索引（自建） | ⏳ Phase 1 |
| 道路層級 (motorway/trunk) | OSM 預處理索引 | ⏳ Phase 1 |
| 跨縣市偵測 | Taiwan 22 縣市 GeoJSON + point-in-polygon | ⏳ Phase 1 |
| 國道通行費 | 自建 engine（高公局公告費率） | ⏳ Phase 2 |

**沒有死路**。所有 5 個訊號都拿得到，5 個來自 Google API + 3 個來自自建 OSM/GeoJSON 模組 + 1 個來自 server 端計算。Brain AI 假設的「Routes API 有 roadFeatures」不成立，但替代方案（OSM）成熟可靠。

## 副作用：API quota 估算

每次 booking 估價：
- Routes API v2 : 1 request × $5/1000 = $0.005
- Elevation API : 1 request (path locations) × $5/1000 = $0.005
- OSM lookup    : in-memory，0 成本
- 縣市判定      : in-memory，0 成本

**每筆估價 = USD $0.01（NT$ 0.32）**，可接受。

緩存 5min 後同 query 不重打 → 真實成本進一步下降。

## Phase 0 Dump 檔案

```
~/.fare-v2-phase0/
├── routes-v2.json        (30,657 bytes — 完整 Routes API v2 回傳)
├── elevation.json        (Elevation API 72 點回傳)
└── sample-coords.txt     (1km 等距取樣座標)
```

> 這些檔在 worktree 之外，不會進 git。供下個 session 需要時可重跑同樣 curl 命令重產。
