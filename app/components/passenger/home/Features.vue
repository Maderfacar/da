<script setup lang="ts">
// PassengerHomeFeatures — 首頁服務特色 4 卡

interface FeatureItem {
  id: string;
  titleKey: string;
  bodyKey: string;
  stamp: string;
}

const items: FeatureItem[] = [
  { id: 'flight',      titleKey: 'flightTitle',      bodyKey: 'flightBody',      stamp: '✈' },
  { id: 'transparent', titleKey: 'transparentTitle', bodyKey: 'transparentBody', stamp: '$' },
  { id: 'service',     titleKey: 'serviceTitle',     bodyKey: 'serviceBody',     stamp: '24' },
  { id: 'driver',      titleKey: 'driverTitle',      bodyKey: 'driverBody',      stamp: '★' },
];
</script>

<template lang="pug">
section.PassengerHomeFeatures
  .PassengerHomeFeatures__label {{ $t('homeFeatures.label') }}
  h2.PassengerHomeFeatures__title {{ $t('homeFeatures.title') }}
  p.PassengerHomeFeatures__desc {{ $t('homeFeatures.desc') }}
  .PassengerHomeFeatures__grid
    .PassengerHomeFeatures__card(v-for="it in items" :key="it.id")
      .PassengerHomeFeatures__stamp {{ it.stamp }}
      .PassengerHomeFeatures__card-title {{ $t('homeFeatures.items.' + it.titleKey) }}
      p.PassengerHomeFeatures__card-body {{ $t('homeFeatures.items.' + it.bodyKey) }}
</template>

<style lang="scss" scoped>
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

.PassengerHomeFeatures {
  padding: 72px 24px;
  background: var(--da-cream);
}

.PassengerHomeFeatures__label {
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

.PassengerHomeFeatures__title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PassengerHomeFeatures__desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
}

.PassengerHomeFeatures__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 24px;
}

.PassengerHomeFeatures__card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  padding: 20px 16px;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 18px;
    height: 4px;
    border-radius: 100px;
    background: var(--da-amber);
    opacity: 0.5;
  }
}

.PassengerHomeFeatures__stamp {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1.5px solid var(--da-amber);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: $font-display;
  font-size: 18px;
  color: var(--da-amber);
  margin: 8px 0 12px;
}

.PassengerHomeFeatures__card-title {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  color: var(--da-dark);
  margin-bottom: 6px;
}

.PassengerHomeFeatures__card-body {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.65;
}
</style>
