<script setup lang="ts">
// Wave 3-A1：訂單建立通知模板編輯區
//
// 設計：
//   - 表單：title / body / coverImageUrl / ctaButton.{label, url}
//   - 變數 chip 列：點擊插入 placeholder 到 focus 的 input cursor 位置
//   - 圖片上傳：沿用 announcement upload-cover endpoint（admin 之間以 lineUid 隔離）
//   - 右側 LINE Flex 即時預覽（placeholder 用範例值渲染）
//   - 還原預設：清掉 cover/CTA，title/body 填繁中預設文案
//
// 三語：模板只存繁中（design.md §5），admin 介面也只繁中（沿用 P37 admin policy）
import type { OrderPendingTemplate } from '@/protocol/fetch-api/api/admin';

interface FormState {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaLabel: string;
  ctaUrl: string;
}

const PLACEHOLDERS = [
  { key: '{date}',    sample: '2026-05-15 14:30',     hint: '用車日期時間' },
  { key: '{pickup}',  sample: '桃園機場第一航廈',     hint: '上車地點' },
  { key: '{vehicle}', sample: '豪華轎車',             hint: '車型名稱' },
  { key: '{fare}',    sample: '1,800',                hint: '預估車資（NT$）' },
  { key: '{orderId}', sample: 'ABCD1234',             hint: '訂單編號短碼' },
];

const DEFAULT_TITLE = '📝 訂單已建立';
const DEFAULT_BODY = '您的訂單已送出，正在媒合司機。\n📅 {date}\n📍 {pickup}\n🚗 {vehicle}\n💰 NT$ {fare}\n🔖 {orderId}';

const form = reactive<FormState>({
  title: DEFAULT_TITLE,
  body: DEFAULT_BODY,
  coverImageUrl: null,
  ctaLabel: '',
  ctaUrl: '',
});

const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const lastFocusedField = ref<'title' | 'body' | 'ctaUrl' | null>(null);
const titleRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const bodyRef = ref<HTMLTextAreaElement | null>(null);
const ctaUrlRef = ref<HTMLInputElement | null>(null);

// ── 載入 ──────────────────────────────────────────────
const ApiLoad = async () => {
  loading.value = true;
  try {
    const res = await $api.GetOrderPendingTemplate();
    if (res.status?.code !== 200) {
      console.error('[settings/notification-template] load failed:', res.status?.message?.zh_tw);
      return;
    }
    const data = res.data as OrderPendingTemplate | null;
    if (!data) return; // 未設定 → 維持預設 form 值
    form.title = data.title;
    form.body = data.body;
    form.coverImageUrl = data.coverImageUrl;
    form.ctaLabel = data.ctaButton?.label ?? '';
    form.ctaUrl = data.ctaButton?.url ?? '';
  } finally {
    loading.value = false;
  }
};

// ── 變數 chip 插入 ───────────────────────────────────
const _InsertAtCursor = (
  el: HTMLInputElement | HTMLTextAreaElement | null,
  placeholder: string,
  modelKey: 'title' | 'body' | 'ctaUrl',
) => {
  if (!el) return;
  const start = el.selectionStart ?? form[modelKey].length;
  const end = el.selectionEnd ?? start;
  const current = form[modelKey];
  const next = current.slice(0, start) + placeholder + current.slice(end);
  form[modelKey] = next;
  // 等 DOM 更新後將 cursor 移到插入後位置
  nextTick(() => {
    el.focus();
    const pos = start + placeholder.length;
    el.setSelectionRange(pos, pos);
  });
};

const ClickInsertPlaceholder = (placeholder: string) => {
  const target = lastFocusedField.value ?? 'body';
  if (target === 'title') _InsertAtCursor(titleRef.value, placeholder, 'title');
  else if (target === 'ctaUrl') _InsertAtCursor(ctaUrlRef.value, placeholder, 'ctaUrl');
  else _InsertAtCursor(bodyRef.value, placeholder, 'body');
};

// ── 圖片上傳（沿用 announcement upload-cover endpoint）─
const ClickUploadCover = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const res = await $api.UploadAdminAnnouncementCover(file);
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '上傳失敗', type: 'error' });
      return;
    }
    form.coverImageUrl = res.data?.url ?? null;
    ElMessage({ message: '圖片已上傳', type: 'success' });
  } finally {
    uploading.value = false;
    input.value = ''; // 允許重複選同一檔
  }
};

const ClickRemoveCover = () => {
  form.coverImageUrl = null;
};

// ── 儲存 ─────────────────────────────────────────────
const _ValidateForm = (): string => {
  const title = form.title.trim();
  const body = form.body.trim();
  if (!title) return '標題必填';
  if (title.length > 60) return '標題上限 60 字';
  if (!body) return '內文必填';
  if (body.length > 1000) return '內文上限 1000 字';
  // CTA：兩欄要嘛都填要嘛都空；URL 必須 https://
  const label = form.ctaLabel.trim();
  const url = form.ctaUrl.trim();
  if ((label && !url) || (!label && url)) return 'CTA 按鈕的標籤與網址必須一起填寫';
  if (label) {
    if (label.length > 20) return 'CTA 標籤上限 20 字';
    if (!url.startsWith('https://')) return 'CTA 網址必須是 HTTPS';
  }
  return '';
};

const ClickSave = async () => {
  const err = _ValidateForm();
  if (err) {
    ElMessage({ message: err, type: 'warning' });
    return;
  }
  saving.value = true;
  const payload: OrderPendingTemplate = {
    title: form.title.trim(),
    body: form.body.trim(),
    coverImageUrl: form.coverImageUrl,
    ctaButton: form.ctaLabel.trim() && form.ctaUrl.trim()
      ? { label: form.ctaLabel.trim(), url: form.ctaUrl.trim() }
      : null,
  };
  try {
    const res = await $api.PutOrderPendingTemplate(payload);
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已儲存', type: 'success' });
  } finally {
    saving.value = false;
  }
};

// ── 還原預設 ─────────────────────────────────────────
const ClickRestoreDefault = async () => {
  const ok = await UseAsk('確定還原為預設文案？現有設定（包含封面圖與 CTA 按鈕）會被清除。');
  if (!ok) return;
  form.title = DEFAULT_TITLE;
  form.body = DEFAULT_BODY;
  form.coverImageUrl = null;
  form.ctaLabel = '';
  form.ctaUrl = '';
};

// ── 預覽（placeholder 用範例值）──────────────────────
const _ApplyPlaceholders = (text: string): string => {
  let result = text;
  for (const p of PLACEHOLDERS) {
    result = result.replaceAll(p.key, p.sample);
  }
  return result;
};

const previewTitle = computed(() => _ApplyPlaceholders(form.title || '（標題）'));
const previewBody = computed(() => _ApplyPlaceholders(form.body || '（內文）'));
const previewCtaLabel = computed(() => form.ctaLabel.trim());

onMounted(ApiLoad);
</script>

<template lang="pug">
.SettingsNotificationTemplate
  .SettingsNotificationTemplate__loading(v-if="loading") 載入中...

  template(v-else)
    //- 變數 chip 列
    .SettingsNotificationTemplate__chips
      .SettingsNotificationTemplate__chips-label 點擊插入變數（替換為實際訂單資料）
      .SettingsNotificationTemplate__chip-row
        button.SettingsNotificationTemplate__chip(
          v-for="p in PLACEHOLDERS"
          :key="p.key"
          type="button"
          :title="`${p.hint}（範例：${p.sample}）`"
          @click="ClickInsertPlaceholder(p.key)"
        )
          span.SettingsNotificationTemplate__chip-key {{ p.key }}
          span.SettingsNotificationTemplate__chip-hint {{ p.hint }}

    .SettingsNotificationTemplate__layout
      //- 表單
      .SettingsNotificationTemplate__form
        //- 標題
        .SettingsNotificationTemplate__field
          label.SettingsNotificationTemplate__label
            span 標題
            span.SettingsNotificationTemplate__count {{ form.title.length }} / 60
          input.SettingsNotificationTemplate__input(
            ref="titleRef"
            v-model="form.title"
            maxlength="60"
            placeholder="📝 訂單已建立"
            @focus="lastFocusedField = 'title'"
          )

        //- 內文
        .SettingsNotificationTemplate__field
          label.SettingsNotificationTemplate__label
            span 內文
            span.SettingsNotificationTemplate__count {{ form.body.length }} / 1000
          textarea.SettingsNotificationTemplate__textarea(
            ref="bodyRef"
            v-model="form.body"
            rows="6"
            maxlength="1000"
            placeholder="您的訂單已送出..."
            @focus="lastFocusedField = 'body'"
          )

        //- 封面圖
        .SettingsNotificationTemplate__field
          label.SettingsNotificationTemplate__label
            span 封面圖（選填）
            span.SettingsNotificationTemplate__count.is-hint jpg / png / gif &lt; 10MB
          .SettingsNotificationTemplate__cover-row(v-if="form.coverImageUrl")
            img.SettingsNotificationTemplate__cover-preview(:src="form.coverImageUrl" alt="cover")
            button.SettingsNotificationTemplate__btn.is-danger(type="button" @click="ClickRemoveCover") 移除圖片
          .SettingsNotificationTemplate__upload-wrap
            label.SettingsNotificationTemplate__upload-label(:class="{ 'is-disabled': uploading }")
              input(
                type="file"
                accept="image/jpeg,image/png,image/gif"
                :disabled="uploading"
                @change="ClickUploadCover"
              )
              span {{ uploading ? '上傳中...' : (form.coverImageUrl ? '更換圖片' : '上傳圖片') }}

        //- CTA 按鈕
        .SettingsNotificationTemplate__field
          label.SettingsNotificationTemplate__label
            span CTA 按鈕（選填，兩欄需同時填）
            span.SettingsNotificationTemplate__count.is-hint 必須 HTTPS；URL 支援變數
          .SettingsNotificationTemplate__cta-grid
            input.SettingsNotificationTemplate__input(
              v-model="form.ctaLabel"
              maxlength="20"
              placeholder="按鈕文字（如：查看訂單）"
            )
            input.SettingsNotificationTemplate__input(
              ref="ctaUrlRef"
              v-model="form.ctaUrl"
              placeholder="https://example.com/orders/{orderId}"
              @focus="lastFocusedField = 'ctaUrl'"
            )

        //- 動作
        .SettingsNotificationTemplate__actions
          button.SettingsNotificationTemplate__btn.is-secondary(
            type="button"
            :disabled="saving"
            @click="ClickRestoreDefault"
          ) 還原預設
          button.SettingsNotificationTemplate__btn.is-primary(
            type="button"
            :disabled="saving"
            @click="ClickSave"
          ) {{ saving ? '儲存中...' : '儲存模板' }}

      //- LINE Flex 預覽
      .SettingsNotificationTemplate__preview-wrap
        .SettingsNotificationTemplate__preview-label LINE 預覽（變數替換為範例值）
        .SettingsNotificationTemplate__preview
          img.SettingsNotificationTemplate__preview-hero(
            v-if="form.coverImageUrl"
            :src="form.coverImageUrl"
            alt="hero"
          )
          .SettingsNotificationTemplate__preview-body
            .SettingsNotificationTemplate__preview-title {{ previewTitle }}
            .SettingsNotificationTemplate__preview-text {{ previewBody }}
          .SettingsNotificationTemplate__preview-footer(v-if="previewCtaLabel")
            button.SettingsNotificationTemplate__preview-cta(disabled) {{ previewCtaLabel }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$amber-light: #f7b96a;
$surface: rgba(255, 255, 255, 0.04);
$surface-2: rgba(255, 255, 255, 0.08);
$border: rgba(255, 255, 255, 0.08);
$muted: rgba(255, 255, 255, 0.45);

.SettingsNotificationTemplate {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.SettingsNotificationTemplate__loading {
  padding: 32px 0;
  text-align: center;
  color: $muted;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  letter-spacing: 0.1em;
}

// ── 變數 chip 列 ─────────────────────────────────────────
.SettingsNotificationTemplate__chips {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(212, 134, 10, 0.06);
  border: 1px solid rgba(212, 134, 10, 0.18);
}

.SettingsNotificationTemplate__chips-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: $amber-light;
  margin-bottom: 10px;
}

.SettingsNotificationTemplate__chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.SettingsNotificationTemplate__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid rgba($amber, 0.45);
  background: rgba($amber, 0.1);
  color: #fff;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;

  &:hover {
    background: rgba($amber, 0.22);
    border-color: rgba($amber, 0.8);
  }
  &:active { transform: scale(0.97); }
}

.SettingsNotificationTemplate__chip-key {
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 11px;
  font-weight: 700;
  color: $amber-light;
}

.SettingsNotificationTemplate__chip-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

// ── 表單 + 預覽 layout ───────────────────────────────────
.SettingsNotificationTemplate__layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 20px;
}

@media (max-width: 1023.98px) {
  .SettingsNotificationTemplate__layout {
    grid-template-columns: 1fr;
  }
}

// ── 表單 ─────────────────────────────────────────────────
.SettingsNotificationTemplate__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.SettingsNotificationTemplate__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.SettingsNotificationTemplate__label {
  display: flex;
  justify-content: space-between;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: $muted;
}

.SettingsNotificationTemplate__count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.4);

  &.is-hint { text-transform: none; letter-spacing: 0.02em; }
}

.SettingsNotificationTemplate__input,
.SettingsNotificationTemplate__textarea {
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-family: 'Noto Sans TC', 'Barlow', sans-serif;
  font-size: 13px;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &::placeholder { color: rgba(255, 255, 255, 0.25); }
  &:focus { border-color: rgba($amber, 0.5); }
}

.SettingsNotificationTemplate__textarea {
  font-family: 'JetBrains Mono', 'Menlo', 'Noto Sans TC', monospace;
  font-size: 12px;
  line-height: 1.6;
  min-height: 140px;
}

.SettingsNotificationTemplate__cta-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 8px;
}

@media (max-width: 599.98px) {
  .SettingsNotificationTemplate__cta-grid {
    grid-template-columns: 1fr;
  }
}

// ── 圖片上傳 ─────────────────────────────────────────────
.SettingsNotificationTemplate__cover-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid $border;
}

.SettingsNotificationTemplate__cover-preview {
  width: 80px;
  height: 52px;
  object-fit: cover;
  border-radius: 6px;
  display: block;
}

.SettingsNotificationTemplate__upload-wrap {
  display: flex;
  justify-content: flex-start;
}

.SettingsNotificationTemplate__upload-label {
  display: inline-block;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px dashed rgba($amber, 0.5);
  background: rgba($amber, 0.06);
  color: $amber-light;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover { background: rgba($amber, 0.14); border-color: rgba($amber, 0.8); }
  &.is-disabled { opacity: 0.5; cursor: not-allowed; }
  input { display: none; }
}

// ── 動作 ─────────────────────────────────────────────────
.SettingsNotificationTemplate__actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 4px;
}

.SettingsNotificationTemplate__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 9px 18px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:active:not(:disabled) { transform: scale(0.98); }

  &.is-primary {
    background: $amber;
    color: #fff;
    &:hover:not(:disabled) { background: darken(#d4860a, 6%); }
  }
  &.is-secondary {
    background: $surface;
    color: rgba(255, 255, 255, 0.7);
    border-color: $border;
    &:hover:not(:disabled) { background: $surface-2; }
  }
  &.is-danger {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.3);
    &:hover:not(:disabled) { background: rgba(248, 113, 113, 0.2); }
  }
}

// ── LINE Flex 預覽 ───────────────────────────────────────
.SettingsNotificationTemplate__preview-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: sticky;
  top: 16px;
  align-self: start;
}

.SettingsNotificationTemplate__preview-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: $muted;
}

.SettingsNotificationTemplate__preview {
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
  color: #222;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
  max-width: 320px;
}

.SettingsNotificationTemplate__preview-hero {
  display: block;
  width: 100%;
  aspect-ratio: 20 / 13;
  object-fit: cover;
}

.SettingsNotificationTemplate__preview-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.SettingsNotificationTemplate__preview-title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #222;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
}

.SettingsNotificationTemplate__preview-text {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.SettingsNotificationTemplate__preview-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.SettingsNotificationTemplate__preview-cta {
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  border: none;
  background: #d4860a;
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: default;
  opacity: 1;
}
</style>
