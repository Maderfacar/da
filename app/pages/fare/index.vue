<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageFare
  .PageFare__watermark FARE

  //- 頁首
  .PageFare__header
    .PageFare__header-label FARE REFERENCE
    h1.PageFare__header-title {{ $t('fare.title') }}
    p.PageFare__header-intro {{ $t('fare.intro') }}

  //- PRICING ENGINE — 3 卡計價引擎介紹
  section.PageFare__section.is-cream
    .PageFare__section-label {{ $t('fare.engine.label') }}
    h2.PageFare__section-title {{ $t('fare.engine.title') }}
    p.PageFare__section-desc {{ $t('fare.engine.desc') }}
    .PageFare__engine-grid
      .PageFare__engine-card
        .PageFare__engine-num 01
        .PageFare__engine-k {{ $t('fare.engine.card1Title') }}
        p.PageFare__engine-v {{ $t('fare.engine.card1Body') }}
      .PageFare__engine-card
        .PageFare__engine-num 02
        .PageFare__engine-k {{ $t('fare.engine.card2Title') }}
        p.PageFare__engine-v {{ $t('fare.engine.card2Body') }}
      .PageFare__engine-card
        .PageFare__engine-num 03
        .PageFare__engine-k {{ $t('fare.engine.card3Title') }}
        p.PageFare__engine-v {{ $t('fare.engine.card3Body') }}

  //- TRY IT — 乘客試算機
  section.PageFare__section.is-off-white
    .PageFare__section-label {{ $t('fare.calc.label') }}
    h2.PageFare__section-title {{ $t('fare.calc.title') }}
    p.PageFare__section-desc {{ $t('fare.calc.desc') }}
    PassengerFareEstimator

  .PageFare__stripe

  //- 結尾 CTA
  section.PageFare__cta
    h2.PageFare__cta-title {{ $t('fare.cta.title') }}
    p.PageFare__cta-desc {{ $t('fare.cta.desc') }}
    button.PageFare__cta-btn(type="button" @click="navigateTo('/booking')")
      | {{ $t('fare.cta.book') }}

  CommonFooter
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageFare {
  background: var(--da-off-white);
  color: var(--da-dark);
  min-height: 100svh;
  padding-top: 56px;
  position: relative;
  overflow-x: hidden;
}

.PageFare__watermark {
  position: fixed;
  top: 80px; right: -10px;
  font-family: $font-display;
  font-size: 100px;
  color: var(--da-dark);
  opacity: 0.04;
  pointer-events: none;
  user-select: none;
  letter-spacing: 0.04em;
}

// ── 頁首 ──────────────────────────────────────────────────
.PageFare__header {
  padding: 48px 24px 32px;
}

.PageFare__header-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 10px;
}

.PageFare__header-title {
  font-family: $font-display;
  font-size: clamp(48px, 14vw, 64px);
  line-height: 0.92;
  color: var(--da-dark);
}

.PageFare__header-intro {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  margin-top: 12px;
  line-height: 1.7;
  max-width: 320px;
}

// ── 區塊 ──────────────────────────────────────────────────
.PageFare__section {
  padding: 72px 24px;
  scroll-margin-top: 56px;
}

.PageFare__section.is-cream {
  background: var(--da-cream);
}

.PageFare__section.is-off-white {
  background: var(--da-off-white);
}

.PageFare__section-label {
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
}

.PageFare__section-label::before {
  content: '';
  width: 24px; height: 1.5px;
  background: var(--da-amber);
}

.PageFare__section-title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PageFare__section-desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
}

// ── 分隔線 ────────────────────────────────────────────────
.PageFare__stripe {
  height: 12px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow) 0px, var(--da-stripe-yellow) 12px,
    var(--da-stripe-dark) 12px, var(--da-stripe-dark) 24px
  );
  opacity: 0.85;
}

// ── PRICING ENGINE 卡 ─────────────────────────────────────
.PageFare__engine-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.PageFare__engine-card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  padding: 22px;
  position: relative;
  box-shadow: var(--da-glass-shadow);
}

.PageFare__engine-num {
  font-family: $font-display;
  font-size: 14px;
  letter-spacing: 0.2em;
  color: var(--da-amber);
  margin-bottom: 10px;
}

.PageFare__engine-k {
  font-family: $font-body;
  font-size: 18px;
  font-weight: 700;
  color: var(--da-dark);
  letter-spacing: 0.01em;
  line-height: 1.3;
  margin-bottom: 8px;
}

.PageFare__engine-v {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.75;
}

// ── 結尾 CTA ──────────────────────────────────────────────
.PageFare__cta {
  margin: 16px 24px 56px;
  padding: 32px 24px;
  background: var(--da-dark);
  border-radius: 20px;
  text-align: center;
}

.PageFare__cta-title {
  font-family: $font-display;
  font-size: 32px;
  color: var(--da-cream);
  letter-spacing: 0.04em;
}

.PageFare__cta-desc {
  font-family: $font-body;
  font-size: 13px;
  color: rgba(250,248,244,0.6);
  margin: 8px 0 20px;
}

.PageFare__cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 28px;
  background: var(--da-amber);
  color: var(--da-dark);
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: none;
  border-radius: 100px;
  cursor: pointer;
}

.PageFare__cta-btn:active {
  transform: scale(0.97);
}
</style>
