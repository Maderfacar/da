# 2026-05-15 — Admin LINE OA Richmenu 圖層合成器（P44b）

> **狀態**：Brain AI 預先拍板「直接做完 / 全用 spec 預設」— Q1-Q4 + Q5=5b 全推預設，直接進 Phase 1 實作。
> **規模**：純前端 + doc schema 擴展 / 1.5-2 工作天 / 4 Phase。
> **依賴**：P44a archive（v0.3.26）已上 main；本 wave 與其獨立但互補。

## Why

P38 上 prod 後，admin 上傳 richmenu 圖必須準備**完整成品 PNG**（2500×1686 / 2500×843，≤ 1MB）。實務上：

1. **admin 沒有設計師也沒有時間外發**：要產 menu 圖必須開 Figma / Photoshop / 線上工具自己拼，瓶頸高
2. **改文字 / 換 icon 需重做整張圖**：例如把「訂車」字換成「立即預約」，admin 得回設計工具重匯出 PNG 再上傳；P38 後若 P44a area editor 已就位但圖本身不能改，文字改了 area 也對不齊
3. **設計一致性難維持**：兩個 OA（passenger + driver）× 三種語系（zh_tw + en + ja）× 多版本（v1/v2/節慶）= 至少 6-18 張 menu 圖，每張都靠外部工具產出後上傳，視覺風格容易漂移
4. **P38 spec §3 早就把「圖層合成器」標為 out-of-scope**：留尾到 P44 — 即本 wave

P44b 提供 admin 在系統內**用拖拉 + 文字輸入 + 範本**直接組 menu 圖、即時 preview、一鍵合成 PNG 上傳。降低 menu 設計門檻、加快多語系 / 多版本迭代速度、維持品牌一致性。

## What Changes

### 1. 圖層 schema（Q2=2b：doc 加 layers field）

`line_richmenus` doc 加可選 `layers` field（既有 doc 沒此欄位仍 work，純 opt-in）：

```typescript
interface RichmenuLayer {
  id: string;          // local uuid（client 端 nanoid）
  type: 'image' | 'text' | 'rectangle';
  x: number;            // 底圖 px
  y: number;
  width: number;
  height: number;
  opacity?: number;     // 0-1，預設 1
  rotation?: number;    // 預設 0（第一版不支援旋轉，但 schema 預留）

  // image
  imageUrl?: string;    // 可為 data URL 或 https://
  imageFit?: 'contain' | 'cover' | 'fill';

  // text
  text?: string;
  fontSize?: number;    // 底圖 px
  fontWeight?: 400 | 600 | 700;
  fontFamily?: string;  // CSS font-family string
  color?: string;       // hex / oklch / rgb
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';

  // rectangle
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
}
```

doc 加：
```typescript
{
  // 既有 fields ...
  layers?: RichmenuLayer[]; // 可選
  layersTemplate?: string;   // 若從範本來，記範本 key（admin 可重置）
}
```

### 2. Composer canvas component（Q1=1a：純前端 HTML Canvas 2D）

新增 `app/components/admin/line-management/RichmenuComposer.vue`：

- 左側：圖層 list + add layer 按鈕（image / text / rectangle）+ 範本下拉
- 中央：preview canvas（縮放至 480 寬，與 P44a image preview 共寬）
- 右側：選中圖層的屬性編輯（type-aware fields）
- 底部：「合成並上傳」按鈕 → canvas.toBlob(PNG) → 接既有 ApiUploadLineRichmenuImage

互動：
- 圖層 list 排序 = z-order（list 上 = canvas 下）
- 點 list item → 選中 + 顯示屬性
- canvas preview 中可拖拉 layer（共用 P44a 的 pointer 互動套路，但更簡化：只 move，不做 8-handle，position 改 x/y 即可）
- delete layer / 複製 layer / 上下移調整 z-order

### 3. 5 個預設範本（Q4=4b）

`app/utils/richmenu-templates.ts` 定義 5 個常用版型：

| Key | Name | Size | 用途 |
|---|---|---|---|
| `grid-2x2-iconLabel` | 2×2 grid + icon + label | 2500×1686 | 4 個主要動作（最常用） |
| `hero-plus-3` | 上 hero + 下 3 等分 | 2500×1686 | 1 強 3 弱（首選預約 + 3 次要） |
| `header-plus-2x2` | 上品牌列 + 下 2×2 | 2500×1686 | 強化品牌 + 4 動作 |
| `compact-3btn` | 3 橫向 button | 2500×843 | 緊湊 3 動作 |
| `bg-plus-6grid` | 底圖 + 6 透明區 | 2500×1686 | 視覺豐富 + 6 動作 |

每範本含：
- 預設 layers（rectangle 底色 + text 標籤 + 視覺占位）
- 預設 areas（與 layers 對應，可拍即用）
- 預覽縮圖（80×54 px，內嵌 base64 或 emoji 簡單代表）

### 4. 匯出 + 上傳整合

「合成並上傳」流程：

```
1. 把 layers 渲染到 hidden canvas（2500×1686 或 2500×843）
2. 確認 document.fonts.ready（避免 fallback 字型）
3. canvas.toBlob({ type: 'image/png' })
4. 檢查 blob.size > 1MB → 警告（或 fallback 嘗試 JPEG quality 0.85）
5. new File([blob], 'composed.png', { type: 'image/png' })
6. 呼叫既有 ApiUploadLineRichmenuImage(draftId, file)
7. 上傳成功 → 同步 PATCH layers 到 doc（記錄 layers metadata）
```

## Out of Scope（明確不做）

- ❌ **layer 旋轉 / scale / 翻轉**：第一版只 x/y/w/h + opacity；rotation 留 schema 但 UI 不開
- ❌ **layer 群組 / mask**：複雜度爆炸
- ❌ **server 端 sharp / node-canvas 合成**：Q1=1a 已拍板純 client
- ❌ **動態字型載入**：第一版只支援 `system-ui` / `serif` / `monospace` + 既有 Bebas Neue / Barlow（已在 admin 端 preload）
- ❌ **marketplace（admin 互傳範本）**：Q4=4b 拍板，只做 5 個內建範本
- ❌ **行動裝置編輯**：desktop only
- ❌ **layer 撤銷 / 重做**：留尾觀察
- ❌ **同步 P44a area editor**：composer 內不顯示 areas overlay；composer 是「設計圖」，area editor 是「綁互動」；admin 流程：composer 出圖 → area editor 設互動

## 4 個關鍵決策

### Q1：合成器執行端
- **1a Client canvas**（純前端）
- **1b Server canvas**（sharp / node-canvas）

**Brain AI 拍板（spec 預設）**：**1a** — 純前端足夠，避免 server 端 npm 依賴 + Vercel cold start 拖延。

### Q2：圖層 schema
- **2a 純 client state**：合成後只存 PNG，不存 layers
- **2b 存 layers 到 doc**：可後續再編

**Brain AI 拍板（spec 預設）**：**2b** — admin 修圖層比重做 PNG 直觀；schema 加 layers field（可選，既有 doc 不影響）。

### Q3：area editor 範圍
- 已於 P44a 拍板 3b（drag + resize + snap + 多選 + alignment guide）；本 wave 不涉及。

### Q4：預設模板
- **4a 不做**
- **4b 5 個內建範本**
- **4c marketplace**

**Brain AI 拍板（spec 預設）**：**4b** — 5 個範本平衡易用 + 不過度。

### Q5：範圍切分
- 已於 P44a 拍板 5b（拆 P44a / P44b）；本 wave = P44b。

## Impact

### 影響範圍

- **改動既有檔（2 個）**：
  - `server/utils/line-richmenu-doc.ts`：加 `RichmenuLayer` interface + `LineRichmenuDoc.layers?` field + DTO 同步 + validators
  - `server/routes/nuxt-api/admin/line-richmenus/[id].patch.ts`：PATCH body 支援 `layers` + `layersTemplate`
- **新增前端（3-5 個）**：
  - `app/components/admin/line-management/RichmenuComposer.vue` — 主體 component
  - `app/composables/use-richmenu-composer.ts` — composer 邏輯（layer CRUD / canvas render / export blob）
  - `app/utils/richmenu-templates.ts` — 5 個範本定義 + helper
  - `app/protocol/fetch-api/api/admin/line-richmenu/type.d.ts`：加 RichmenuLayer / RichmenuLayerType
- **改動 Edit.vue**：加「composer」tab toggle（與「上傳圖片」並列），切換時顯示 composer 而非 file input
- **不動 firestore rules / indexes**：layers 是 doc 內 array，rule 允許 admin 寫即可

### 風險

| 風險 | 緩解 |
|---|---|
| Canvas toBlob PNG 在 2500×1686 大圖 + 多 layer 容易超 1MB | 提供 admin 警告 + JPEG fallback（quality 0.85）；JPEG 通常能壓到 200-400KB |
| 中文字型 render fallback（admin 機沒 Bebas / Barlow） | composer 範本內 text layer 主推 system-ui / serif / sans-serif，視覺也可接受；admin 改字型走下拉，且加 fontFace preload |
| Canvas API 在 mobile Safari 對大尺寸圖效能不穩 | admin desktop only 不需考慮 |
| 圖層拖拉與 P44a area editor 互相衝突 | 兩者分屬不同 UI tab；composer 不涉及 areas 編輯，仍由 P44a 介面負責 |
| 範本套用清空既有 areas | 與 P38 grid quick set 一致策略：confirm dialog 二次確認 |
| toBlob 是 async 但無進度條 | small UX miss；第一版加 loading spinner 即可，大圖 2500×1686 + 5 layers 在 desktop Canvas 合成 < 500ms |
| layers 寫 doc 後若 admin 用其他工具改圖 / 直接傳 PNG 覆蓋 | 第一版 PATCH layers 與 upload-image 兩條路徑獨立；admin 用 upload-image 換圖時 doc 不會自動清 layers，由 admin 手動 reset；UI 上明確標示「目前用合成」vs「直接上傳」 |

### 估時

| Phase | 內容 | 估時 |
|---|---|---|
| **Phase 0** | openspec spec 三件套 | 0.25d |
| **Phase 1** | doc schema 擴展 + 後端 validators + composable + composer 主 UI 骨架 | 1.0d |
| **Phase 2** | 5 個範本 + 圖層 CRUD UI + 屬性編輯 + 拖拉 + canvas render + 匯出上傳 | 1.0d |
| **Phase 3** | build 驗證 + version bump + archive | 0.25d |
| **總計** | | **~2.5 工作天** |

## Brain AI 拍板紀錄（2026-05-15）

**指令**：「直接做完，有需要拍板的，就直接照你預設即可」。Q1-Q4 全用推 spec 預設。詳見 [design.md §11](design.md#11-決策紀錄)。

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | 1a | Client canvas（純前端） |
| Q2 | 2b | doc 加 layers field（opt-in 既有不影響） |
| Q4 | 4b | 5 個內建範本 |

**Phase 1 解鎖** — 可直接開工。
