# Airport Forecast Data

此目錄由 **n8n** 自動下載並儲存桃園國際機場每日航班運量整點人數預報表（XLS 格式）。

## 資料來源

- 網址：https://www.taoyuanairport.com.tw/flightforecast
- 格式：Excel (.xls)，命名規則：`YYYY_MM_DD.xls`

## n8n Workflow 說明

1. **Cron 節點**：每日 05:30（UTC+8）觸發
2. **HTTP Request 節點**：下載當日 XLS 檔至本機 `data/airport-forecast/YYYY_MM_DD.xls`
3. **Code 節點**：使用 `xlsx` 套件解析 XLS，取得 24 小時整點人流預報
4. **HTTP Request 節點**：POST 解析結果至 BFF 端點

## BFF 端點

```
POST /nuxt-api/airport-forecast
Authorization: Bearer <NUXT_INTERNAL_API_KEY>
Content-Type: application/json

{
  "date": "2026-05-01",
  "sourceFile": "2026_05_01.xls",
  "hours": [
    { "hour": 0, "forecastCount": 1250 },
    { "hour": 1, "forecastCount": 890 },
    ...
    { "hour": 23, "forecastCount": 340 }
  ]
}
```

## Firestore Collection

資料儲存於 `airport_flow_forecast/{YYYY-MM-DD}`。
