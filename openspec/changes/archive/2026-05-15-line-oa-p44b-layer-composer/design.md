# P44b — 圖層合成器：設計

## 1. RichmenuLayer schema（client + server 共用）

```typescript
export type RichmenuLayerType = 'image' | 'text' | 'rectangle';

export interface RichmenuLayer {
  /** client uuid（不對應 Firestore doc id）；用於 list key + selection */
  id: string;
  type: RichmenuLayerType;
  /** 底圖 px 整數 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-1，預設 1 */
  opacity?: number;

  // image
  imageUrl?: string;
  imageFit?: 'contain' | 'cover' | 'fill';

  // text
  text?: string;
  fontSize?: number;        // 底圖 px
  fontWeight?: 400 | 600 | 700;
  fontFamily?: string;
  color?: string;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';

  // rectangle
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
}
```

## 2. 5 個範本（richmenu-templates.ts）

```typescript
export interface RichmenuTemplate {
  key: string;
  label: string;
  description: string;
  size: { width: 2500; height: 1686 | 843 };
  thumb?: string; // emoji 圖示縮圖
  layers: RichmenuLayer[];
  areas: RichmenuArea[];
}

export const TEMPLATES: RichmenuTemplate[] = [
  // 1. grid-2x2-iconLabel
  // 2. hero-plus-3
  // 3. header-plus-2x2
  // 4. compact-3btn (2500×843)
  // 5. bg-plus-6grid
];

export function getTemplate(key: string): RichmenuTemplate | null;
export function listTemplates(size?: '1686' | '843'): RichmenuTemplate[];
```

設計原則：
- 顏色用 P38 既有 amber `#d4860a` + 中性色（white / 淺灰 / 深灰）為主，避免品牌 collision
- 文字佔位用「按鈕 N」/「動作 N」/「Hero 標題」等可一眼識別待替換
- 範本套用為「整批 import」：清空既有 layers + areas → set 範本的 layers/areas → admin 改任意 layer 屬性即可

## 3. Canvas render（composable use-richmenu-composer）

```typescript
interface UseRichmenuComposerParams {
  layers: Ref<RichmenuLayer[]>;
  imageSize: Ref<RichmenuSize | null>;
  previewMaxWidth: number; // 480
}

interface UseRichmenuComposerReturn {
  selectedLayerId: Ref<string | null>;
  primaryLayer: ComputedRef<RichmenuLayer | null>;
  addLayer: (partial: Partial<RichmenuLayer> & { type: RichmenuLayerType }) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;
  patchLayer: (id: string, patch: Partial<RichmenuLayer>) => void;
  applyTemplate: (template: RichmenuTemplate) => { layers: RichmenuLayer[]; areas: RichmenuArea[] };
  /** 同步合成到 hidden canvas 並回 Blob */
  composeBlob: () => Promise<{ blob: Blob; mime: 'image/png' | 'image/jpeg'; sizeBytes: number }>;
  /** preview canvas ref：composable 內部 own + 在 mount 後綁定 */
  previewCanvasRef: Ref<HTMLCanvasElement | null>;
  /** 排版時自動 redraw preview */
  redrawPreview: () => void;
}
```

render 流程：
- preview canvas 寬 480、高依 imageSize.height * (480 / imageSize.width)
- 對每 layer 依序：
  - `image`：載入圖（HTMLImageElement），先 cache（map by url），onload 後依 imageFit 縮放
  - `text`：`ctx.font` 設置 → `ctx.fillStyle` → `ctx.fillText` with align（baseline 取 'top' / 'middle' / 'bottom'）
  - `rectangle`：`fillStyle` / `strokeStyle` / `roundRect` 若 radius > 0
- 套 `globalAlpha = layer.opacity ?? 1`，render 完恢復 1

匯出 blob 時：
- 用第二顆 hidden full-size canvas（imageSize.width × imageSize.height）
- await document.fonts.ready（一次性，避免 fallback 字型）
- 同樣流程 render（但用底圖 px，不縮放）
- `canvas.toBlob(blob => resolve(blob), 'image/png')`
- 若 blob.size > 1 MB → 顯示警告 + 提供 JPEG 重新合成選項

## 4. Composer UI 結構

```
.RichmenuComposer
  .Composer__head  (template 下拉 + 「合成並上傳」按鈕)
  .Composer__body
    .Composer__sidebar (layer list)
      - layer item (drag handle / type icon / name / visibility / 上下移)
      - + 加 layer 按鈕（image / text / rectangle）
    .Composer__stage (preview canvas + drag 互動)
      - canvas (auto width 480)
      - selection box overlay (selectedLayer rect)
    .Composer__inspector (右側屬性編輯 — type-aware)
      - 通用：x / y / width / height / opacity
      - image：imageUrl（檔案上傳 → base64）/ imageFit
      - text：text / fontSize / fontWeight / color / fontFamily / align / vAlign
      - rectangle：fillColor / borderColor / borderWidth / radius
```

## 5. canvas pointer 互動（簡化版 P44a）

只支援「在 canvas 點 layer 選中 + 拖移」。**不做 resize handle / multi-select / marquee**（複雜度與既有 area editor 重疊；composer 主訴求是版型編輯，不是區塊定義）：

- pointerdown → hit-test from top 到 bottom（z-order 反向）→ 找到第一個 layer 中的 → selectedLayerId
- pointerdown 在 layer → 進 moveFlow
- pointermove → 改 layer.x / layer.y（clamp 不出底圖）+ redraw
- pointerup → done

選中 layer 在 stage 顯示 1px dashed amber 框（純 DOM overlay，與 canvas 同層 absolute）。

## 6. 整合 Edit.vue（tab toggle）

`DialogLineRichmenuEdit` 圖片 section 改為兩 tab：

```
[ 上傳成品圖 (P38) | 圖層合成器 (P44b) ]
```

點「圖層合成器」tab → 顯示 RichmenuComposer；點「上傳成品圖」→ 既有 file input。

切 tab 不清資料：
- 留在 composer：layers / areas 還在
- 切回上傳：仍可上傳新圖（會清 layers + 提示「這會覆蓋既有合成」）

## 7. PATCH layers 時機

合成並上傳 success 後立刻 PATCH 一次：
```
1. upload-image 回 imageUrl → form.imageUrl 更新
2. PATCH /admin/line-richmenus/[id] body: { layers, layersTemplate? }
3. 同 dialog 內 form.areas 已隨範本套用更新（範本自帶 areas）→ admin 可再用 P44a area editor 微調
```

PATCH 失敗不阻擋（layers metadata 與圖本身解耦；admin 重編時若 doc 沒 layers fallback 為「直接上傳模式」）。

## 8. doc PATCH endpoint 擴展

`[id].patch.ts` 既有 body 加 `layers?`、`layersTemplate?`：

```typescript
// 既有 body shape
interface PatchBody {
  name?: string;
  chatBarText?: string;
  selected?: boolean;
  areas?: RichmenuArea[];
  // P44b 新增
  layers?: RichmenuLayer[];
  layersTemplate?: string;
}
```

validators：
- `validateLayers(raw, size)`：每 layer 的 type 必選；x/y/w/h 整數 + 在 size 內；可選 fields 各別驗
- 不限 layers 數量（admin 自己負責；合成超 1MB 由 client 攔截）

## 9. 風險 / fallback

- **字型 fallback**：admin 不一定有 Bebas / Barlow → composer 內 fontFamily 下拉預設 `system-ui` `serif` `sans-serif` `monospace` + 4 個 webfont（依專案 admin 端已 load 的）
- **imageUrl base64 過大**：admin 上傳 icon → toDataURL → base64 字串可能很大；存進 doc 會超 1 MiB doc 上限 → 第一版改用 Firebase Storage 上傳 icon → 取 signed URL → 存 URL 字串到 layer.imageUrl
  - **第一版簡化**：暫不支援上傳自訂 image layer（layers 只支援 text + rectangle + 範本內預設 image），等 admin 反饋後再開
- **無上傳自訂 image 簡化**：5 範本內預設的 image layer 走 emoji 或純色矩形代替；自訂圖層 admin 仍可走「直接上傳成品圖」模式

## 10. 測試範圍

純前端 + 1 個 endpoint 擴 body field，不寫 unit test；手測：

| 場景 | 預期 |
|---|---|
| 切到「圖層合成器」tab | preview canvas 顯示空白 2500×1686 底色 |
| 套用 grid-2x2-iconLabel 範本 | layers list 出現 4-5 個 layer（rectangle + text）；preview 顯示 4 等分 |
| 點 list 中的 text layer | inspector 顯示 text / fontSize / color 等欄位 |
| 改 text 內容 → preview 即時更新 | preview 文字同步 |
| canvas 拖某 layer | layer x/y 即時改 + preview 重畫 |
| 「合成並上傳」 | server 收到 PNG，sync 成功，imageUrl 更新 |
| 上傳超 1MB | 警告 + 顯示 JPEG 重試按鈕 |
| 範本切 compact-3btn | imageSize 變 2500×843，confirm 後切換 |

## 11. 決策紀錄

### 2026-05-15 — Brain AI 拍板（推 spec 預設）

| Q | 拍板 | 為什麼 |
|---|---|---|
| Q1 | 1a Client canvas | 純前端足夠；避免 sharp/node-canvas server 依賴 |
| Q2 | 2b doc 加 layers field | 後續可重編比重做整圖友善；schema 開 opt-in 不破壞既有 |
| Q4 | 4b 5 個範本 | 平衡易用 + 不過度 |

**簡化 scope（implementation 期間決策）**：
- **不支援自訂 image upload 圖層**（doc 1 MiB 上限風險 + Storage 上傳路徑要新開）：範本內預設用 emoji / rectangle 代替；admin 若需自訂圖，走「直接上傳成品圖」既有路徑
- **canvas 互動簡化版**：只 click + 拖移，不做 resize handle / multi-select（與 area editor 角色分離）

**Brain AI 指令節錄**：「直接做完，有需要我拍板的，就直接照你預設即可。要問我 allow 或 permission 的直接都 allow」。
