<script setup lang="ts">
// PassengerHomeSteps — 首頁 How-it-works 3 步（登機流程式序列）

interface StepItem {
  id: string;
  no: string;
  titleKey: string;
  bodyKey: string;
}

const steps: StepItem[] = [
  { id: 'book',    no: '01', titleKey: 'bookTitle',    bodyKey: 'bookBody' },
  { id: 'confirm', no: '02', titleKey: 'confirmTitle', bodyKey: 'confirmBody' },
  { id: 'depart',  no: '03', titleKey: 'departTitle',  bodyKey: 'departBody' },
];
</script>

<template lang="pug">
section.PassengerHomeSteps
  .PassengerHomeSteps__label {{ $t('homeSteps.label') }}
  h2.PassengerHomeSteps__title {{ $t('homeSteps.title') }}
  p.PassengerHomeSteps__desc {{ $t('homeSteps.desc') }}
  .PassengerHomeSteps__list
    .PassengerHomeSteps__step(v-for="(s, i) in steps" :key="s.id")
      .PassengerHomeSteps__no {{ s.no }}
      .PassengerHomeSteps__body
        .PassengerHomeSteps__step-title {{ $t('homeSteps.items.' + s.titleKey) }}
        p.PassengerHomeSteps__step-body {{ $t('homeSteps.items.' + s.bodyKey) }}
      .PassengerHomeSteps__connector(v-if="i < steps.length - 1")
</template>

<style lang="scss" scoped>
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

.PassengerHomeSteps {
  padding: 72px 24px;
  background: var(--da-off-white);
}

.PassengerHomeSteps__label {
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

.PassengerHomeSteps__title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PassengerHomeSteps__desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
}

.PassengerHomeSteps__list {
  margin-top: 28px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.PassengerHomeSteps__step {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 16px;
  position: relative;
  padding-bottom: 28px;

  &:last-child {
    padding-bottom: 0;
  }
}

.PassengerHomeSteps__no {
  font-family: $font-display;
  font-size: 44px;
  line-height: 1;
  color: var(--da-amber);
  width: 56px;
  text-align: center;
}

.PassengerHomeSteps__connector {
  position: absolute;
  left: 27px;
  top: 52px;
  bottom: 4px;
  width: 2px;
  background: repeating-linear-gradient(to bottom, var(--da-amber) 0 4px, transparent 4px 10px);
  opacity: 0.4;
}

.PassengerHomeSteps__step-title {
  font-family: $font-condensed;
  font-size: 18px;
  font-weight: 700;
  color: var(--da-dark);
  margin-bottom: 6px;
  padding-top: 6px;
}

.PassengerHomeSteps__step-body {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
}
</style>
