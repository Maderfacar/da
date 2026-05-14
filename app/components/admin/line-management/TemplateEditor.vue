<script setup lang="ts">
// P38 Phase 4：通用 Flex Template 編輯器
//
// 用法：父頁 /admin/line-management Templates tab 傳入 templateKey；本元件自動載入 detail + 編輯 + 儲存。
//
// 與 A1 NotificationTemplate.vue 差異：
//   - templateKey 動態（非寫死 order-pending）
//   - placeholder chip 從 registry 來
//   - ctaButton.action 三型別（uri / message / postback）
//   - enabled toggle（false 時推送 fallback i18n text）
//   - 預覽：cream theme mockup
import type {
  NotificationTemplateDetailRes,
  PlaceholderDef,
  TemplateAction,
  TemplateCtaButton,
} from '@/protocol/fetch-api/api/admin/notification-template';
import type { LinePostbackWhitelistItem } from '@/protocol/fetch-api/api/admin';

interface Props {
  templateKey: string;
}
const props = defineProps<Props>();
const emit = defineEmits<{ saved: [] }>();

const TITLE_MAX = 60;
const BODY_MAX = 1000;
const LABEL_MAX = 20;
const URL_MAX = 500;
const TEXT_MAX = 300;
const DATA_MAX = 300;

// ── 表單狀態 ─────────────────────────────────────────────────
const detail = ref<NotificationTemplateDetailRes | null>(null);
const loading = ref(false);
const submitting = ref(false);
const uploadingCover = ref(false);
const coverInputRef = ref<HTMLInputElement | null>(null);
const titleInputRef = ref<HTMLInputElement | null>(null);
const bodyInputRef = ref<HTMLTextAreaElement | null>(null);
const lastFocusedInput = ref<'title' | 'body' | null>(null);

const form = reactive({
  title: '',
  body: '',
  coverImageUrl: null as string | null,
  enabled: true,
  ctaEnabled: false,
  ctaLabel: '',
  ctaActionType: 'uri' as 'uri' | 'message' | 'postback',
  ctaUri: '',
  ctaMessage: '',
  ctaPostback: '',
  ctaPostbackDisplay: '',
});

const placeholders = computed<PlaceholderDef[]>(() => detail.value?.meta.placeholders ?? []);

// ── 載入 detail ─────────────────────────────────────────────
const ApiLoadDetail = async () => {
  loading.value = true;
  try {
    const res = await $api.GetNotificationTemplate(props.templateKey);
    if (res.status.code !== 200 || !res.data) {
      ElMessage({ message: res.status.message?.zh_tw || '載入失敗', type: 'error' });
      return;
    }
    detail.value = res.data;
    const c = res.data.content;
    const meta = res.data.meta;
    form.title = c?.title ?? meta.defaultContent.title;
    form.body = c?.body ?? meta.defaultContent.body;
    form.coverImageUrl = c?.coverImageUrl ?? null;
    form.enabled = res.data.enabled;
    if (c?.ctaButton) {
      form.ctaEnabled = true;
      form.ctaLabel = c.ctaButton.label;
      form.ctaActionType = c.ctaButton.action.type;
      if (c.ctaButton.action.type === 'uri') form.ctaUri = c.ctaButton.action.url;
      if (c.ctaButton.action.type === 'message') form.ctaMessage = c.ctaButton.action.text;
      if (c.ctaButton.action.type === 'postback') {
        form.ctaPostback = c.ctaButton.action.data;
        form.ctaPostbackDisplay = c.ctaButton.action.displayText ?? '';
      }
    } else {
      form.ctaEnabled = false;
      form.ctaLabel = '';
      form.ctaActionType = 'uri';
      form.ctaUri = '';
      form.ctaMessage = '';
      form.ctaPostback = '';
      form.ctaPostbackDisplay = '';
    }
  } finally {
    loading.value = false;
  }
};

watch(() => props.templateKey, () => {
  void ApiLoadDetail();
}, { immediate: true });

// ── Postback whitelist 載入（P40 Phase 1） ─────────────────
// template 不綁 channel，fetch 全部含 'both'；admin 看 channel 標籤自行選
const postbackWhitelist = ref<LinePostbackWhitelistItem[]>([]);
const postbackDataSet = computed(() => new Set(postbackWhitelist.value.map((e) => e.data)));
const IsPostbackInWhitelist = (data: string) => postbackDataSet.value.has(data);

const ApiLoadPostbackWhitelist = async () => {
  const res = await $api.GetLinePostbackWhitelist();
  if (res.status.code !== $enum.apiStatus.success || !res.data) return;
  postbackWhitelist.value = res.data.items;
};

onMounted(() => {
  void ApiLoadPostbackWhitelist();
});

// ── placeholder chip 插入 ───────────────────────────────────
const InsertPlaceholder = (key: string) => {
  const tag = `{${key}}`;
  if (lastFocusedInput.value === 'title' && titleInputRef.value) {
    _insertAtCursor(titleInputRef.value, tag, (v) => { form.title = v; });
  } else if (lastFocusedInput.value === 'body' && bodyInputRef.value) {
    _insertAtCursor(bodyInputRef.value, tag, (v) => { form.body = v; });
  } else {
    // 預設插到 body 尾
    form.body = `${form.body}${tag}`;
  }
};

const _insertAtCursor = (
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  setter: (v: string) => void,
) => {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const newVal = `${before}${text}${after}`;
  setter(newVal);
  nextTick(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
};

// ── 圖片上傳 ─────────────────────────────────────────────────
const ClickPickCover = () => coverInputRef.value?.click();

const OnCoverChange = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    ElMessage({ message: '檔案不可超過 10MB', type: 'error' });
    return;
  }
  if (!/^image\/(jpeg|jpg|png|gif)$/.test(file.type)) {
    ElMessage({ message: '僅支援 JPG / PNG / GIF', type: 'error' });
    return;
  }
  uploadingCover.value = true;
  try {
    const res = await $api.UploadNotificationTemplateCover(props.templateKey, file);
    if (res.status.code !== 200 || !res.data) {
      ElMessage({ message: res.status.message?.zh_tw || '上傳失敗', type: 'error' });
      return;
    }
    form.coverImageUrl = res.data.url;
    ElMessage({ message: '封面圖已上傳', type: 'success' });
  } finally {
    uploadingCover.value = false;
  }
};

const ClickRemoveCover = () => {
  form.coverImageUrl = null;
};

// ── 動作 ─────────────────────────────────────────────────────
interface ValidationResult { ok: boolean; error?: string }
const Validate = (): ValidationResult => {
  if (!form.title.trim() || form.title.length > TITLE_MAX) {
    return { ok: false, error: `標題需 1-${TITLE_MAX} 字` };
  }
  if (!form.body.trim() || form.body.length > BODY_MAX) {
    return { ok: false, error: `內文需 1-${BODY_MAX} 字` };
  }
  if (form.coverImageUrl && !form.coverImageUrl.startsWith('https://')) {
    return { ok: false, error: '封面圖網址必須為 HTTPS' };
  }
  if (form.ctaEnabled) {
    if (!form.ctaLabel.trim() || form.ctaLabel.length > LABEL_MAX) {
      return { ok: false, error: `按鈕標籤需 1-${LABEL_MAX} 字` };
    }
    if (form.ctaActionType === 'uri') {
      if (!form.ctaUri.startsWith('https://') || form.ctaUri.length > URL_MAX) {
        return { ok: false, error: `URI 須以 https:// 開頭，≤ ${URL_MAX}` };
      }
    }
    if (form.ctaActionType === 'message') {
      if (form.ctaMessage.length === 0 || form.ctaMessage.length > TEXT_MAX) {
        return { ok: false, error: `訊息需 1-${TEXT_MAX} 字` };
      }
    }
    if (form.ctaActionType === 'postback') {
      if (form.ctaPostback.length === 0 || form.ctaPostback.length > DATA_MAX) {
        return { ok: false, error: `Postback data 需 1-${DATA_MAX} 字` };
      }
    }
  }
  return { ok: true };
};

const _buildCtaButton = (): TemplateCtaButton | null => {
  if (!form.ctaEnabled) return null;
  let action: TemplateAction;
  if (form.ctaActionType === 'uri') {
    action = { type: 'uri', url: form.ctaUri.trim() };
  } else if (form.ctaActionType === 'message') {
    action = { type: 'message', text: form.ctaMessage };
  } else {
    action = {
      type: 'postback',
      data: form.ctaPostback,
      ...(form.ctaPostbackDisplay ? { displayText: form.ctaPostbackDisplay } : {}),
    };
  }
  return { label: form.ctaLabel.trim(), action };
};

const ClickSave = async () => {
  const v = Validate();
  if (!v.ok) {
    ElMessage({ message: v.error || '驗證失敗', type: 'error' });
    return;
  }
  submitting.value = true;
  try {
    const res = await $api.PutNotificationTemplate(props.templateKey, {
      title: form.title.trim(),
      body: form.body.trim(),
      coverImageUrl: form.coverImageUrl,
      ctaButton: _buildCtaButton(),
      enabled: form.enabled,
    });
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已儲存', type: 'success' });
    emit('saved');
    await ApiLoadDetail();
  } finally {
    submitting.value = false;
  }
};

const ClickReset = async () => {
  const ok = await UseAsk('還原為系統預設文案？這會清掉目前的封面圖與 CTA 按鈕設定。');
  if (!ok) return;
  submitting.value = true;
  try {
    const res = await $api.ResetNotificationTemplate(props.templateKey);
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '還原失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已還原為預設', type: 'success' });
    emit('saved');
    await ApiLoadDetail();
  } finally {
    submitting.value = false;
  }
};

// ── 預覽（套 placeholder example） ───────────────────────────
const _applyExamples = (text: string): string => {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const def = placeholders.value.find((p) => p.key === key);
    return def ? def.example : match;
  });
};
const previewTitle = computed(() => _applyExamples(form.title));
const previewBody = computed(() => _applyExamples(form.body));
const previewCtaLabel = computed(() => form.ctaLabel || '查看詳情');
</script>

<template lang="pug">
.TemplateEditor
  .TemplateEditor__loading(v-if="loading") 載入中...
  template(v-else-if="detail")
    //- ── meta header ────────────────────────────────────
    header.TemplateEditor__header
      .TemplateEditor__meta-row
        h3.TemplateEditor__title {{ detail.meta.displayName }}
        span.TemplateEditor__key {{ detail.meta.templateKey }}
      p.TemplateEditor__desc {{ detail.meta.description }}
      .TemplateEditor__last-edit(v-if="detail.updatedAt")
        | 最後編輯：{{ $dayjs(detail.updatedAt).format('YYYY/MM/DD HH:mm') }}
        | （by {{ detail.updatedBy || '—' }}）

    .TemplateEditor__body
      //- ── 編輯區（左） ──────────────────────────────────
      .TemplateEditor__form
        //- enabled toggle
        .TemplateEditor__field.is-row
          label
            input(type="checkbox" v-model="form.enabled")
            | &nbsp;啟用模板（取消勾選時推送 fallback 三語 text）

        //- placeholder chips
        .TemplateEditor__field(v-if="placeholders.length > 0")
          label 可用變數（點擊插入）
          .TemplateEditor__chips
            button.TemplateEditor__chip(
              v-for="p in placeholders"
              :key="p.key"
              :title="`${p.label}（範例：${p.example}）`"
              @click="InsertPlaceholder(p.key)"
            )
              code &lcub;&lcub;{{ p.key }}&rcub;&rcub;
              span.label {{ p.label }}
              span.req(v-if="p.required") *

        //- title
        .TemplateEditor__field
          label 標題（max {{ TITLE_MAX }}）
          input(
            ref="titleInputRef"
            v-model="form.title"
            type="text"
            :maxlength="TITLE_MAX"
            @focus="lastFocusedInput = 'title'"
          )
          .TemplateEditor__hint {{ form.title.length }} / {{ TITLE_MAX }}

        //- body
        .TemplateEditor__field
          label 內文（max {{ BODY_MAX }}）
          textarea(
            ref="bodyInputRef"
            v-model="form.body"
            rows="8"
            :maxlength="BODY_MAX"
            @focus="lastFocusedInput = 'body'"
          )
          .TemplateEditor__hint {{ form.body.length }} / {{ BODY_MAX }}

        //- cover image
        .TemplateEditor__field
          label 封面圖（選填）
          .TemplateEditor__cover-wrap
            input(
              ref="coverInputRef"
              type="file"
              accept="image/jpeg,image/png,image/gif"
              style="display: none"
              @change="OnCoverChange"
            )
            template(v-if="form.coverImageUrl")
              img.TemplateEditor__cover-preview(:src="form.coverImageUrl")
              .TemplateEditor__cover-actions
                button.TemplateEditor__btn.is-toggle(
                  :disabled="uploadingCover"
                  @click="ClickPickCover"
                ) {{ uploadingCover ? '上傳中...' : '更換' }}
                button.TemplateEditor__btn.is-reject(
                  :disabled="uploadingCover"
                  @click="ClickRemoveCover"
                ) 移除
            template(v-else)
              button.TemplateEditor__btn.is-toggle(
                :disabled="uploadingCover"
                @click="ClickPickCover"
              ) {{ uploadingCover ? '上傳中...' : '+ 選擇封面圖' }}
              .TemplateEditor__hint JPG / PNG / GIF，≤ 10MB，建議 1024×667 或同比例

        //- CTA button
        .TemplateEditor__field.is-row
          label
            input(type="checkbox" v-model="form.ctaEnabled")
            | &nbsp;加 CTA 按鈕

        template(v-if="form.ctaEnabled")
          .TemplateEditor__field
            label 按鈕標籤
            input(
              v-model="form.ctaLabel"
              type="text"
              :maxlength="LABEL_MAX"
              placeholder="例：查看訂單"
            )
            .TemplateEditor__hint {{ form.ctaLabel.length }} / {{ LABEL_MAX }}

          .TemplateEditor__field
            label 動作類型
            .TemplateEditor__radios
              label
                input(type="radio" v-model="form.ctaActionType" value="uri")
                | &nbsp;URI
              label
                input(type="radio" v-model="form.ctaActionType" value="message")
                | &nbsp;訊息
              label
                input(type="radio" v-model="form.ctaActionType" value="postback")
                | &nbsp;Postback

          .TemplateEditor__field(v-if="form.ctaActionType === 'uri'")
            label URI（可含 placeholder）
            input(
              v-model="form.ctaUri"
              type="text"
              :maxlength="URL_MAX"
              placeholder="https://..."
            )

          .TemplateEditor__field(v-if="form.ctaActionType === 'message'")
            label 訊息文字
            input(
              v-model="form.ctaMessage"
              type="text"
              :maxlength="TEXT_MAX"
              placeholder="點擊後送給 OA 的訊息"
            )

          template(v-if="form.ctaActionType === 'postback'")
            .TemplateEditor__field
              label Postback data
              el-select.TemplateEditor__postback-select(
                v-model="form.ctaPostback"
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
                  :label="`${opt.data} - ${opt.label}（${opt.channel === 'both' ? '雙 OA' : opt.channel === 'driver' ? '司機' : '乘客'}）`"
                )
              .TemplateEditor__warn(v-if="form.ctaPostback && !IsPostbackInWhitelist(form.ctaPostback)")
                | ⚠ "{{ form.ctaPostback }}" 不在 server whitelist；user 點擊後無對應 handler 不會收到回應。
                | 請改從下拉選 whitelist 內項目，或請開發者補 server/utils/line-postback-handlers.ts。
            .TemplateEditor__field
              label Display Text（選填）
              input(
                v-model="form.ctaPostbackDisplay"
                type="text"
                maxlength="300"
                placeholder="點擊後 user 端會看到的回顯文字"
              )

        //- actions
        .TemplateEditor__actions
          button.TemplateEditor__btn.is-toggle(
            :disabled="submitting"
            @click="ClickReset"
          ) 還原為預設
          button.TemplateEditor__btn.is-approve(
            :disabled="submitting"
            @click="ClickSave"
          ) {{ submitting ? '儲存中...' : '儲存' }}

      //- ── 預覽區（右） ──────────────────────────────────
      .TemplateEditor__preview
        .TemplateEditor__preview-label LINE Flex 預覽（變數已套範例值）
        .TemplateEditor__bubble
          img.TemplateEditor__bubble-hero(v-if="form.coverImageUrl" :src="form.coverImageUrl")
          .TemplateEditor__bubble-body
            .TemplateEditor__bubble-title {{ previewTitle }}
            .TemplateEditor__bubble-text {{ previewBody }}
          .TemplateEditor__bubble-footer(v-if="form.ctaEnabled && form.ctaLabel")
            button.TemplateEditor__bubble-cta {{ previewCtaLabel }}
        .TemplateEditor__preview-note(v-if="!form.enabled")
          | ⚠ 模板停用中：推送會 fallback 至 P37 三語 text
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$muted: rgba(0, 0, 0, 0.5);
$border: rgba(0, 0, 0, 0.1);

.TemplateEditor {
  padding: 20px;
}

.TemplateEditor__loading {
  text-align: center;
  padding: 40px;
  color: $muted;
  font-family: 'Barlow Condensed', sans-serif;
}

// ── Header ──────────────────────────────────────────────────
.TemplateEditor__header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid $border;
}

.TemplateEditor__meta-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.TemplateEditor__title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.04em;
  margin: 0;
}

.TemplateEditor__key {
  font-family: monospace;
  font-size: 11px;
  color: $muted;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  padding: 2px 8px;
}

.TemplateEditor__desc {
  font-family: 'Barlow', sans-serif;
  font-size: 12px;
  color: $muted;
  margin: 6px 0 0;
}

.TemplateEditor__last-edit {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  margin-top: 4px;
}

// ── Body ────────────────────────────────────────────────────
.TemplateEditor__body {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 24px;
}

.TemplateEditor__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.TemplateEditor__field {
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
  textarea {
    padding: 8px 12px;
    border: 1px solid $border;
    border-radius: 8px;
    font-family: 'Barlow', sans-serif;
    font-size: 14px;
    background: white;
    width: 100%;

    &:focus {
      outline: none;
      border-color: $amber;
    }
  }
  textarea {
    resize: vertical;
    min-height: 120px;
    font-family: inherit;
  }

  &.is-row {
    flex-direction: row;
    align-items: center;
    gap: 8px;

    label {
      display: flex;
      align-items: center;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: inherit;
    }
  }
}

.TemplateEditor__hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.TemplateEditor__warn {
  margin-top: 6px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $amber;
  background: rgba(212, 134, 10, 0.08);
  padding: 6px 10px;
  border-radius: 6px;
  line-height: 1.5;
}

.TemplateEditor__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.TemplateEditor__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(212, 134, 10, 0.3);
  background: rgba(212, 134, 10, 0.08);
  border-radius: 100px;
  padding: 4px 10px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgba(212, 134, 10, 0.16);
  }

  code {
    font-family: monospace;
    font-size: 11px;
    color: $amber;
  }
  .label {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: rgba(0, 0, 0, 0.65);
  }
  .req {
    color: #ef4444;
    font-weight: 700;
  }
}

.TemplateEditor__radios {
  display: flex;
  gap: 14px;

  label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    cursor: pointer;
    font-weight: 500;
    color: inherit;
  }
}

.TemplateEditor__postback-select {
  width: 100%;

  :deep(.el-select__wrapper) {
    border-radius: 8px;
    min-height: 36px;
    box-shadow: 0 0 0 1px $border;
    background: white;

    &:hover { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2); }
    &.is-focused { box-shadow: 0 0 0 1px $amber; }
  }
}

// ── Cover ───────────────────────────────────────────────────
.TemplateEditor__cover-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.TemplateEditor__cover-preview {
  max-width: 100%;
  max-height: 200px;
  border-radius: 10px;
  border: 1px solid $border;
  object-fit: cover;
}

.TemplateEditor__cover-actions {
  display: flex;
  gap: 6px;
}

// ── Buttons ─────────────────────────────────────────────────
.TemplateEditor__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid $border;
}

.TemplateEditor__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &.is-toggle {
    background: rgba(0, 0, 0, 0.04);
    border-color: $border;
    color: rgba(0, 0, 0, 0.7);
    &:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.08);
    }
  }
  &.is-approve {
    background: $amber;
    border-color: $amber;
    color: white;
    &:hover:not(:disabled) {
      background: #b8730a;
    }
  }
  &.is-reject {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.35);
    color: #ef4444;
    &:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.16);
    }
  }
}

// ── Preview ─────────────────────────────────────────────────
.TemplateEditor__preview {
  position: sticky;
  top: 20px;
  height: fit-content;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.TemplateEditor__preview-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: $amber;
}

.TemplateEditor__bubble {
  background: white;
  border: 1px solid $border;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.TemplateEditor__bubble-hero {
  display: block;
  width: 100%;
  aspect-ratio: 20 / 13;
  object-fit: cover;
}

.TemplateEditor__bubble-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.TemplateEditor__bubble-title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #222;
  line-height: 1.4;
}

.TemplateEditor__bubble-text {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: #666;
  line-height: 1.6;
  white-space: pre-wrap;
}

.TemplateEditor__bubble-footer {
  padding: 0 16px 16px;
}

.TemplateEditor__bubble-cta {
  width: 100%;
  background: $amber;
  border: none;
  color: white;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 600;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
}

.TemplateEditor__preview-note {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $amber;
  background: rgba(212, 134, 10, 0.08);
  padding: 6px 10px;
  border-radius: 6px;
}

// ── RWD ─────────────────────────────────────────────────────
@media (max-width: 900px) {
  .TemplateEditor__body {
    grid-template-columns: 1fr;
  }
  .TemplateEditor__preview {
    position: static;
  }
}
</style>
