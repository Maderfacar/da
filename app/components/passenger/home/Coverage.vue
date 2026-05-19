<script setup lang="ts">
// PassengerHomeCoverage — 首頁服務範圍（四大機場）
</script>

<template lang="pug">
section.PassengerHomeCoverage
  .PassengerHomeCoverage__label {{ $t('homeCoverage.label') }}
  h2.PassengerHomeCoverage__title {{ $t('homeCoverage.title') }}
  p.PassengerHomeCoverage__desc {{ $t('homeCoverage.desc') }}
  .PassengerHomeCoverage__grid
    .PassengerHomeCoverage__card(v-for="ap in SERVICE_AIRPORTS" :key="ap.id")
      .PassengerHomeCoverage__iata {{ ap.iata }}
      .PassengerHomeCoverage__name {{ $t('homeCoverage.airports.' + ap.id) }}
  .PassengerHomeCoverage__nationwide {{ $t('homeCoverage.nationwide') }}
</template>

<style lang="scss" scoped>
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

.PassengerHomeCoverage {
  padding: 72px 24px;
  background: var(--da-off-white);
}

.PassengerHomeCoverage__label {
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

.PassengerHomeCoverage__title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PassengerHomeCoverage__desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
}

.PassengerHomeCoverage__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 24px;
}

.PassengerHomeCoverage__card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  padding: 24px 18px;
  text-align: center;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: var(--da-amber);
    border-radius: 16px 0 0 16px;
  }
}

.PassengerHomeCoverage__iata {
  font-family: $font-display;
  font-size: 48px;
  line-height: 1;
  color: var(--da-dark);
  letter-spacing: 0.04em;
}

.PassengerHomeCoverage__name {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 500;
  color: var(--da-gray);
  margin-top: 8px;
}

.PassengerHomeCoverage__nationwide {
  margin-top: 16px;
  text-align: center;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-amber);
}
</style>
