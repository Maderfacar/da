<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

interface SentRecord {
  id: string;
  title: string;
  message: string;
  targetRole: string;
  sent: number;
  total: number;
  sentAt: string;
}

const TARGET_LABEL: Record<string, string> = {
  all:       '全體用戶',
  passenger: '乘客',
  driver:    '司機',
};

const sending = ref(false);
const form = reactive({ title: '', message: '', targetRole: 'all' as 'all' | 'passenger' | 'driver' });
const history = ref<SentRecord[]>([]);

const ClickSend = async () => {
  if (!form.message.trim()) {
    ElMessage({ message: '請填寫通知內容', type: 'warning' });
    return;
  }
  const ok = await UseAsk(`確定要傳送給「${TARGET_LABEL[form.targetRole]}」嗎？`);
  if (!ok) return;

  sending.value = true;
  const res = await $api.BroadcastNotification({
    title: form.title,
    message: form.message,
    targetRole: form.targetRole,
  });
  sending.value = false;

  if (res.status.code === 200 && res.data) {
    const data = res.data as { sent: number; total: number };
    ElMessage({ message: `成功傳送 ${data.sent} / ${data.total} 位用戶`, type: 'success' });
    history.value.unshift({
      id: crypto.randomUUID(),
      title: form.title,
      message: form.message,
      targetRole: form.targetRole,
      sent: data.sent,
      total: data.total,
      sentAt: new Date().toISOString(),
    });
    form.title = '';
    form.message = '';
  } else {
    ElMessage({ message: '傳送失敗，請確認 LINE 設定', type: 'error' });
  }
};
</script>

<template lang="pug">
.PageAdminNotifications
  .PageAdminNotifications__header
    .PageAdminNotifications__header-label NOTIFICATION CENTER
    h1.PageAdminNotifications__header-title 通知管理

  //- 發送表單
  .PageAdminNotifications__form
    .PageAdminNotifications__form-title SEND BROADCAST

    .PageAdminNotifications__field
      label.PageAdminNotifications__label 目標對象
      .PageAdminNotifications__radio-group
        label.PageAdminNotifications__radio(
          v-for="(label, key) in TARGET_LABEL"
          :key="key"
          :class="{ 'is-active': form.targetRole === key }"
        )
          input(type="radio" v-model="form.targetRole" :value="key" hidden)
          span {{ label }}

    .PageAdminNotifications__field
      label.PageAdminNotifications__label 標題（選填）
      input.PageAdminNotifications__input(
        v-model="form.title"
        placeholder="例如：系統公告、服務通知"
        maxlength="50"
      )

    .PageAdminNotifications__field
      label.PageAdminNotifications__label 通知內容
      textarea.PageAdminNotifications__textarea(
        v-model="form.message"
        placeholder="輸入要傳送給用戶的訊息..."
        rows="4"
        maxlength="500"
      )
      .PageAdminNotifications__char-count {{ form.message.length }} / 500

    button.PageAdminNotifications__send-btn(
      :disabled="sending || !form.message.trim()"
      @click="ClickSend"
    ) {{ sending ? '傳送中...' : '立即傳送' }}

  //- 傳送紀錄
  .PageAdminNotifications__history(v-if="history.length")
    .PageAdminNotifications__history-title SENT HISTORY
    .PageAdminNotifications__item(v-for="n in history" :key="n.id")
      .PageAdminNotifications__item-head
        span.PageAdminNotifications__target {{ TARGET_LABEL[n.targetRole] }}
        span.PageAdminNotifications__time {{ $dayjs(n.sentAt).format('MM/DD HH:mm') }}
      .PageAdminNotifications__item-title(v-if="n.title") {{ n.title }}
      .PageAdminNotifications__item-body {{ n.message }}
      .PageAdminNotifications__item-foot 成功傳送 {{ n.sent }} / {{ n.total }} 位
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.35);

.PageAdminNotifications {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageAdminNotifications__header {
  margin-bottom: 24px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    letter-spacing: 0.04em;
    color: #fff;
  }
}

// ── 發送表單 ──────────────────────────────────────────────────
.PageAdminNotifications__form {
  background: $surface;
  border: 1px solid $border;
  border-radius: 18px;
  padding: 20px;
  margin-bottom: 28px;
}

.PageAdminNotifications__form-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: $muted;
  margin-bottom: 16px;
}

.PageAdminNotifications__field {
  margin-bottom: 16px;
}

.PageAdminNotifications__label {
  display: block;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: $muted;
  margin-bottom: 8px;
}

.PageAdminNotifications__radio-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.PageAdminNotifications__radio {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 6px 14px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: $muted;
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.1);
    color: $amber;
  }
}

.PageAdminNotifications__input,
.PageAdminNotifications__textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  outline: none;
  resize: none;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &::placeholder { color: rgba(255, 255, 255, 0.2); }
  &:focus { border-color: rgba($amber, 0.4); }
}

.PageAdminNotifications__char-count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: $muted;
  text-align: right;
  margin-top: 4px;
}

.PageAdminNotifications__send-btn {
  width: 100%;
  padding: 13px;
  border-radius: 12px;
  border: none;
  background: $amber;
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.15s;
  margin-top: 4px;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:hover:not(:disabled) { background: darken(#d4860a, 8%); }
}

// ── 發送紀錄 ──────────────────────────────────────────────────
.PageAdminNotifications__history { }

.PageAdminNotifications__history-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: $muted;
  margin-bottom: 12px;
}

.PageAdminNotifications__item {
  background: $surface;
  border: 1px solid $border;
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 10px;

  &-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  &-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
  }

  &-body {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
    line-height: 1.5;
    margin-bottom: 10px;
    white-space: pre-wrap;
  }

  &-foot {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    color: $muted;
  }
}

.PageAdminNotifications__target {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba($amber, 0.12);
  border: 1px solid rgba($amber, 0.25);
  color: $amber;
}

.PageAdminNotifications__time {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  margin-left: auto;
}
</style>
