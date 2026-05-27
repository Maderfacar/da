<script setup lang="ts">
// PassengerHomeFeatures — 首頁「安心接送的理由」
// Home redesign 2026-05-27：合併原 Steps 內容（3 步流程）+ 新增「LINE Only / 無需下載 APP」突顯卡
// 順序：特色卡 4 張 → 3 步流程 → LINE only 提示卡（醒目）

interface FeatureItem {
  id: string;
  titleKey: string;
  bodyKey: string;
  stamp: string;
}

interface StepItem {
  id: string;
  no: string;
  titleKey: string;
  bodyKey: string;
}

const features: FeatureItem[] = [
  { id: 'flight',      titleKey: 'flightTitle',      bodyKey: 'flightBody',      stamp: '✈' },
  { id: 'transparent', titleKey: 'transparentTitle', bodyKey: 'transparentBody', stamp: '$' },
  { id: 'service',     titleKey: 'serviceTitle',     bodyKey: 'serviceBody',     stamp: '24' },
  { id: 'driver',      titleKey: 'driverTitle',      bodyKey: 'driverBody',      stamp: '★' },
];

const steps: StepItem[] = [
  { id: 'book',    no: '01', titleKey: 'bookTitle',    bodyKey: 'bookBody' },
  { id: 'confirm', no: '02', titleKey: 'confirmTitle', bodyKey: 'confirmBody' },
  { id: 'depart',  no: '03', titleKey: 'departTitle',  bodyKey: 'departBody' },
];
</script>

<template lang="pug">
section.PassengerHomeFeatures
  .PassengerHomeFeatures__label {{ $t('homeFeatures.label') }}
  h2.PassengerHomeFeatures__title {{ $t('homeFeatures.title') }}
  p.PassengerHomeFeatures__desc {{ $t('homeFeatures.desc') }}

  //- ── 服務特色 4 卡 ───────────────────────────────────────
  .PassengerHomeFeatures__grid
    .PassengerHomeFeatures__card(v-for="it in features" :key="it.id")
      .PassengerHomeFeatures__stamp {{ it.stamp }}
      .PassengerHomeFeatures__card-title {{ $t('homeFeatures.items.' + it.titleKey) }}
      p.PassengerHomeFeatures__card-body {{ $t('homeFeatures.items.' + it.bodyKey) }}

  //- ── 3 步流程（從 Steps 合併進來，手機優先單欄）──────────
  .PassengerHomeFeatures__flow
    .PassengerHomeFeatures__flow-head
      .PassengerHomeFeatures__flow-label {{ $t('home.reasons.flowLabel') }}
      .PassengerHomeFeatures__flow-title {{ $t('home.reasons.flowTitle') }}
    .PassengerHomeFeatures__steps
      .PassengerHomeFeatures__step(v-for="(s, i) in steps" :key="s.id")
        .PassengerHomeFeatures__step-no {{ s.no }}
        .PassengerHomeFeatures__step-body
          .PassengerHomeFeatures__step-title {{ $t('homeSteps.items.' + s.titleKey) }}
          p.PassengerHomeFeatures__step-desc {{ $t('homeSteps.items.' + s.bodyKey) }}
        .PassengerHomeFeatures__step-connector(v-if="i < steps.length - 1")

  //- ── LINE Only 突顯卡（無需下載 APP）─────────────────────
  .PassengerHomeFeatures__line-only
    .PassengerHomeFeatures__line-only-badge {{ $t('home.reasons.lineOnlyBadge') }}
    .PassengerHomeFeatures__line-only-title {{ $t('home.reasons.lineOnlyTitle') }}
    p.PassengerHomeFeatures__line-only-body {{ $t('home.reasons.lineOnlyBody') }}
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

// ── 服務特色 4 卡 ─────────────────────────────────────────
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

// ── 3 步流程 ─────────────────────────────────────────────
.PassengerHomeFeatures__flow {
  margin-top: 40px;
  padding-top: 32px;
  border-top: 1.5px dashed rgba(212, 134, 10, 0.25);
}

.PassengerHomeFeatures__flow-head {
  margin-bottom: 20px;
}

.PassengerHomeFeatures__flow-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 6px;
}

.PassengerHomeFeatures__flow-title {
  font-family: $font-display;
  font-size: 30px;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  line-height: 1;
}

.PassengerHomeFeatures__steps {
  display: flex;
  flex-direction: column;
}

.PassengerHomeFeatures__step {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 14px;
  position: relative;
  padding-bottom: 24px;

  &:last-child {
    padding-bottom: 0;
  }
}

.PassengerHomeFeatures__step-no {
  font-family: $font-display;
  font-size: 36px;
  line-height: 1;
  color: var(--da-amber);
  width: 48px;
  text-align: center;
}

.PassengerHomeFeatures__step-body {
  padding-top: 4px;
}

.PassengerHomeFeatures__step-title {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  color: var(--da-dark);
  margin-bottom: 4px;
}

.PassengerHomeFeatures__step-desc {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.65;
}

.PassengerHomeFeatures__step-connector {
  position: absolute;
  left: 23px;
  top: 44px;
  bottom: 4px;
  width: 2px;
  background: repeating-linear-gradient(to bottom, var(--da-amber) 0 4px, transparent 4px 10px);
  opacity: 0.4;
}

// ── LINE Only 突顯卡 ─────────────────────────────────────
.PassengerHomeFeatures__line-only {
  margin-top: 32px;
  padding: 22px 20px;
  background: linear-gradient(135deg, rgba(6, 199, 85, 0.10), rgba(6, 199, 85, 0.02));
  border: 1.5px solid rgba(6, 199, 85, 0.4);
  border-radius: 16px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: #06c755;
  }
}

.PassengerHomeFeatures__line-only-badge {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #06c755;
  background: rgba(6, 199, 85, 0.12);
  padding: 4px 10px;
  border-radius: 100px;
  margin-bottom: 10px;
}

.PassengerHomeFeatures__line-only-title {
  font-family: $font-condensed;
  font-size: 20px;
  font-weight: 700;
  color: var(--da-dark);
  margin-bottom: 6px;
}

.PassengerHomeFeatures__line-only-body {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 400;
  color: var(--da-gray);
  line-height: 1.7;
}
</style>
