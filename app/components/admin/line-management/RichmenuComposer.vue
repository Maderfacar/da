<script setup lang="ts">
// P44b：richmenu 圖層合成器主 component
//
// 結構：[ template 下拉 ] [ 合成並上傳 ]
//        | 左 sidebar | 中央 canvas preview | 右 inspector |
//
// 圖層 list 順序 = z-order：list 上 → canvas 下；list 下 → canvas 上
// 點 list item / 點 canvas 內 → selected → inspector 顯示 type-aware 屬性
import type {
  RichmenuArea,
  RichmenuLayer,
  RichmenuLayerType,
  RichmenuSize,
} from '@/protocol/fetch-api/api/admin/line-richmenu';
import { RICHMENU_TEMPLATES, cloneTemplate, type RichmenuTemplate } from '@/utils/richmenu-templates';

interface Props {
  draftId: string;
  layers: RichmenuLayer[];
  areas: RichmenuArea[];
  imageSize: RichmenuSize | null;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  'update:layers': [RichmenuLayer[]];
  'update:areas': [RichmenuArea[]];
  'update:imageSize': [RichmenuSize];
  /** 合成 + 上傳完成 → 通知父更新 form.imageUrl/imageSize/imageBytes */
  'image-uploaded': [{ url: string; sizeBytes: number; width: number; height: number; mime: 'image/png' | 'image/jpeg' }];
  /** 套範本後通知（記 layersTemplate key + 一併寫 areas） */
  'template-applied': [{ key: string }];
}>();

// 兩向同步 layers（父持有）
const layersRef = computed<RichmenuLayer[]>({
  get: () => props.layers,
  set: (v) => emit('update:layers', v),
});
const imageSizeRef = computed<RichmenuSize | null>(() => props.imageSize);

const composer = useRichmenuComposer({
  layers: layersRef,
  imageSize: imageSizeRef,
});

// 把 template ref 轉接到 composer.previewCanvasRef
const canvasEl = ref<HTMLCanvasElement | null>(null);
watch(canvasEl, (el) => {
  composer.previewCanvasRef.value = el;
  if (el) composer.redrawPreview();
}, { immediate: true });

const selectedTemplate = ref<string>('');
const composing = ref(false);
const exportMime = ref<'image/png' | 'image/jpeg'>('image/png');
const lastError = ref<string>('');
const lastSize = ref<number>(0);

// P44b-FU：圖層自訂圖片上傳
const uploadingLayerImage = ref(false);
const addImageInputRef = ref<HTMLInputElement | null>(null);     // sidebar 「+ 圖片」按鈕觸發
const replaceImageInputRef = ref<HTMLInputElement | null>(null); // inspector 「📁 替換」按鈕觸發

async function _uploadLayerImageFile(file: File): Promise<string | null> {
  if (!props.draftId) {
    ElMessage({ message: '請先建立 richmenu 草稿（填名稱觸發建立）', type: 'warning' });
    return null;
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage({ message: '檔案不可超過 2 MB', type: 'error' });
    return null;
  }
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowed.has(file.type)) {
    ElMessage({ message: '僅支援 PNG / JPEG / WebP', type: 'error' });
    return null;
  }
  uploadingLayerImage.value = true;
  try {
    const res = await $api.UploadLineRichmenuLayerImage(props.draftId, file);
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      ElMessage({ message: res.status?.message?.zh_tw || '上傳失敗', type: 'error' });
      return null;
    }
    return res.data.url;
  } finally {
    uploadingLayerImage.value = false;
  }
}

function ClickAddImage() {
  if (!props.draftId) {
    ElMessage({ message: '請先建立 richmenu 草稿（填名稱觸發建立）', type: 'warning' });
    return;
  }
  if (!imageSizeRef.value) {
    ElMessage({ message: '請先選範本以決定底圖尺寸', type: 'warning' });
    return;
  }
  addImageInputRef.value?.click();
}

async function OnAddImageChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;
  const url = await _uploadLayerImageFile(file);
  if (!url) return;
  composer.addLayer({ type: 'image', imageUrl: url, imageFit: 'cover' });
  ElMessage({ message: '已加入圖片圖層', type: 'success' });
}

function ClickReplaceImage() {
  if (!composer.primaryLayer.value || composer.primaryLayer.value.type !== 'image') return;
  replaceImageInputRef.value?.click();
}

async function OnReplaceImageChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;
  const layer = composer.primaryLayer.value;
  if (!layer || layer.type !== 'image') return;
  const url = await _uploadLayerImageFile(file);
  if (!url) return;
  composer.patchLayer(layer.id, { imageUrl: url });
  ElMessage({ message: '圖片已替換', type: 'success' });
}

// ── 套範本 ───────────────────────────────────────────────
async function ClickApplyTemplate() {
  if (!selectedTemplate.value) return;
  const tpl = RICHMENU_TEMPLATES.find((t) => t.key === selectedTemplate.value);
  if (!tpl) return;
  if (layersRef.value.length > 0 || props.areas.length > 0) {
    const ok = await UseAsk(`套用「${tpl.label}」會取代目前所有圖層與 areas，是否繼續？`);
    if (!ok) return;
  }
  const { layers, areas, size } = cloneTemplate(tpl);
  emit('update:layers', layers);
  emit('update:areas', areas);
  emit('update:imageSize', size);
  emit('template-applied', { key: tpl.key });
  composer.selectLayer(null);
}

// ── 加 layer ─────────────────────────────────────────────
function ClickAddRectangle() {
  composer.addLayer({ type: 'rectangle', fillColor: '#d4860a' });
}
function ClickAddText() {
  composer.addLayer({ type: 'text', text: '新文字' });
}

// ── 合成並上傳 ───────────────────────────────────────────
async function ClickComposeAndUpload() {
  if (!props.draftId) {
    ElMessage({ message: '請先建立 richmenu 草稿（填名稱觸發建立）', type: 'warning' });
    return;
  }
  if (!props.imageSize) {
    ElMessage({ message: '請先選範本（會自動帶尺寸）', type: 'warning' });
    return;
  }
  if (layersRef.value.length === 0) {
    ElMessage({ message: '至少需要 1 個圖層', type: 'warning' });
    return;
  }

  composing.value = true;
  lastError.value = '';
  try {
    const result = await composer.composeBlob(exportMime.value);
    lastSize.value = result.sizeBytes;
    if (result.oversize) {
      const mb = (result.sizeBytes / 1024 / 1024).toFixed(2);
      if (exportMime.value === 'image/png') {
        const ok = await UseAsk(`PNG 合成結果 ${mb} MB 超過 LINE 1MB 上限，是否改用 JPEG 重試？`);
        if (ok) {
          exportMime.value = 'image/jpeg';
          await ClickComposeAndUpload();
          return;
        }
        ElMessage({ message: `合成超 1MB（${mb}MB），無法上傳；建議減少圖層數`, type: 'error' });
        return;
      }
      ElMessage({ message: `合成超 1MB（${mb}MB），無法上傳`, type: 'error' });
      return;
    }
    const ext = exportMime.value === 'image/png' ? 'png' : 'jpg';
    const file = new File([result.blob], `composed.${ext}`, { type: exportMime.value });
    const res = await $api.UploadLineRichmenuImage(props.draftId, file);
    if (res.status.code !== 200 || !res.data) {
      lastError.value = res.status.message?.zh_tw || '上傳失敗';
      ElMessage({ message: lastError.value, type: 'error' });
      return;
    }
    emit('image-uploaded', {
      url: res.data.url,
      sizeBytes: res.data.sizeBytes,
      width: res.data.width,
      height: res.data.height,
      mime: res.data.mime,
    });
    ElMessage({ message: `已合成上傳（${res.data.width}×${res.data.height}, ${Math.round(res.data.sizeBytes / 1024)} KB）`, type: 'success' });
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : String(err);
    ElMessage({ message: `合成失敗：${lastError.value}`, type: 'error' });
  } finally {
    composing.value = false;
  }
}

// 切換尺寸（範本內已固定，但 admin 切自由尺寸用 — 第一版只兩種）
function ClickSwitchSize(size: RichmenuSize) {
  emit('update:imageSize', size);
}

</script>

<template lang="pug">
.RichmenuComposer
  //- ── Header ───────────────────────────────────────────
  header.RichmenuComposer__head
    .RichmenuComposer__head-left
      label.RichmenuComposer__select-label 範本：
      select.RichmenuComposer__select(v-model="selectedTemplate")
        option(value="") -- 選範本 --
        option(v-for="t in RICHMENU_TEMPLATES" :key="t.key" :value="t.key")
          | {{ t.thumb }}  {{ t.label }}  ({{ t.size.width }}×{{ t.size.height }})
      button.RichmenuComposer__btn.is-mini(:disabled="!selectedTemplate" @click="ClickApplyTemplate")
        | 套用
      span.RichmenuComposer__sep |
      .RichmenuComposer__size-toggle(v-if="imageSizeRef")
        button.RichmenuComposer__btn.is-mini(
          :class="{ 'is-active': imageSizeRef.height === 1686 }"
          @click="ClickSwitchSize({ width: 2500, height: 1686 })"
        ) 大 2500×1686
        button.RichmenuComposer__btn.is-mini(
          :class="{ 'is-active': imageSizeRef.height === 843 }"
          @click="ClickSwitchSize({ width: 2500, height: 843 })"
        ) 小 2500×843

    .RichmenuComposer__head-right
      label.RichmenuComposer__mime-label
        input(type="radio" :value="'image/png'" v-model="exportMime")
        | &nbsp;PNG
      label.RichmenuComposer__mime-label
        input(type="radio" :value="'image/jpeg'" v-model="exportMime")
        | &nbsp;JPEG
      button.RichmenuComposer__btn.is-approve(
        :disabled="composing || layersRef.length === 0"
        @click="ClickComposeAndUpload"
      ) {{ composing ? '合成中...' : '🎨 合成並上傳' }}

  //- ── Body ─────────────────────────────────────────────
  .RichmenuComposer__body
    //- 左：圖層 list
    aside.RichmenuComposer__sidebar
      h4.RichmenuComposer__section-title 圖層（{{ layersRef.length }}）
      .RichmenuComposer__layer-list
        .RichmenuComposer__layer-item(
          v-for="layer in layersRef"
          :key="layer.id"
          :class="{ 'is-selected': composer.selectedLayerId.value === layer.id }"
          @click="composer.selectLayer(layer.id)"
        )
          span.RichmenuComposer__layer-icon
            | {{ layer.type === 'rectangle' ? '▭' : layer.type === 'text' ? 'T' : '🖼️' }}
          span.RichmenuComposer__layer-name
            | {{ layer.type === 'text' ? layer.text || '(空)' : layer.type === 'image' ? (layer.imageUrl ? '圖' : '(無圖)') : '色塊' }}
          .RichmenuComposer__layer-actions
            button.RichmenuComposer__icon-btn(@click.stop="composer.moveLayerUp(layer.id)" title="上移") ▲
            button.RichmenuComposer__icon-btn(@click.stop="composer.moveLayerDown(layer.id)" title="下移") ▼
            button.RichmenuComposer__icon-btn(@click.stop="composer.duplicateLayer(layer.id)" title="複製") ⎘
            button.RichmenuComposer__icon-btn.is-reject(@click.stop="composer.removeLayer(layer.id)" title="刪除") ✕

      .RichmenuComposer__add-btns
        button.RichmenuComposer__btn.is-toggle.is-mini(@click="ClickAddRectangle") + 色塊
        button.RichmenuComposer__btn.is-toggle.is-mini(@click="ClickAddText") + 文字
        //- P44b-FU：自訂圖片上傳
        button.RichmenuComposer__btn.is-toggle.is-mini(
          :disabled="uploadingLayerImage"
          @click="ClickAddImage"
        ) {{ uploadingLayerImage ? '上傳中…' : '+ 圖片' }}
        input(
          ref="addImageInputRef"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style="display: none"
          @change="OnAddImageChange"
        )

    //- 中：canvas preview
    .RichmenuComposer__stage
      .RichmenuComposer__canvas-wrap(v-if="imageSizeRef")
        canvas.RichmenuComposer__canvas(
          ref="canvasEl"
          :width="composer.previewWidth.value"
          :height="composer.previewHeight.value"
          @pointerdown="composer.onPointerDownPreview"
          @pointermove="composer.onPointerMovePreview"
          @pointerup="composer.onPointerUpPreview"
        )
        //- 選中圖層 outline
        .RichmenuComposer__selection-box(
          v-if="composer.primaryLayer.value"
          :style="{ left: `${composer.primaryLayer.value.x * composer.previewScale.value}px`, top: `${composer.primaryLayer.value.y * composer.previewScale.value}px`, width: `${composer.primaryLayer.value.width * composer.previewScale.value}px`, height: `${composer.primaryLayer.value.height * composer.previewScale.value}px` }"
        )
      .RichmenuComposer__empty(v-else)
        span 請先選範本以決定底圖尺寸
      .RichmenuComposer__hint
        | 在 canvas 內點選圖層 / 拖移位置；右側調整其他屬性
      .RichmenuComposer__hint(v-if="lastSize > 0")
        | 最後合成大小：{{ (lastSize / 1024).toFixed(1) }} KB

    //- 右：inspector
    aside.RichmenuComposer__inspector(v-if="composer.primaryLayer.value")
      h4.RichmenuComposer__section-title 屬性 — {{ composer.primaryLayer.value.type }}

      .RichmenuComposer__field-grid
        .RichmenuComposer__field
          label x
          input(type="number" :value="composer.primaryLayer.value.x" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { x: Math.round(Number(e.target.value)) || 0 })")
        .RichmenuComposer__field
          label y
          input(type="number" :value="composer.primaryLayer.value.y" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { y: Math.round(Number(e.target.value)) || 0 })")
        .RichmenuComposer__field
          label 寬
          input(type="number" :value="composer.primaryLayer.value.width" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { width: Math.max(1, Math.round(Number(e.target.value)) || 1) })")
        .RichmenuComposer__field
          label 高
          input(type="number" :value="composer.primaryLayer.value.height" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { height: Math.max(1, Math.round(Number(e.target.value)) || 1) })")
        .RichmenuComposer__field.is-full
          label 透明度（0-1）
          input(type="number" min="0" max="1" step="0.1" :value="composer.primaryLayer.value.opacity ?? 1" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { opacity: Math.max(0, Math.min(1, Number(e.target.value))) })")

      //- 文字屬性
      template(v-if="composer.primaryLayer.value.type === 'text'")
        .RichmenuComposer__field
          label 文字
          input(type="text" :value="composer.primaryLayer.value.text ?? ''" maxlength="200" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { text: e.target.value })")
        .RichmenuComposer__field-grid
          .RichmenuComposer__field
            label 字級
            input(type="number" min="6" max="800" :value="composer.primaryLayer.value.fontSize ?? 120" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { fontSize: Math.max(6, Math.min(800, Math.round(Number(e.target.value)) || 6)) })")
          .RichmenuComposer__field
            label 字重
            select(:value="composer.primaryLayer.value.fontWeight ?? 600" @change="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { fontWeight: Number(e.target.value) as 400 | 600 | 700 })")
              option(:value="400") 400
              option(:value="600") 600
              option(:value="700") 700
          .RichmenuComposer__field
            label 顏色
            input(type="color" :value="composer.primaryLayer.value.color ?? '#000000'" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { color: e.target.value })")
          .RichmenuComposer__field
            label 字型
            select(:value="composer.primaryLayer.value.fontFamily ?? 'system-ui'" @change="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { fontFamily: e.target.value })")
              option(value='system-ui, "Noto Sans TC", sans-serif') 系統無襯線
              option(value='Georgia, "Noto Serif TC", serif') 系統襯線
              option(value="monospace") 等寬
              option(value='"Bebas Neue", sans-serif') Bebas Neue
              option(value='"Barlow Condensed", sans-serif') Barlow Condensed
          .RichmenuComposer__field
            label 對齊
            select(:value="composer.primaryLayer.value.align ?? 'center'" @change="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { align: e.target.value as any })")
              option(value="left") 左
              option(value="center") 中
              option(value="right") 右
          .RichmenuComposer__field
            label 垂直
            select(:value="composer.primaryLayer.value.vAlign ?? 'middle'" @change="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { vAlign: e.target.value as any })")
              option(value="top") 上
              option(value="middle") 中
              option(value="bottom") 下

      //- 矩形屬性
      template(v-if="composer.primaryLayer.value.type === 'rectangle'")
        .RichmenuComposer__field-grid
          .RichmenuComposer__field
            label 填色
            input(type="color" :value="composer.primaryLayer.value.fillColor ?? '#d4860a'" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { fillColor: e.target.value })")
          .RichmenuComposer__field
            label 邊色
            input(type="color" :value="composer.primaryLayer.value.borderColor ?? '#000000'" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { borderColor: e.target.value })")
          .RichmenuComposer__field
            label 邊寬
            input(type="number" min="0" max="200" :value="composer.primaryLayer.value.borderWidth ?? 0" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { borderWidth: Math.max(0, Math.min(200, Math.round(Number(e.target.value)) || 0)) })")
          .RichmenuComposer__field
            label 圓角
            input(type="number" min="0" max="1000" :value="composer.primaryLayer.value.radius ?? 0" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { radius: Math.max(0, Math.min(1000, Math.round(Number(e.target.value)) || 0)) })")

      //- 圖片屬性
      template(v-if="composer.primaryLayer.value.type === 'image'")
        .RichmenuComposer__field
          label 圖片來源
          .RichmenuComposer__image-source
            button.RichmenuComposer__btn.is-toggle.is-mini(
              :disabled="uploadingLayerImage"
              @click="ClickReplaceImage"
            ) {{ uploadingLayerImage ? '上傳中…' : '📁 上傳替換' }}
            input(
              ref="replaceImageInputRef"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style="display: none"
              @change="OnReplaceImageChange"
            )
        .RichmenuComposer__field
          label 圖片 URL（可手動貼外部連結覆蓋）
          input(type="text" :value="composer.primaryLayer.value.imageUrl ?? ''" maxlength="2048" @input="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { imageUrl: e.target.value })")
        .RichmenuComposer__field
          label 填法
          select(:value="composer.primaryLayer.value.imageFit ?? 'cover'" @change="(e: any) => composer.patchLayer(composer.primaryLayer.value!.id, { imageFit: e.target.value as any })")
            option(value="cover") cover（裁切填滿）
            option(value="contain") contain（完整顯示）
            option(value="fill") fill（拉伸）

    aside.RichmenuComposer__inspector.is-empty(v-else)
      .RichmenuComposer__hint 點圖層或在 canvas 內點區塊以選中
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$border: rgba(0, 0, 0, 0.1);
$muted: rgba(0, 0, 0, 0.5);

.RichmenuComposer {
  border: 1px solid $border;
  border-radius: 12px;
  background: white;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.RichmenuComposer__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid $border;
  background: rgba(0, 0, 0, 0.02);
  flex-wrap: wrap;
}
.RichmenuComposer__head-left,
.RichmenuComposer__head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.RichmenuComposer__sep { color: $muted; }
.RichmenuComposer__select-label,
.RichmenuComposer__mime-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.7);
}
.RichmenuComposer__select {
  padding: 5px 10px;
  border: 1px solid $border;
  border-radius: 6px;
  font-size: 13px;
  background: white;
  min-width: 220px;
}

.RichmenuComposer__body {
  display: grid;
  grid-template-columns: 200px 1fr 260px;
  gap: 0;
  min-height: 360px;
}

.RichmenuComposer__sidebar,
.RichmenuComposer__inspector {
  padding: 12px;
  border-right: 1px solid $border;
  background: rgba(0, 0, 0, 0.015);
  overflow-y: auto;
  max-height: 540px;
}
.RichmenuComposer__inspector {
  border-right: none;
  border-left: 1px solid $border;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &.is-empty {
    justify-content: center;
    align-items: center;
    text-align: center;
  }
}

.RichmenuComposer__section-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: $amber;
  margin: 0 0 8px;
}

.RichmenuComposer__layer-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.RichmenuComposer__layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  background: white;

  &:hover { background: rgba(0, 0, 0, 0.04); }
  &.is-selected {
    border-color: $amber;
    background: rgba(212, 134, 10, 0.08);
  }
}
.RichmenuComposer__layer-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.RichmenuComposer__layer-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.RichmenuComposer__layer-actions {
  display: flex;
  gap: 2px;
}
.RichmenuComposer__icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 11px;
  color: $muted;
  border-radius: 3px;

  &:hover { background: rgba(0, 0, 0, 0.06); color: black; }
  &.is-reject:hover { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
}

.RichmenuComposer__add-btns {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.RichmenuComposer__image-source {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.RichmenuComposer__stage {
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: repeating-conic-gradient(rgba(0, 0, 0, 0.03) 0% 25%, white 0% 50%) 50% / 16px 16px;
}

.RichmenuComposer__canvas-wrap {
  position: relative;
  display: inline-block;
  background: white;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.RichmenuComposer__canvas {
  display: block;
  cursor: move;
  touch-action: none;
}

.RichmenuComposer__selection-box {
  position: absolute;
  border: 1.5px dashed $amber;
  pointer-events: none;
  z-index: 5;
}

.RichmenuComposer__empty {
  padding: 40px;
  color: $muted;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
}

.RichmenuComposer__hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  letter-spacing: 0.05em;
}

.RichmenuComposer__field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.RichmenuComposer__field {
  display: flex;
  flex-direction: column;
  gap: 2px;

  &.is-full { grid-column: 1 / -1; }

  label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    color: $muted;
    letter-spacing: 0.1em;
  }
  input,
  select {
    padding: 5px 8px;
    border: 1px solid $border;
    border-radius: 5px;
    font-size: 12px;
    background: white;

    &:focus {
      outline: none;
      border-color: $amber;
    }
  }
  input[type='color'] {
    height: 28px;
    padding: 2px;
    cursor: pointer;
  }
}

.RichmenuComposer__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-mini {
    padding: 4px 10px;
    font-size: 10px;
  }
  &.is-active {
    background: $amber;
    border-color: $amber;
    color: white;
  }
  &.is-toggle {
    background: rgba(0, 0, 0, 0.04);
    border-color: $border;
    color: rgba(0, 0, 0, 0.7);
    &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.08); }
  }
  &.is-approve {
    background: $amber;
    border-color: $amber;
    color: white;
    padding: 7px 16px;
    font-size: 12px;
    &:hover:not(:disabled) { background: #b8730a; }
  }
}
</style>
