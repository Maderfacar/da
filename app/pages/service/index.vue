<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageService
  .PageService__watermark SERVICE

  //- 頁首
  .PageService__header
    .PageService__header-label HOW WE SERVE
    h1.PageService__header-title {{ $t('service.title') }}
    p.PageService__header-intro {{ $t('service.intro') }}

  //- 四種行程（合併原 howItWorks + 接機/送機，並加入交通接送與包車）
  section.PageService__section.is-cream
    .PageService__section-label {{ $t('service.tripTypes.label') }}
    h2.PageService__section-title {{ $t('service.tripTypes.title') }}
    p.PageService__section-desc {{ $t('service.tripTypes.desc') }}
    .PageService__pass-grid
      .PageService__pass-card
        .PageService__pass-tag {{ $t('service.tripTypes.pickup.tag') }}
        .PageService__pass-title {{ $t('service.tripTypes.pickup.title') }}
        p.PageService__pass-body {{ $t('service.tripTypes.pickup.body') }}
      .PageService__pass-card
        .PageService__pass-tag {{ $t('service.tripTypes.dropoff.tag') }}
        .PageService__pass-title {{ $t('service.tripTypes.dropoff.title') }}
        p.PageService__pass-body {{ $t('service.tripTypes.dropoff.body') }}
      .PageService__pass-card
        .PageService__pass-tag {{ $t('service.tripTypes.transfer.tag') }}
        .PageService__pass-title {{ $t('service.tripTypes.transfer.title') }}
        p.PageService__pass-body {{ $t('service.tripTypes.transfer.body') }}
      .PageService__pass-card
        .PageService__pass-tag {{ $t('service.tripTypes.charter.tag') }}
        .PageService__pass-title {{ $t('service.tripTypes.charter.title') }}
        p.PageService__pass-body {{ $t('service.tripTypes.charter.body') }}

  .PageService__stripe

  //- 航班延誤政策
  section.PageService__section.is-off-white
    .PageService__section-label {{ $t('service.delay.label') }}
    h2.PageService__section-title {{ $t('service.delay.title') }}
    p.PageService__section-desc {{ $t('service.delay.desc') }}
    .PageService__policy
      .PageService__policy-row
        .PageService__policy-k {{ $t('service.delay.pickupTitle') }}
        .PageService__policy-v {{ $t('service.delay.pickupBody') }}
      .PageService__policy-row
        .PageService__policy-k {{ $t('service.delay.dropoffTitle') }}
        .PageService__policy-v {{ $t('service.delay.dropoffBody') }}
      .PageService__policy-note {{ $t('service.delay.overtime') }}
    .PageService__policy-reassign
      .PageService__policy-reassign-tag REASSIGN
      p.PageService__policy-reassign-body {{ $t('service.delay.reassign') }}

  .PageService__stripe

  //- 司機與保障
  section.PageService__section.is-cream
    .PageService__section-label {{ $t('service.trust.label') }}
    h2.PageService__section-title {{ $t('service.trust.title') }}
    p.PageService__section-desc {{ $t('service.trust.desc') }}
    ul.PageService__trust-list
      li {{ $t('service.trust.driver') }}
      li {{ $t('service.trust.insurance') }}
      li {{ $t('service.trust.sign') }}
      li {{ $t('service.trust.lawfulVehicle') }}
      li {{ $t('service.trust.dispatchPolicy') }}

  .PageService__stripe

  //- 品牌簡述
  section.PageService__section.is-off-white
    .PageService__section-label {{ $t('service.brand.label') }}
    h2.PageService__section-title {{ $t('service.brand.title') }}
    p.PageService__section-desc {{ $t('service.brand.desc') }}
    .PageService__prose
      p {{ $t('service.brand.body') }}

  //- 結尾 CTA
  section.PageService__cta
    h2.PageService__cta-title {{ $t('service.cta.title') }}
    p.PageService__cta-desc {{ $t('service.cta.desc') }}
    button.PageService__cta-btn(type="button" @click="navigateTo('/booking')")
      | {{ $t('service.cta.book') }}

  CommonFooter
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageService {
  background: var(--da-off-white);
  color: var(--da-dark);
  min-height: 100svh;
  padding-top: 56px;
  position: relative;
  overflow-x: hidden;
}

.PageService__watermark {
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
.PageService__header {
  padding: 48px 24px 32px;
}

.PageService__header-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 10px;
}

.PageService__header-title {
  font-family: $font-display;
  font-size: clamp(48px, 14vw, 64px);
  line-height: 0.92;
  color: var(--da-dark);
}

.PageService__header-intro {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  margin-top: 12px;
  line-height: 1.7;
  max-width: 320px;
}

// ── SECTION ───────────────────────────────────────────────
.PageService__section {
  padding: 96px 24px;
  scroll-margin-top: 56px;

  @include rwd-pc-big {
    padding: 120px 32px;
  }
}

.PageService__section.is-cream {
  background: var(--da-cream);
}

.PageService__section.is-off-white {
  background: var(--da-off-white);
}

.PageService__section-label {
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
    width: 24px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageService__section-title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PageService__section-desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
}

// ── STRIPE DIVIDER ────────────────────────────────────────
.PageService__stripe {
  height: 12px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow) 0px, var(--da-stripe-yellow) 12px,
    var(--da-stripe-dark) 12px, var(--da-stripe-dark) 24px
  );
  opacity: 0.85;
}

// ── 段落文字 ──────────────────────────────────────────────
.PageService__prose p {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.8;
  margin-bottom: 12px;
}

// ── 接機 vs 送機 ──────────────────────────────────────────
.PageService__pass-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.PageService__pass-card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  padding: 22px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px; height: 100%;
    background: var(--da-amber);
    border-radius: 20px 0 0 20px;
  }
}

.PageService__pass-tag {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--da-amber);
}

.PageService__pass-title {
  font-family: $font-display;
  font-size: 30px;
  color: var(--da-dark);
  letter-spacing: 0.04em;
  margin: 4px 0 10px;
}

.PageService__pass-body {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.75;
}

// ── 航班延誤政策 ──────────────────────────────────────────
.PageService__policy {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  padding: 8px 20px;
}

.PageService__policy-row {
  padding: 16px 0;
  border-bottom: 1px solid var(--da-gray-pale);
}

.PageService__policy-row:last-of-type {
  border-bottom: none;
}

.PageService__policy-k {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 4px;
}

.PageService__policy-v {
  font-family: $font-body;
  font-size: 14px;
  color: var(--da-dark);
  line-height: 1.6;
}

.PageService__policy-note {
  font-family: $font-body;
  font-size: 13px;
  color: var(--da-gray);
  padding: 14px 0;
  font-weight: 500;
}

// ── 司機重派提示（航班延誤 fallback） ──────────────────────
.PageService__policy-reassign {
  margin-top: 18px;
  padding: 18px 22px;
  background: var(--da-dark);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px; height: 100%;
    background: var(--da-amber);
  }
}

.PageService__policy-reassign-tag {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--da-amber);
}

.PageService__policy-reassign-body {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-cream);
  line-height: 1.7;
  margin: 0;
}

// ── 司機與保障 ────────────────────────────────────────────
.PageService__trust-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PageService__trust-list li {
  font-family: $font-body;
  font-size: 14px;
  color: var(--da-gray);
  line-height: 1.7;
  padding-left: 22px;
  position: relative;

  &::before {
    content: '✈';
    position: absolute;
    left: 0;
    color: var(--da-amber);
  }
}

// ── 結尾 CTA ──────────────────────────────────────────────
.PageService__cta {
  margin: 16px 24px 56px;
  padding: 32px 24px;
  background: var(--da-dark);
  border-radius: 20px;
  text-align: center;
}

.PageService__cta-title {
  font-family: $font-display;
  font-size: 32px;
  color: var(--da-cream);
  letter-spacing: 0.04em;
}

.PageService__cta-desc {
  font-family: $font-body;
  font-size: 13px;
  color: rgba(250, 248, 244, 0.6);
  margin: 8px 0 20px;
}

.PageService__cta-btn {
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

.PageService__cta-btn:active {
  transform: scale(0.97);
}
</style>
