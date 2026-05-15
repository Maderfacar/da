<script setup lang="ts">
// P38 Phase 2：LINE richmenu 編輯彈窗
//
// mode：
//   - 'create' 建草稿（POST /admin/line-richmenus）
//   - 'edit'   編輯既有 richmenu（PATCH name/chatBarText/areas/selected）
//
// 流程（create 場景）：
//   1. POST 建草稿（拿 id）
//   2. 上傳圖（POST /[id]/upload-image，server 嚴格驗 2500×1686 / 2500×843）
//   3. PATCH areas（拖拉 / grid quick set / 手動）
//   4. 儲存（PATCH chatBarText/name/selected 一併寫入）→ resolve 'saved'
//
// areas editor（P38 + P44a 升級）：
//   - 拖拉建 area（空白處 drag → 自動建 area）
//   - 8 個 resize handle（single-select 時顯示，4 角 + 4 邊）
//   - 整塊位移（area 內 drag）
//   - snap to grid / 其他 area 邊（preview 端容差 6px）
//   - 多選（Shift+click 加減 / Ctrl+drag marquee）
//   - 對齊輔助線（drag 中顯示，鬆手隱藏）
//   - 鍵盤：Delete / Esc / 方向鍵（Shift+Arrow = 10px）
//   - 既有 grid quick set + 手動 x/y/w/h 完整保留作為「進階模式」
import type {
  LineRichmenuDto,
  RichmenuAction,
  RichmenuArea,
  RichmenuLang,
  RichmenuLayer,
  RichmenuSize,
} from '@/protocol/fetch-api/api/admin/line-richmenu';
import type { LinePostbackWhitelistItem } from '@/protocol/fetch-api/api/admin';
import type { HandlePosition } from '@/composables/use-richmenu-area-editor';

interface DialogLineRichmenuEditParamsLocal {
  mode: 'create' | 'edit';
  channel: 'passenger' | 'driver';
  lang?: RichmenuLang;
  id?: string;
}

const LANG_LABEL: Record<RichmenuLang, string> = {
  zh_tw: '繁中 zh',
  en: '英文 en',
  ja: '日文 ja',
};

export type LineRichmenuEditResult = 'saved' | 'published' | 'cancelled';

interface Props {
  params: DialogLineRichmenuEditParamsLocal;
  resolve: (value: LineRichmenuEditResult) => void;
  level: number;
}
const props = defineProps<Props>();
const emit = defineEmits<{ 'on-close': [] }>();

// ── 限制常數（與 server validators 對齊） ────────────────────
const NAME_MAX = 100;
const CHAT_BAR_TEXT_MAX = 14;
const AREAS_MAX = 20;
const URI_MAX = 1000;
const MESSAGE_TEXT_MAX = 300;
const POSTBACK_DATA_MAX = 300;
const ACTION_LABEL_MAX = 20;

const VALID_SIZES: RichmenuSize[] = [
  { width: 2500, height: 1686 },
  { width: 2500, height: 843 },
];

// ── 表單狀態 ─────────────────────────────────────────────────
const draftId = ref<string>(''); // create 模式建立成功後設值
const form = reactive({
  name: '',
  // P42：lang 對應 doc.lang；create 模式可從 params.lang 帶入預設值（user 仍可在彈窗內改）；
  // edit 模式由 ApiLoadDetail 從 server 既有 doc 覆蓋（readonly 顯示）
  lang: (props.params.lang ?? 'zh_tw') as RichmenuLang,
  chatBarText: '',
  selected: true,
  imageUrl: null as string | null,
  imageSize: null as RichmenuSize | null,
  imageBytes: 0,
  areas: [] as RichmenuArea[],
  // P44b：圖層合成器 metadata
  layers: [] as RichmenuLayer[],
  layersTemplate: null as string | null,
});

// P44b：圖片來源 tab toggle（'upload' = 直接上傳成品圖；'compose' = 圖層合成器）
const imageMode = ref<'upload' | 'compose'>('upload');

const loading = ref(false);   // 載入 detail
const submitting = ref(false); // 儲存中
const uploading = ref(false);
const imageInputRef = ref<HTMLInputElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);

// ── 預覽：image scale（P44a：上移至 editor 之前） ────────────
const previewMaxWidth = 480;
const previewScale = computed(() => {
  if (!form.imageSize) return 1;
  return previewMaxWidth / form.imageSize.width;
});
const previewHeight = computed(() => {
  if (!form.imageSize) return 0;
  return form.imageSize.height * previewScale.value;
});

// ── P44a：area editor 互動 composable ─────────────────────
const areasRef = computed({
  get: () => form.areas,
  set: (v) => { form.areas = v; },
});
const imageSizeRef = computed(() => form.imageSize);

const editor = useRichmenuAreaEditor({
  imageSize: imageSizeRef,
  previewScale,
  areas: areasRef,
  stageRef,
  maxAreas: AREAS_MAX,
});

const selectedIndices = editor.selectedIndices;
const primarySelectedIdx = editor.primarySelectedIndex;
const transientRect = editor.transientRect;
const marqueeRect = editor.marqueeRect;
const guideLines = editor.guides;

const HANDLE_LIST: HandlePosition[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// P40 Phase 1：postback whitelist 下拉選項（依本 dialog 的 channel 過濾）
const postbackWhitelist = ref<LinePostbackWhitelistItem[]>([]);
const postbackDataSet = computed(() => new Set(postbackWhitelist.value.map((e) => e.data)));
const IsPostbackInWhitelist = (data: string) => postbackDataSet.value.has(data);

// ── 載入 detail（edit mode） ─────────────────────────────────
const ApiLoadDetail = async () => {
  if (props.params.mode === 'create' || !props.params.id) return;
  loading.value = true;
  try {
    const res = await $api.GetLineRichmenu(props.params.id);
    if (res.status.code !== 200 || !res.data) {
      ElMessage({ message: res.status.message?.zh_tw || '載入 richmenu 失敗', type: 'error' });
      emit('on-close');
      props.resolve('cancelled');
      return;
    }
    const m = res.data;
    draftId.value = m.id;
    form.name = m.name;
    form.lang = m.lang;
    form.chatBarText = m.chatBarText;
    form.selected = m.selected;
    form.imageUrl = m.imageUrl;
    form.imageSize = m.imageSize;
    form.imageBytes = m.imageBytes ?? 0;
    form.areas = JSON.parse(JSON.stringify(m.areas)) as RichmenuArea[];
    // P44b：載入 layers / layersTemplate（既有 doc 可能無此 field）
    form.layers = Array.isArray(m.layers) ? JSON.parse(JSON.stringify(m.layers)) : [];
    form.layersTemplate = m.layersTemplate ?? null;
    if (form.layers.length > 0) imageMode.value = 'compose';
  } finally {
    loading.value = false;
  }
};

// ── 確保 draft 存在（create 模式第一次操作前 POST 建草稿） ──
const EnsureDraft = async (): Promise<boolean> => {
  if (draftId.value) return true;
  if (!form.name.trim()) {
    ElMessage({ message: '請先輸入名稱', type: 'warning' });
    return false;
  }
  const res = await $api.CreateLineRichmenu({
    channel: props.params.channel,
    lang: form.lang,
    name: form.name.trim(),
    chatBarText: form.chatBarText.trim() || undefined,
    selected: form.selected,
  });
  if (res.status.code !== 200 || !res.data) {
    ElMessage({ message: res.status.message?.zh_tw || '建立草稿失敗', type: 'error' });
    return false;
  }
  draftId.value = res.data.id;
  return true;
};

// ── 切換到合成器 tab ────────────────────────────────────────
// P44b-FU3：composer 需要 draftId 才能 render（v-if），create 模式必須先建草稿。
// 沒填 name 時按鈕 disabled，不會走到這。
const ClickComposeMode = async () => {
  imageMode.value = 'compose';
  if (!draftId.value) await EnsureDraft();
};

// ── 圖片上傳 ─────────────────────────────────────────────────
const ClickPickImage = async () => {
  if (!await EnsureDraft()) return;
  imageInputRef.value?.click();
};

const OnImageChange = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;

  if (file.size > 1 * 1024 * 1024) {
    ElMessage({ message: '檔案不可超過 1MB（LINE 限制）', type: 'error' });
    return;
  }
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    ElMessage({ message: '僅支援 PNG / JPEG', type: 'error' });
    return;
  }

  uploading.value = true;
  try {
    const res = await $api.UploadLineRichmenuImage(draftId.value, file);
    if (res.status.code !== 200 || !res.data) {
      ElMessage({ message: res.status.message?.zh_tw || '上傳失敗', type: 'error' });
      return;
    }
    form.imageUrl = res.data.url;
    form.imageSize = { width: 2500, height: res.data.height as 1686 | 843 };
    form.imageBytes = res.data.sizeBytes;
    // 換圖後既有 areas 仍可能對齊（兩種尺寸寬都 2500），但高度不同時要重審
    ElMessage({ message: `圖片上傳成功（${res.data.width}×${res.data.height}）`, type: 'success' });
  } finally {
    uploading.value = false;
  }
};

// ── Areas：grid quick set ───────────────────────────────────
const GridPresets: Array<{ key: string; label: string; cols: number; rows: number }> = [
  { key: '1x1', label: '1×1', cols: 1, rows: 1 },
  { key: '2x1', label: '2×1', cols: 2, rows: 1 },
  { key: '3x1', label: '3×1', cols: 3, rows: 1 },
  { key: '2x2', label: '2×2', cols: 2, rows: 2 },
  { key: '3x2', label: '3×2', cols: 3, rows: 2 },
  { key: '2x3', label: '2×3', cols: 2, rows: 3 },
];

const ClickApplyGrid = async (cols: number, rows: number) => {
  if (!form.imageSize) {
    ElMessage({ message: '請先上傳圖片', type: 'warning' });
    return;
  }
  const ok = form.areas.length > 0
    ? await UseAsk(`套用 ${cols}×${rows} 將取代目前 ${form.areas.length} 個區塊，是否繼續？`)
    : true;
  if (!ok) return;

  const cellW = Math.floor(form.imageSize.width / cols);
  const cellH = Math.floor(form.imageSize.height / rows);
  const areas: RichmenuArea[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      areas.push({
        bounds: {
          x: c * cellW,
          y: r * cellH,
          width: cellW,
          height: cellH,
        },
        action: { type: 'message', text: `區塊 ${areas.length + 1}` },
      });
    }
  }
  form.areas = areas;
  selectedIndices.value = new Set([0]);
};

// ── Areas：手動 ──────────────────────────────────────────────
const ClickAddArea = () => {
  if (form.areas.length >= AREAS_MAX) {
    ElMessage({ message: `最多 ${AREAS_MAX} 個區塊`, type: 'warning' });
    return;
  }
  if (!form.imageSize) {
    ElMessage({ message: '請先上傳圖片', type: 'warning' });
    return;
  }
  form.areas.push({
    bounds: { x: 0, y: 0, width: 500, height: 500 },
    action: { type: 'message', text: `區塊 ${form.areas.length + 1}` },
  });
  selectedIndices.value = new Set([form.areas.length - 1]);
};

const ClickRemoveArea = (idx: number) => {
  form.areas.splice(idx, 1);
  const next = new Set<number>();
  selectedIndices.value.forEach((i) => {
    if (i < idx) next.add(i);
    else if (i > idx) next.add(i - 1);
  });
  selectedIndices.value = next;
};

const OnActionTypeChange = (idx: number, type: 'uri' | 'message' | 'postback') => {
  const a = form.areas[idx];
  if (!a) return;
  if (type === 'uri') a.action = { type: 'uri', uri: 'https://' };
  if (type === 'message') a.action = { type: 'message', text: '' };
  if (type === 'postback') a.action = { type: 'postback', data: '' };
};

// ── 驗證 ─────────────────────────────────────────────────────
interface ValidationResult { ok: boolean; error?: string }
const ValidateForm = (): ValidationResult => {
  if (!form.name.trim() || form.name.length > NAME_MAX) {
    return { ok: false, error: `名稱必須為 1-${NAME_MAX} 字` };
  }
  if (form.chatBarText.trim().length === 0 || form.chatBarText.length > CHAT_BAR_TEXT_MAX) {
    return { ok: false, error: `chatBarText 必須為 1-${CHAT_BAR_TEXT_MAX} 字` };
  }
  if (!form.imageUrl || !form.imageSize) {
    return { ok: false, error: '請先上傳圖片' };
  }
  if (form.areas.length === 0) {
    return { ok: false, error: 'areas 至少要 1 個' };
  }
  if (form.areas.length > AREAS_MAX) {
    return { ok: false, error: `areas 不可超過 ${AREAS_MAX} 個` };
  }
  for (let i = 0; i < form.areas.length; i += 1) {
    const a = form.areas[i]!;
    const b = a.bounds;
    if (!Number.isInteger(b.x) || !Number.isInteger(b.y) || !Number.isInteger(b.width) || !Number.isInteger(b.height)) {
      return { ok: false, error: `區塊 ${i + 1}：座標必須為整數` };
    }
    if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0) {
      return { ok: false, error: `區塊 ${i + 1}：座標數值不合法` };
    }
    if (b.x + b.width > form.imageSize.width || b.y + b.height > form.imageSize.height) {
      return { ok: false, error: `區塊 ${i + 1}：超出圖片尺寸` };
    }
    const ac = a.action;
    if (ac.type === 'uri') {
      if (!ac.uri.startsWith('https://') && !ac.uri.startsWith('line://')) {
        return { ok: false, error: `區塊 ${i + 1}：URL 須以 https:// 或 line:// 開頭` };
      }
      if (ac.uri.length > URI_MAX) return { ok: false, error: `區塊 ${i + 1}：URL 過長` };
    }
    if (ac.type === 'message') {
      if (ac.text.length === 0 || ac.text.length > MESSAGE_TEXT_MAX) {
        return { ok: false, error: `區塊 ${i + 1}：訊息必須 1-${MESSAGE_TEXT_MAX} 字` };
      }
    }
    if (ac.type === 'postback') {
      if (ac.data.length === 0 || ac.data.length > POSTBACK_DATA_MAX) {
        return { ok: false, error: `區塊 ${i + 1}：postback data 必須 1-${POSTBACK_DATA_MAX} 字` };
      }
    }
  }
  return { ok: true };
};

// ── 儲存 ─────────────────────────────────────────────────────
const ClickSave = async () => {
  const v = ValidateForm();
  if (!v.ok) {
    ElMessage({ message: v.error || '驗證失敗', type: 'error' });
    return;
  }
  if (!await EnsureDraft()) return;
  submitting.value = true;
  try {
    const res = await $api.PatchLineRichmenu(draftId.value, {
      name: form.name.trim(),
      chatBarText: form.chatBarText.trim(),
      selected: form.selected,
      areas: form.areas,
      // P44b：寫 layers / layersTemplate（純 admin metadata，不影響 LINE 推送）
      layers: form.layers.length > 0 ? form.layers : undefined,
      layersTemplate: form.layersTemplate ?? undefined,
    });
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已儲存', type: 'success' });
    emit('on-close');
    props.resolve('saved');
  } finally {
    submitting.value = false;
  }
};

const ClickCancel = () => {
  emit('on-close');
  props.resolve('cancelled');
};

// ── Postback whitelist 載入（P40 Phase 1） ─────────────────
const ApiLoadPostbackWhitelist = async () => {
  const res = await $api.GetLinePostbackWhitelist({ channel: props.params.channel });
  if (res.status.code !== $enum.apiStatus.success || !res.data) return;
  postbackWhitelist.value = res.data.items;
};

// ── 初始化 ───────────────────────────────────────────────────
onMounted(() => {
  void ApiLoadDetail();
  void ApiLoadPostbackWhitelist();
});
</script>

<template lang="pug">
.DialogLineRichmenuEdit
  .DialogLineRichmenuEdit__inner
    //- ── Header ─────────────────────────────────────────
    header.DialogLineRichmenuEdit__head
      h2.DialogLineRichmenuEdit__title
        | {{ props.params.mode === 'create' ? '新增' : '編輯' }} richmenu
        span.DialogLineRichmenuEdit__chan(:class="`is-${props.params.channel}`")
          | {{ props.params.channel === 'passenger' ? '乘客 OA' : '司機 OA' }}
        span.DialogLineRichmenuEdit__lang(:class="`is-${form.lang}`")
          | {{ LANG_LABEL[form.lang] }}
      button.DialogLineRichmenuEdit__close(@click="ClickCancel" aria-label="關閉") ✕

    //- ── Body ───────────────────────────────────────────
    .DialogLineRichmenuEdit__body(v-if="loading")
      .DialogLineRichmenuEdit__loading 載入中...
    .DialogLineRichmenuEdit__body(v-else)

      //- 基本資訊
      section.DialogLineRichmenuEdit__section
        h3.DialogLineRichmenuEdit__section-title 基本資訊

        //- P42：lang select（create 必選 + 仍可改；edit 模式 readonly，由 server doc 鎖定）
        .DialogLineRichmenuEdit__field
          label 語系（{{ props.params.mode === 'edit' ? '建立後不可修改' : '不同語系獨立發佈；user 依 users.lang 自動綁對應版' }}）
          select(v-model="form.lang" :disabled="props.params.mode === 'edit' || !!draftId")
            option(value="zh_tw") 繁體中文（zh_tw）
            option(value="en") English（en）
            option(value="ja") 日本語（ja）
          .DialogLineRichmenuEdit__hint(v-if="!draftId && props.params.mode === 'create'")
            | 草稿建立後 lang 鎖定，需新建草稿才能換語系
          .DialogLineRichmenuEdit__hint(v-else-if="draftId || props.params.mode === 'edit'")
            | {{ LANG_LABEL[form.lang] }}（不可修改）

        .DialogLineRichmenuEdit__field
          label 名稱（admin 用，user 看不到）
          input(
            v-model="form.name"
            type="text"
            :maxlength="NAME_MAX"
            placeholder="例：乘客主選單 v1"
          )
          .DialogLineRichmenuEdit__hint {{ form.name.length }} / {{ NAME_MAX }}

        .DialogLineRichmenuEdit__field
          label chatBarText（OA chat 底部那條字）
          input(
            v-model="form.chatBarText"
            type="text"
            :maxlength="CHAT_BAR_TEXT_MAX"
            placeholder="例：選單"
          )
          .DialogLineRichmenuEdit__hint {{ form.chatBarText.length }} / {{ CHAT_BAR_TEXT_MAX }} 字

        .DialogLineRichmenuEdit__field.is-row
          label
            input(type="checkbox" v-model="form.selected")
            | &nbsp;預設展開（user 打開 OA 直接看到選單）

      //- 圖片
      section.DialogLineRichmenuEdit__section
        h3.DialogLineRichmenuEdit__section-title 圖片
        //- P44b：來源切換 tab
        .DialogLineRichmenuEdit__image-tabs
          button.DialogLineRichmenuEdit__btn.is-toggle.is-mini(
            :class="{ 'is-active': imageMode === 'upload' }"
            @click="imageMode = 'upload'"
          ) 直接上傳成品圖
          button.DialogLineRichmenuEdit__btn.is-toggle.is-mini(
            :class="{ 'is-active': imageMode === 'compose' }"
            @click="ClickComposeMode"
            :disabled="!draftId && !form.name.trim()"
          ) 🎨 圖層合成器
          span.DialogLineRichmenuEdit__hint(v-if="!draftId && !form.name.trim()")
            | 先填名稱才能用合成器
        .DialogLineRichmenuEdit__hint(v-if="imageMode === 'upload'")
          | 規格嚴格：PNG 或 JPEG，2500×1686 或 2500×843，≤ 1MB
        .DialogLineRichmenuEdit__hint(v-else)
          | P44b：用範本 / 圖層組 menu 圖，合成後自動上傳（PNG，≤ 1MB）
        .DialogLineRichmenuEdit__image-wrap
          .DialogLineRichmenuEdit__image-preview(
            v-if="form.imageUrl"
            ref="stageRef"
            @pointerdown="editor.onPointerDownStage"
            @pointermove="editor.onPointerMoveStage"
            @pointerup="editor.onPointerUpStage"
            @pointercancel="editor.onPointerCancelStage"
            :style="{ width: `${previewMaxWidth}px`, height: `${previewHeight}px` }"
          )
            img(:src="form.imageUrl" :style="{ maxWidth: `${previewMaxWidth}px` }" draggable="false")

            //- area overlay（含 8 個 resize handle）
            .DialogLineRichmenuEdit__area-overlay(
              v-for="(a, idx) in form.areas"
              :key="idx"
              :class="{ 'is-selected': selectedIndices.has(idx) }"
              :style="{ left: `${a.bounds.x * previewScale}px`, top: `${a.bounds.y * previewScale}px`, width: `${a.bounds.width * previewScale}px`, height: `${a.bounds.height * previewScale}px` }"
              @pointerdown="editor.onPointerDownArea($event, idx)"
            )
              span.label {{ idx + 1 }}
              //- 8 個 handle 只在 single-select 時對該 area 顯示
              template(v-if="selectedIndices.size === 1 && selectedIndices.has(idx)")
                .DialogLineRichmenuEdit__handle(
                  v-for="h in HANDLE_LIST"
                  :key="h"
                  :class="`is-${h}`"
                  @pointerdown.stop="editor.onPointerDownHandle($event, idx, h)"
                )

            //- 拖拉建 area 的臨時 preview rect
            .DialogLineRichmenuEdit__transient(
              v-if="transientRect"
              :style="{ left: `${transientRect.x}px`, top: `${transientRect.y}px`, width: `${transientRect.w}px`, height: `${transientRect.h}px` }"
            )

            //- Ctrl+drag marquee 框選
            .DialogLineRichmenuEdit__marquee(
              v-if="marqueeRect"
              :style="{ left: `${marqueeRect.x}px`, top: `${marqueeRect.y}px`, width: `${marqueeRect.w}px`, height: `${marqueeRect.h}px` }"
            )

            //- 對齊輔助線（drag 中顯示）
            .DialogLineRichmenuEdit__guide(
              v-for="(g, gi) in guideLines"
              :key="`g-${gi}-${g.orientation}-${g.pos}`"
              :class="`is-${g.orientation}`"
              :style="g.orientation === 'v' ? { left: `${g.pos}px` } : { top: `${g.pos}px` }"
            )

          .DialogLineRichmenuEdit__image-empty(v-else)
            span {{ imageMode === 'compose' ? '請於下方圖層合成器選範本並合成' : '尚未上傳圖片' }}

        .DialogLineRichmenuEdit__hint(v-if="form.imageUrl")
          | 操作：空白處 drag 建 area · area 內 drag 位移 · 8 把手縮放 · Shift+click 多選 · Ctrl+drag 框選 · Delete 刪 · 方向鍵 微調（Shift +10px）

        //- P44b：圖層合成器（imageMode === 'compose'）
        AdminLineManagementRichmenuComposer(
          v-if="imageMode === 'compose' && draftId"
          :draftId="draftId"
          :layers="form.layers"
          :areas="form.areas"
          :imageSize="form.imageSize"
          @update:layers="form.layers = $event"
          @update:areas="form.areas = $event"
          @update:imageSize="form.imageSize = $event"
          @template-applied="(p) => form.layersTemplate = p.key"
          @image-uploaded="(p) => { form.imageUrl = p.url; form.imageSize = { width: 2500, height: p.height as 1686 | 843 }; form.imageBytes = p.sizeBytes; }"
        )

        .DialogLineRichmenuEdit__upload-actions(v-if="imageMode === 'upload'")
          input(
            ref="imageInputRef"
            type="file"
            accept="image/png,image/jpeg"
            style="display: none"
            @change="OnImageChange"
          )
          button.DialogLineRichmenuEdit__btn.is-toggle(
            :disabled="uploading"
            @click="ClickPickImage"
          ) {{ uploading ? '上傳中...' : (form.imageUrl ? '更換圖片' : '上傳圖片') }}
          span.DialogLineRichmenuEdit__hint(v-if="form.imageSize")
            | {{ form.imageSize.width }}×{{ form.imageSize.height }} · {{ Math.round(form.imageBytes / 1024) }} KB

      //- Areas
      section.DialogLineRichmenuEdit__section
        h3.DialogLineRichmenuEdit__section-title 互動區塊 Areas（{{ form.areas.length }} / {{ AREAS_MAX }}）

        //- grid quick set
        .DialogLineRichmenuEdit__quick-grid(v-if="form.imageSize")
          span.DialogLineRichmenuEdit__hint 快速套用：
          button.DialogLineRichmenuEdit__btn.is-toggle.is-mini(
            v-for="g in GridPresets"
            :key="g.key"
            @click="ClickApplyGrid(g.cols, g.rows)"
          ) {{ g.label }}
          button.DialogLineRichmenuEdit__btn.is-toggle.is-mini(
            :disabled="form.areas.length >= AREAS_MAX"
            @click="ClickAddArea"
          ) + 手動加區塊

        .DialogLineRichmenuEdit__hint(v-else)
          | 請先上傳圖片後再設定 areas

        //- 多選 hint（≥ 2 個選中時顯示）
        .DialogLineRichmenuEdit__multi-hint(v-if="selectedIndices.size >= 2")
          | 已選 {{ selectedIndices.size }} 個區塊 — Delete 鍵刪除、方向鍵位移、Esc 取消選取

        //- areas list
        .DialogLineRichmenuEdit__areas
          .DialogLineRichmenuEdit__area-card(
            v-for="(a, idx) in form.areas"
            :key="idx"
            :class="{ 'is-selected': selectedIndices.has(idx), 'is-primary': primarySelectedIdx === idx }"
            @click="editor.selectArea(idx, $event.shiftKey)"
          )
            .DialogLineRichmenuEdit__area-head
              span.idx 區塊 {{ idx + 1 }}
              button.DialogLineRichmenuEdit__btn.is-reject.is-mini(@click.stop="ClickRemoveArea(idx)") 刪除

            .DialogLineRichmenuEdit__area-bounds
              .b
                label x
                input(v-model.number="a.bounds.x" type="number" min="0")
              .b
                label y
                input(v-model.number="a.bounds.y" type="number" min="0")
              .b
                label 寬
                input(v-model.number="a.bounds.width" type="number" min="1")
              .b
                label 高
                input(v-model.number="a.bounds.height" type="number" min="1")

            .DialogLineRichmenuEdit__area-action
              .DialogLineRichmenuEdit__action-types
                label
                  input(type="radio" :checked="a.action.type === 'uri'" @change="OnActionTypeChange(idx, 'uri')")
                  | &nbsp;URI
                label
                  input(type="radio" :checked="a.action.type === 'message'" @change="OnActionTypeChange(idx, 'message')")
                  | &nbsp;訊息
                label
                  input(type="radio" :checked="a.action.type === 'postback'" @change="OnActionTypeChange(idx, 'postback')")
                  | &nbsp;Postback

              //- uri input
              template(v-if="a.action.type === 'uri'")
                input(
                  v-model="a.action.uri"
                  type="text"
                  :maxlength="URI_MAX"
                  placeholder="https://... 或 line://..."
                )

              //- message input
              template(v-if="a.action.type === 'message'")
                input(
                  v-model="a.action.text"
                  type="text"
                  :maxlength="MESSAGE_TEXT_MAX"
                  placeholder="user 點到會送的訊息"
                )

              //- postback input（P40 Phase 1：ElSelect with allow-create）
              template(v-if="a.action.type === 'postback'")
                el-select.DialogLineRichmenuEdit__postback-select(
                  v-model="a.action.data"
                  filterable
                  allow-create
                  clearable
                  default-first-option
                  value-on-clear=""
                  placeholder="從 whitelist 選，或輸入自訂 data"
                )
                  el-option(
                    v-for="opt in postbackWhitelist"
                    :key="opt.data"
                    :value="opt.data"
                    :label="`${opt.data} - ${opt.label}`"
                  )
                .DialogLineRichmenuEdit__warn(v-if="a.action.data && !IsPostbackInWhitelist(a.action.data)")
                  | ⚠ "{{ a.action.data }}" 不在 server whitelist；user 點擊後無對應 handler 不會收到回應。
                  | 請改從下拉選 whitelist 內項目，或請開發者補 server/utils/line-postback-handlers.ts。

              //- label（共用）
              .DialogLineRichmenuEdit__action-label
                label 標籤（screen reader 用，選填）
                input(
                  v-model="a.action.label"
                  type="text"
                  :maxlength="ACTION_LABEL_MAX"
                  placeholder="例：訂車按鈕"
                )

    //- ── Footer ─────────────────────────────────────────
    footer.DialogLineRichmenuEdit__foot
      button.DialogLineRichmenuEdit__btn.is-toggle(@click="ClickCancel") 取消
      button.DialogLineRichmenuEdit__btn.is-approve(
        :disabled="submitting"
        @click="ClickSave"
      ) {{ submitting ? '儲存中...' : '儲存草稿' }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$muted: rgba(0, 0, 0, 0.5);
$border: rgba(0, 0, 0, 0.1);

.DialogLineRichmenuEdit {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.DialogLineRichmenuEdit__inner {
  background: white;
  border-radius: 16px;
  width: 100%;
  max-width: 920px;
  max-height: 92svh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

// ── Header ───────────────────────────────────────────────────
.DialogLineRichmenuEdit__head {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid $border;
  gap: 12px;
}

.DialogLineRichmenuEdit__title {
  flex: 1;
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  gap: 12px;
}

.DialogLineRichmenuEdit__chan {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  border-radius: 100px;
  padding: 3px 10px;

  &.is-passenger {
    background: rgba(37, 99, 235, 0.12);
    color: #2563eb;
  }
  &.is-driver {
    background: rgba(5, 150, 105, 0.12);
    color: #059669;
  }
}

// P42：lang badge（與 chan badge 並列）
.DialogLineRichmenuEdit__lang {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  border-radius: 100px;
  padding: 3px 10px;

  &.is-zh_tw {
    background: rgba(220, 38, 38, 0.10);
    color: #b91c1c;
  }
  &.is-en {
    background: rgba(79, 70, 229, 0.10);
    color: #4338ca;
  }
  &.is-ja {
    background: rgba(244, 114, 182, 0.12);
    color: #be185d;
  }
}

.DialogLineRichmenuEdit__close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: $muted;
  &:hover { color: black; }
}

// ── Body ─────────────────────────────────────────────────────
.DialogLineRichmenuEdit__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.DialogLineRichmenuEdit__loading {
  text-align: center;
  padding: 40px;
  color: $muted;
}

.DialogLineRichmenuEdit__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.DialogLineRichmenuEdit__section-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: $amber;
  margin: 0;
}

.DialogLineRichmenuEdit__field {
  display: flex;
  flex-direction: column;
  gap: 4px;

  label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: rgba(0, 0, 0, 0.7);
  }

  input[type='text'],
  input[type='number'] {
    padding: 8px 12px;
    border: 1px solid $border;
    border-radius: 8px;
    font-family: 'Barlow', sans-serif;
    font-size: 14px;
    width: 100%;
    background: white;

    &:focus {
      outline: none;
      border-color: $amber;
    }
  }

  &.is-row {
    flex-direction: row;
    align-items: center;
    gap: 8px;

    label {
      display: flex;
      align-items: center;
      cursor: pointer;
    }
  }
}

.DialogLineRichmenuEdit__hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  letter-spacing: 0.05em;
}

// ── 圖片 ─────────────────────────────────────────────────────
.DialogLineRichmenuEdit__image-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.DialogLineRichmenuEdit__image-wrap {
  position: relative;
}

.DialogLineRichmenuEdit__image-preview {
  position: relative;
  display: inline-block;
  border: 1px solid $border;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
  max-width: 100%;
  cursor: crosshair;
  touch-action: none;
  user-select: none;

  img {
    display: block;
    max-width: 100%;
    height: auto;
    pointer-events: none;
    user-select: none;
  }
}

.DialogLineRichmenuEdit__image-empty {
  border: 2px dashed $border;
  border-radius: 8px;
  padding: 40px;
  text-align: center;
  color: $muted;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
}

.DialogLineRichmenuEdit__area-overlay {
  position: absolute;
  border: 2px solid rgba(212, 134, 10, 0.6);
  background: rgba(212, 134, 10, 0.18);
  cursor: move;
  touch-action: none;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: rgba(212, 134, 10, 0.3);
  }
  &.is-selected {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.25);
    z-index: 10;
  }

  .label {
    position: absolute;
    top: 2px;
    left: 4px;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: white;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 100px;
    padding: 0 6px;
    pointer-events: none;
  }
}

// P44a：8 個 resize handle（single-select 才顯示）
.DialogLineRichmenuEdit__handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: white;
  border: 1.5px solid $amber;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  z-index: 11;
  touch-action: none;
  transition: transform 0.1s;

  &:hover {
    transform: scale(1.35);
  }

  &.is-nw { left: -5px; top: -5px; cursor: nwse-resize; }
  &.is-n  { left: calc(50% - 5px); top: -5px; cursor: ns-resize; }
  &.is-ne { right: -5px; top: -5px; cursor: nesw-resize; }
  &.is-e  { right: -5px; top: calc(50% - 5px); cursor: ew-resize; }
  &.is-se { right: -5px; bottom: -5px; cursor: nwse-resize; }
  &.is-s  { left: calc(50% - 5px); bottom: -5px; cursor: ns-resize; }
  &.is-sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
  &.is-w  { left: -5px; top: calc(50% - 5px); cursor: ew-resize; }
}

// P44a：拖拉建 area 中的臨時 preview rect
.DialogLineRichmenuEdit__transient {
  position: absolute;
  border: 1.5px dashed $amber;
  background: rgba(212, 134, 10, 0.12);
  pointer-events: none;
  z-index: 12;
}

// P44a：Ctrl+drag marquee 框選
.DialogLineRichmenuEdit__marquee {
  position: absolute;
  border: 1px dashed #6366f1;
  background: rgba(99, 102, 241, 0.08);
  pointer-events: none;
  z-index: 13;
}

// P44a：對齊輔助線（drag 中顯示）
.DialogLineRichmenuEdit__guide {
  position: absolute;
  background: #ec4899;
  pointer-events: none;
  opacity: 0.7;
  z-index: 14;

  &.is-v {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  &.is-h {
    left: 0;
    right: 0;
    height: 1px;
  }
}

// P44a：多選 hint banner
.DialogLineRichmenuEdit__multi-hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: rgba(99, 102, 241, 0.10);
  color: #4338ca;
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 8px;
  padding: 8px 12px;
}

.DialogLineRichmenuEdit__upload-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

// ── Areas ────────────────────────────────────────────────────
.DialogLineRichmenuEdit__quick-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.DialogLineRichmenuEdit__areas {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.DialogLineRichmenuEdit__area-card {
  border: 1px solid $border;
  border-radius: 10px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.02);
  cursor: pointer;
  transition: all 0.15s;

  &:hover { background: rgba(0, 0, 0, 0.04); }
  &.is-selected {
    border-color: $amber;
    background: rgba(212, 134, 10, 0.06);
  }
}

.DialogLineRichmenuEdit__area-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;

  .idx {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.1em;
  }
}

.DialogLineRichmenuEdit__area-bounds {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;

  .b {
    display: flex;
    flex-direction: column;
    gap: 2px;

    label {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: $muted;
    }
    input {
      width: 100%;
      padding: 5px 8px;
      border: 1px solid $border;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
    }
  }
}

.DialogLineRichmenuEdit__action-types {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;

  label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;
    cursor: pointer;
  }
}

.DialogLineRichmenuEdit__action-label {
  margin-top: 8px;

  label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    color: $muted;
    letter-spacing: 0.1em;
  }
  input {
    margin-top: 2px;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid $border;
    border-radius: 6px;
    font-size: 12px;
  }
}

.DialogLineRichmenuEdit__area-action input[type='text'] {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid $border;
  border-radius: 6px;
  font-family: 'Barlow', sans-serif;
  font-size: 13px;
}

.DialogLineRichmenuEdit__postback-select {
  width: 100%;

  :deep(.el-select__wrapper) {
    border-radius: 6px;
    min-height: 32px;
    box-shadow: 0 0 0 1px $border;
    background: white;

    &:hover { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2); }
    &.is-focused { box-shadow: 0 0 0 1px $amber; }
  }
}

.DialogLineRichmenuEdit__warn {
  margin-top: 6px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: #d4860a;
  background: rgba(212, 134, 10, 0.08);
  padding: 6px 10px;
  border-radius: 6px;
  line-height: 1.5;
}

// ── Footer ───────────────────────────────────────────────────
.DialogLineRichmenuEdit__foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid $border;
  background: rgba(0, 0, 0, 0.02);
}

.DialogLineRichmenuEdit__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-toggle {
    background: rgba(0, 0, 0, 0.04);
    border-color: $border;
    color: rgba(0, 0, 0, 0.7);
    &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.08); }
    &.is-active {
      background: $amber;
      border-color: $amber;
      color: white;
    }
  }
  &.is-approve {
    background: $amber;
    border-color: $amber;
    color: white;
    &:hover:not(:disabled) { background: #b8730a; }
  }
  &.is-reject {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.35);
    color: #ef4444;
    &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.16); }
  }
  &.is-mini {
    padding: 4px 10px;
    font-size: 11px;
  }
}
</style>
