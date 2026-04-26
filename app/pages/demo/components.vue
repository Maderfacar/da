<script setup lang="ts">
definePageMeta({ layout: 'default' });

const { showToast } = useToast();

// UiInput 示範
const inputLight = ref('');
const inputDark = ref('');
const inputError = ref('');
const inputNum = ref('');

// UiModal 示範
const modalOpen = ref(false);

// UiBadge 示範
const badges: Array<{ variant: 'confirmed' | 'pending' | 'success' | 'error' | 'info'; label: string }> = [
  { variant: 'confirmed', label: '已確認' },
  { variant: 'pending',   label: '候補確認' },
  { variant: 'success',   label: '已完成' },
  { variant: 'error',     label: '已取消' },
  { variant: 'info',      label: '草稿' },
];
</script>

<template lang="pug">
.DemoComponents
  UiToast

  //- ── TOP BAR ─────────────────────────────────────────────
  .DemoComponents__topbar
    nuxt-link.DemoComponents__back(to="/home") ← 返回首頁
    .DemoComponents__topbar-title UI COMPONENTS

  .DemoComponents__content

    //- ── UiButton ─────────────────────────────────────────
    section.DemoComponents__section
      .DemoComponents__section-label UiButton
      .DemoComponents__row
        UiButton(variant="primary" size="sm") Primary SM
        UiButton(variant="primary" size="md") Primary MD
        UiButton(variant="primary" size="lg") Primary LG
      .DemoComponents__row
        UiButton(variant="secondary" size="sm") Secondary SM
        UiButton(variant="secondary" size="md") Secondary MD
        UiButton(variant="secondary" size="lg") Secondary LG
      .DemoComponents__row
        UiButton(variant="glass" size="md") Glass MD
        UiButton(variant="primary" size="md" :loading="true") Loading
        UiButton(variant="secondary" size="md" :disabled="true") Disabled
      .DemoComponents__row
        UiButton(variant="primary" size="md" :block="true") Block 全寬按鈕

    //- ── UiInput ──────────────────────────────────────────
    section.DemoComponents__section
      .DemoComponents__section-label UiInput
      UiInput(
        v-model="inputLight"
        label="Light 輸入框"
        placeholder="請輸入文字"
        theme="light"
        :maxlength="50"
        hint="最多 50 字"
      )
      .DemoComponents__spacer
      UiInput(
        v-model="inputError"
        label="錯誤狀態"
        placeholder="請輸入"
        theme="light"
        error="此欄位為必填"
      )
      .DemoComponents__spacer
      UiInput(
        v-model="inputNum"
        label="數字輸入"
        placeholder="人數"
        type="number"
        inputmode="numeric"
        :maxlength="3"
      )

    //- ── Dark Input (on dark bg) ──────────────────────────
    .DemoComponents__dark-bg
      UiInput(
        v-model="inputDark"
        label="Dark 輸入框"
        placeholder="請輸入文字"
        theme="dark"
        :maxlength="50"
      )

    //- ── UiCard ───────────────────────────────────────────
    section.DemoComponents__section
      .DemoComponents__section-label UiCard
      UiCard(variant="glass" padding="md")
        .DemoComponents__card-inner
          strong Glass Card
          p 毛玻璃效果卡片，backdrop-filter blur(12px)
      .DemoComponents__spacer
      UiCard(variant="glass" padding="md" :accent="true")
        .DemoComponents__card-inner
          strong Glass Card + Accent
          p 左側琥珀色邊條，用於行程卡片
      .DemoComponents__spacer
      UiCard(variant="cream" padding="md")
        .DemoComponents__card-inner
          strong Cream Card
          p 米白背景，適合一般資訊區塊
    .DemoComponents__dark-bg
      UiCard(variant="dark" padding="lg")
        .DemoComponents__card-inner.is-light
          strong Dark Card
          p 深色背景，用於車資估算、統計區塊

    //- ── UiModal ──────────────────────────────────────────
    section.DemoComponents__section
      .DemoComponents__section-label UiModal
      UiButton(variant="primary" @click="modalOpen = true") 開啟 Modal
      UiModal(v-model="modalOpen" title="確認行程")
        p 這是 Modal 的內容區域，採用 Bottom Sheet 樣式。
        br
        p 點擊遮罩或下方按鈕可關閉。
        template(#footer)
          UiButton(variant="primary" :block="true" @click="modalOpen = false") 確認送出
          UiButton(variant="secondary" :block="true" @click="modalOpen = false") 取消

    //- ── UiBadge ──────────────────────────────────────────
    section.DemoComponents__section
      .DemoComponents__section-label UiBadge
      .DemoComponents__row.is-wrap
        UiBadge(
          v-for="b in badges"
          :key="b.variant"
          :variant="b.variant"
        ) {{ b.label }}

    //- ── UiToast ──────────────────────────────────────────
    section.DemoComponents__section
      .DemoComponents__section-label UiToast
      .DemoComponents__row
        UiButton(variant="primary" @click="showToast('✓ 預約成功！即將確認')") 觸發 Toast
        UiButton(variant="secondary" @click="showToast('⚠ 請檢查輸入欄位', 5000)") 長顯 Toast
</template>

<style lang="scss" scoped>
.DemoComponents {
  min-height: 100vh;
  background: var(--da-off-white);
  padding-bottom: 48px;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
}

// ── Top Bar ────────────────────────────────────────────────
.DemoComponents__topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 52px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(250, 248, 244, 0.9);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--da-glass-border);
}

.DemoComponents__back {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--da-gray);
  text-decoration: none;
}

.DemoComponents__topbar-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 18px;
  letter-spacing: 0.1em;
  color: var(--da-dark);
}

// ── Content ────────────────────────────────────────────────
.DemoComponents__content {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.DemoComponents__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.DemoComponents__section-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--da-gray-pale);

  &::before {
    content: '';
    width: 20px; height: 1.5px;
    background: var(--da-amber);
  }
}

.DemoComponents__row {
  display: flex;
  align-items: center;
  gap: 10px;

  &.is-wrap { flex-wrap: wrap; }
}

.DemoComponents__spacer { height: 4px; }

// ── Dark bg 示範區 ─────────────────────────────────────────
.DemoComponents__dark-bg {
  background: var(--da-dark);
  border-radius: 20px;
  padding: 20px;
}

// ── Card inner ─────────────────────────────────────────────
.DemoComponents__card-inner {
  strong {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--da-dark);
    display: block;
    margin-bottom: 4px;
  }

  p {
    font-size: 13px;
    font-weight: 300;
    color: var(--da-gray);
    line-height: 1.6;
  }

  &.is-light strong { color: var(--da-cream); }
  &.is-light p      { color: rgba(255, 255, 255, 0.4); }
}
</style>
