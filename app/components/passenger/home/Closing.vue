<script setup lang="ts">
// PassengerHomeClosing — 首頁結尾雙動作 CTA（訂車 + LINE 客服）

const { lineOaAddUrl } = useRuntimeConfig().public;

const ClickBook = () => navigateTo('/booking');

const ClickSupport = () => {
  if (lineOaAddUrl && typeof window !== 'undefined') {
    window.open(lineOaAddUrl, '_blank', 'noopener,noreferrer');
  }
};
</script>

<template lang="pug">
section.PassengerHomeClosing
  .PassengerHomeClosing__label {{ $t('homeClosing.label') }}
  h2.PassengerHomeClosing__title {{ $t('homeClosing.title') }}
  p.PassengerHomeClosing__desc {{ $t('homeClosing.desc') }}
  .PassengerHomeClosing__actions
    button.PassengerHomeClosing__book(type="button" @click="ClickBook")
      | {{ $t('homeClosing.book') }}
    button.PassengerHomeClosing__support(type="button" @click="ClickSupport")
      | {{ $t('homeClosing.support') }}
      span.PassengerHomeClosing__support-ext ↗
</template>

<style lang="scss" scoped>
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

.PassengerHomeClosing {
  padding: 72px 24px;
  background: var(--da-off-white);
}

.PassengerHomeClosing__label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    width: 24px;
    height: 1.5px;
    background: var(--da-amber);
  }
}

.PassengerHomeClosing__title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PassengerHomeClosing__desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
}

.PassengerHomeClosing__actions {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PassengerHomeClosing__book {
  width: 100%;
  padding: 18px;
  background: var(--da-dark);
  color: var(--da-cream);
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.12em;
  border: none;
  border-radius: 14px;
  cursor: pointer;

  &:active {
    transform: scale(0.98);
  }
}

.PassengerHomeClosing__support {
  width: 100%;
  padding: 16px;
  background: transparent;
  color: var(--da-dark);
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1.5px solid var(--da-dark);
  border-radius: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  &:active {
    transform: scale(0.98);
  }
}

.PassengerHomeClosing__support-ext {
  color: var(--da-amber);
}
</style>
