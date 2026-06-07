<script setup lang="ts">
// 歡迎序列編輯器（2026-06-08）
//
// 用途：admin 編輯 bot_replies/{passenger|driver}.follow 的歡迎訊息序列。
// 每則訊息可選 text / flex，三語 zh_tw / en / ja 各自編輯。
// LINE Messaging API 上限 5 則/次，本元件強制 messages.length ≤ 5。
//
// 給父頁的接口：傳 initialSequence + defaultText，按儲存後 emit('saved')，父頁負責 reload。
import type {
  BotReplyKey,
  WelcomeLang,
  WelcomeMessage,
  WelcomeMessageFlex,
  WelcomeMessageText,
  WelcomeSequence,
} from '@/protocol/fetch-api/api/admin/bot-reply';

interface Props {
  replyKey: BotReplyKey;
  initialSequence: WelcomeSequence;
  defaultText: string;
}
const props = defineProps<Props>();
const emit = defineEmits<{ saved: [] }>();

const MAX_MESSAGES = 5;
const MAX_TEXT_LEN = 500;
const MAX_TITLE_LEN = 80;
const MAX_BODY_LEN = 500;
const MAX_LABEL_LEN = 20;

const LANG_TABS: Array<{ key: WelcomeLang; label: string }> = [
  { key: 'zh_tw', label: '繁中' },
  { key: 'en',    label: 'EN' },
  { key: 'ja',    label: '日本語' },
];

// ── 本地表單狀態（深 clone initial，避免父頁直接被改動）─────
const _DeepCloneSequence = (s: WelcomeSequence): WelcomeSequence =>
  JSON.parse(JSON.stringify(s)) as WelcomeSequence;

const sequence = ref<WelcomeSequence>(_DeepCloneSequence(props.initialSequence));
const editingLang = ref<WelcomeLang>('zh_tw');
const submitting = ref(false);
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

// 父頁切到不同 replyKey 時重設 local state
watch(() => props.replyKey, () => {
  sequence.value = _DeepCloneSequence(props.initialSequence);
  editingLang.value = 'zh_tw';
});

// ── 工具：新 message factory ──────────────────────────────
const _NewId = (): string => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const _NewTextMessage = (): WelcomeMessageText => ({
  id: _NewId(),
  type: 'text',
  enabled: true,
  content: { zh_tw: '', en: '', ja: '' },
});

const _NewFlexMessage = (): WelcomeMessageFlex => ({
  id: _NewId(),
  type: 'flex',
  enabled: true,
  title: { zh_tw: '', en: '', ja: '' },
  body: { zh_tw: '', en: '', ja: '' },
  coverImageUrl: null,
  ctaButton: null,
});

const ClickAddMessage = (type: 'text' | 'flex'): void => {
  if (sequence.value.messages.length >= MAX_MESSAGES) {
    ElMessage({ message: `最多 ${MAX_MESSAGES} 則訊息`, type: 'warning' });
    return;
  }
  sequence.value.messages.push(type === 'text' ? _NewTextMessage() : _NewFlexMessage());
};

const ClickRemoveMessage = (idx: number): void => {
  sequence.value.messages.splice(idx, 1);
};

const ClickMoveUp = (idx: number): void => {
  if (idx === 0) return;
  const arr = sequence.value.messages;
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
};

const ClickMoveDown = (idx: number): void => {
  const arr = sequence.value.messages;
  if (idx >= arr.length - 1) return;
  [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
};

const ClickResetDefault = (): void => {
  if (!confirm('確定要還原為「單則預設文字」嗎？目前的編輯會清空。')) return;
  sequence.value = {
    enabled: true,
    messages: [{
      id: _NewId(),
      type: 'text',
      enabled: true,
      content: { zh_tw: props.defaultText, en: props.defaultText, ja: props.defaultText },
    }],
  };
};

// ── CTA button toggle helpers（flex only）─────────────────
const ToggleCtaButton = (msg: WelcomeMessageFlex): void => {
  msg.ctaButton = msg.ctaButton === null
    ? { label: { zh_tw: '', en: '', ja: '' }, url: '' }
    : null;
};

// ── 拖拉排序（HTML5 drag & drop；對齊 BookingStepRoute 樣式）─
const HandleDragStart = (idx: number, e: DragEvent): void => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest?.('.WelcomeSequenceEditor__drag-handle')) {
    e.preventDefault();
    return;
  }
  dragIndex.value = idx;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
};
const HandleDragOver = (idx: number, e: DragEvent): void => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (dragOverIndex.value !== idx) dragOverIndex.value = idx;
};
const HandleDragLeave = (idx: number): void => {
  if (dragOverIndex.value === idx) dragOverIndex.value = null;
};
const HandleDrop = (idx: number, e: DragEvent): void => {
  e.preventDefault();
  const from = dragIndex.value;
  dragIndex.value = null;
  dragOverIndex.value = null;
  if (from === null || from === idx) return;
  const arr = [...sequence.value.messages];
  const [moved] = arr.splice(from, 1);
  arr.splice(idx, 0, moved);
  sequence.value.messages = arr;
};
const HandleDragEnd = (): void => {
  dragIndex.value = null;
  dragOverIndex.value = null;
};

// ── 儲存（client-side 預校驗 + PUT）─────────────────────
const _ValidateBeforeSubmit = (): string | null => {
  const seq = sequence.value;
  if (seq.enabled && seq.messages.length === 0) {
    return '啟用狀態下至少需要 1 則訊息';
  }
  for (let i = 0; i < seq.messages.length; i++) {
    const m = seq.messages[i];
    if (m.type === 'text') {
      const filled = (['zh_tw', 'en', 'ja'] as const).some((l) => m.content[l].trim().length > 0);
      if (!filled) return `第 ${i + 1} 則 text 訊息：三語都是空的`;
    } else {
      const titleFilled = (['zh_tw', 'en', 'ja'] as const).some((l) => m.title[l].trim().length > 0);
      const bodyFilled  = (['zh_tw', 'en', 'ja'] as const).some((l) => m.body[l].trim().length > 0);
      if (!titleFilled && !bodyFilled && !m.coverImageUrl) {
        return `第 ${i + 1} 則 flex 訊息：title / body / coverImage 都是空的`;
      }
      if (m.coverImageUrl && !m.coverImageUrl.startsWith('https://')) {
        return `第 ${i + 1} 則 flex 訊息：coverImageUrl 必須為 https URL`;
      }
      if (m.ctaButton) {
        const labelFilled = (['zh_tw', 'en', 'ja'] as const).some((l) => m.ctaButton!.label[l].trim().length > 0);
        if (!labelFilled) return `第 ${i + 1} 則 flex 訊息：CTA 按鈕 label 三語都是空的`;
        if (!m.ctaButton.url.startsWith('https://')) {
          return `第 ${i + 1} 則 flex 訊息：CTA 按鈕 URL 必須為 https`;
        }
      }
    }
  }
  return null;
};

const ClickSave = async (): Promise<void> => {
  const err = _ValidateBeforeSubmit();
  if (err) {
    ElMessage({ message: err, type: 'warning' });
    return;
  }
  submitting.value = true;
  try {
    const res = await $api.PutBotReply(props.replyKey, {
      enabled: sequence.value.enabled,
      messages: sequence.value.messages,
    });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已儲存', type: 'success' });
    emit('saved');
  } finally {
    submitting.value = false;
  }
};
</script>

<template lang="pug">
.WelcomeSequenceEditor
  //- 整體 enabled 開關
  .WelcomeSequenceEditor__head
    label.WelcomeSequenceEditor__enabled
      input(type="checkbox" v-model="sequence.enabled")
      | &nbsp;啟用整段歡迎序列
    .WelcomeSequenceEditor__count
      | {{ sequence.messages.length }} / {{ MAX_MESSAGES }} 則訊息

  //- 語言 tab（內容編輯時切換）
  .WelcomeSequenceEditor__lang-tabs
    button.WelcomeSequenceEditor__lang-tab(
      v-for="tab in LANG_TABS"
      :key="tab.key"
      :class="{ 'is-active': editingLang === tab.key }"
      @click="editingLang = tab.key"
    ) {{ tab.label }}

  //- 訊息列表（可拖拉）
  .WelcomeSequenceEditor__messages
    .WelcomeSequenceEditor__empty(v-if="sequence.messages.length === 0")
      | 尚無訊息。按下方按鈕新增第一則。

    .WelcomeSequenceEditor__message(
      v-for="(msg, idx) in sequence.messages"
      :key="msg.id"
      :class="[`is-${msg.type}`, { 'is-dragging': dragIndex === idx, 'is-drop-target': dragOverIndex === idx && dragIndex !== idx, 'is-disabled': !msg.enabled }]"
      draggable="true"
      @dragstart="HandleDragStart(idx, $event)"
      @dragover="HandleDragOver(idx, $event)"
      @dragleave="HandleDragLeave(idx)"
      @drop="HandleDrop(idx, $event)"
      @dragend="HandleDragEnd"
    )
      //- 表頭：拖拉柄 + 順序 + 類型 badge + enabled + 上/下/刪
      .WelcomeSequenceEditor__msg-head
        button.WelcomeSequenceEditor__drag-handle(
          type="button"
          aria-label="拖拉排序"
        ) ⋮⋮
        span.WelcomeSequenceEditor__msg-num \#{{ idx + 1 }}
        span.WelcomeSequenceEditor__msg-type-badge(:class="`is-${msg.type}`")
          | {{ msg.type === 'text' ? 'TEXT' : 'FLEX' }}
        label.WelcomeSequenceEditor__msg-enabled
          input(type="checkbox" v-model="msg.enabled")
          | &nbsp;啟用此則
        .WelcomeSequenceEditor__msg-actions
          button.WelcomeSequenceEditor__icon-btn(
            type="button"
            title="上移"
            :disabled="idx === 0"
            @click="ClickMoveUp(idx)"
          ) ↑
          button.WelcomeSequenceEditor__icon-btn(
            type="button"
            title="下移"
            :disabled="idx === sequence.messages.length - 1"
            @click="ClickMoveDown(idx)"
          ) ↓
          button.WelcomeSequenceEditor__icon-btn.is-danger(
            type="button"
            title="刪除"
            @click="ClickRemoveMessage(idx)"
          ) ✕

      //- TEXT 編輯器
      template(v-if="msg.type === 'text'")
        textarea.WelcomeSequenceEditor__textarea(
          v-model="msg.content[editingLang]"
          rows="4"
          :maxlength="MAX_TEXT_LEN"
          :placeholder="`${LANG_TABS.find((t) => t.key === editingLang)?.label} 內容（純文字、可含換行 / emoji）`"
        )
        .WelcomeSequenceEditor__count-row
          | {{ msg.content[editingLang].length }} / {{ MAX_TEXT_LEN }}

      //- FLEX 編輯器
      template(v-else)
        .WelcomeSequenceEditor__flex-fields
          label.WelcomeSequenceEditor__field-label 標題（{{ LANG_TABS.find((t) => t.key === editingLang)?.label }}）
          input.WelcomeSequenceEditor__input(
            type="text"
            v-model="msg.title[editingLang]"
            :maxlength="MAX_TITLE_LEN"
            :placeholder="`例：歡迎來到 Destination Anywhere`"
          )
          .WelcomeSequenceEditor__count-row
            | {{ msg.title[editingLang].length }} / {{ MAX_TITLE_LEN }}

          label.WelcomeSequenceEditor__field-label 內文（{{ LANG_TABS.find((t) => t.key === editingLang)?.label }}）
          textarea.WelcomeSequenceEditor__textarea(
            v-model="msg.body[editingLang]"
            rows="3"
            :maxlength="MAX_BODY_LEN"
            placeholder="例：專業機場接送，隨時為您出發。"
          )
          .WelcomeSequenceEditor__count-row
            | {{ msg.body[editingLang].length }} / {{ MAX_BODY_LEN }}

          label.WelcomeSequenceEditor__field-label 封面圖 URL（選填，三語共用）
          input.WelcomeSequenceEditor__input(
            type="url"
            v-model="msg.coverImageUrl"
            placeholder="https://...（建議 1040 × 520，必須 https）"
          )

          label.WelcomeSequenceEditor__field-label
            input(type="checkbox" :checked="msg.ctaButton !== null" @change="ToggleCtaButton(msg)")
            | &nbsp;啟用 CTA 按鈕
          template(v-if="msg.ctaButton")
            label.WelcomeSequenceEditor__field-sub-label 按鈕文字（{{ LANG_TABS.find((t) => t.key === editingLang)?.label }}）
            input.WelcomeSequenceEditor__input(
              type="text"
              v-model="msg.ctaButton.label[editingLang]"
              :maxlength="MAX_LABEL_LEN"
              placeholder="例：立即訂車"
            )
            label.WelcomeSequenceEditor__field-sub-label 按鈕 URL（三語共用，建議 LIFF 短連）
            input.WelcomeSequenceEditor__input(
              type="url"
              v-model="msg.ctaButton.url"
              placeholder="https://liff.line.me/{liffId}/booking"
            )

  //- 加新訊息（兩顆按鈕：text / flex）
  .WelcomeSequenceEditor__add
    button.WelcomeSequenceEditor__add-btn(
      type="button"
      :disabled="sequence.messages.length >= MAX_MESSAGES"
      @click="ClickAddMessage('text')"
    ) + 加 TEXT
    button.WelcomeSequenceEditor__add-btn(
      type="button"
      :disabled="sequence.messages.length >= MAX_MESSAGES"
      @click="ClickAddMessage('flex')"
    ) + 加 FLEX

  //- 底部動作
  .WelcomeSequenceEditor__foot
    button.WelcomeSequenceEditor__btn.is-secondary(
      type="button"
      :disabled="submitting"
      @click="ClickResetDefault"
    ) 還原預設
    button.WelcomeSequenceEditor__btn.is-primary(
      type="button"
      :disabled="submitting"
      @click="ClickSave"
    ) {{ submitting ? '儲存中...' : '儲存歡迎序列' }}
</template>

<style lang="scss" scoped>
.WelcomeSequenceEditor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--da-cream, #faf7f0);
  border-radius: 12px;
  border: 1px solid var(--da-glass-border, #e6dfd0);
}

.WelcomeSequenceEditor__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.WelcomeSequenceEditor__enabled {
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--da-dark, #1a1814);
  cursor: pointer;
}

.WelcomeSequenceEditor__count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  letter-spacing: 0.15em;
  color: var(--da-gray, #6b6a68);
}

.WelcomeSequenceEditor__lang-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  align-self: flex-start;
}

.WelcomeSequenceEditor__lang-tab {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--da-gray);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &.is-active {
    background: var(--da-amber, #d4860a);
    color: #fff;
  }
}

.WelcomeSequenceEditor__messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.WelcomeSequenceEditor__empty {
  padding: 24px;
  text-align: center;
  color: var(--da-gray);
  font-size: 13px;
  border: 1px dashed var(--da-gray-pale, #d5cfc0);
  border-radius: 10px;
}

.WelcomeSequenceEditor__message {
  background: #fff;
  border: 1.5px solid var(--da-glass-border);
  border-radius: 10px;
  padding: 12px;
  transition: opacity 0.15s, border-color 0.15s, box-shadow 0.15s;

  &.is-dragging { opacity: 0.45; }
  &.is-drop-target {
    border-color: var(--da-amber);
    box-shadow: 0 -2px 0 var(--da-amber);
  }
  &.is-disabled { opacity: 0.6; }
}

.WelcomeSequenceEditor__msg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--da-glass-border);
  flex-wrap: wrap;
}

.WelcomeSequenceEditor__drag-handle {
  background: none;
  border: none;
  color: var(--da-gray);
  font-size: 18px;
  cursor: grab;
  padding: 2px 6px;
  user-select: none;
  &:active { cursor: grabbing; }
}

.WelcomeSequenceEditor__msg-num {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--da-gray);
}

.WelcomeSequenceEditor__msg-type-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  padding: 2px 8px;
  border-radius: 4px;

  &.is-text { background: rgba(212, 134, 10, 0.15); color: var(--da-amber); }
  &.is-flex { background: rgba(28, 100, 200, 0.15); color: #1c64c8; }
}

.WelcomeSequenceEditor__msg-enabled {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--da-gray);
  cursor: pointer;
  margin-right: auto;
}

.WelcomeSequenceEditor__msg-actions {
  display: inline-flex;
  gap: 4px;
}

.WelcomeSequenceEditor__icon-btn {
  background: none;
  border: 1px solid var(--da-glass-border);
  color: var(--da-gray);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;

  &:disabled { opacity: 0.3; cursor: not-allowed; }
  &:not(:disabled):hover {
    background: var(--da-amber-pale, #fbe9c8);
    border-color: var(--da-amber);
    color: var(--da-amber);
  }
  &.is-danger:not(:disabled):hover {
    background: rgba(239, 68, 68, 0.12);
    border-color: #ef4444;
    color: #ef4444;
  }
}

.WelcomeSequenceEditor__textarea,
.WelcomeSequenceEditor__input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--da-glass-border);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  color: var(--da-dark);
  background: var(--da-cream, #faf7f0);
  resize: vertical;

  &:focus {
    outline: none;
    border-color: var(--da-amber);
    box-shadow: 0 0 0 2px rgba(212, 134, 10, 0.15);
  }
}

.WelcomeSequenceEditor__count-row {
  font-size: 11px;
  color: var(--da-gray);
  text-align: right;
  margin-top: 2px;
  margin-bottom: 6px;
}

.WelcomeSequenceEditor__flex-fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.WelcomeSequenceEditor__field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--da-dark);
  margin-top: 8px;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
}

.WelcomeSequenceEditor__field-sub-label {
  font-size: 11px;
  color: var(--da-gray);
  margin-top: 4px;
  margin-bottom: 2px;
}

.WelcomeSequenceEditor__add {
  display: flex;
  gap: 8px;
}

.WelcomeSequenceEditor__add-btn {
  flex: 1;
  padding: 10px;
  border: 1px dashed var(--da-gray-pale);
  border-radius: 8px;
  background: transparent;
  color: var(--da-gray);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &:not(:disabled):hover {
    border-color: var(--da-amber);
    color: var(--da-amber);
    background: rgba(212, 134, 10, 0.05);
  }
}

.WelcomeSequenceEditor__foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--da-glass-border);
}

.WelcomeSequenceEditor__btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: var(--da-amber);
    border: 1px solid var(--da-amber);
    color: #fff;
    &:not(:disabled):hover { background: #b87308; }
  }
  &.is-secondary {
    background: transparent;
    border: 1px solid var(--da-glass-border);
    color: var(--da-gray);
    &:not(:disabled):hover { border-color: var(--da-gray); color: var(--da-dark); }
  }
}
</style>
