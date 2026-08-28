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

.PassengerHomeCoverage {
  padding-block: var(--space-section);
  padding-inline: max(var(--gutter), calc((100% - var(--shell)) / 2));
  background: var(--da-off-white);
}

.PassengerHomeCoverage__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--accent-text);
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
  font-family: var(--ff-display);
  font-size: clamp(42px, 12vw, 56px);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-snug);
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PassengerHomeCoverage__desc {
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
  margin-bottom: 32px;
  max-width: 320px;
  font-family: var(--ff-ui);
}

.PassengerHomeCoverage__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 24px;
}

.PassengerHomeCoverage__card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
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
    border-radius: var(--r-lg) 0 0 var(--r-lg);
  }
}

.PassengerHomeCoverage__iata {
  font-family: var(--ff-display);
  font-size: var(--fs-display);
  line-height: var(--lh-flat);
  color: var(--da-dark);
  letter-spacing: var(--ls-label);
}

.PassengerHomeCoverage__name {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--da-gray);
  margin-top: 8px;
}

.PassengerHomeCoverage__nationwide {
  margin-top: 16px;
  text-align: center;
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--accent-text);
}
</style>
