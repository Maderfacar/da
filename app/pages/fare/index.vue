<script setup lang="ts">
import { calculateFare } from '~shared/pricing';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const storeConfig = StoreConfig();

// 標準車型：第一台啟用車型（依 sortOrder）
const standardVehicle = computed(() => storeConfig.EnabledVehicles[0]);

// 每條示範路線的參考起價（標準車型 + 路線固定 km，無額外服務）
interface SampleFare {
  id: string;
  fromCode: string;
  toCode: string;
  fromKey: string;
  toKey: string;
  km: number;
  flightNo: string;
  fare: number;
}

const sampleFares = computed<SampleFare[]>(() => {
  const v = standardVehicle.value;
  if (!v) return [];
  return POPULAR_ROUTES.map((r) => ({
    id: r.id,
    fromCode: r.fromCode,
    toCode: r.toCode,
    fromKey: r.fromKey,
    toKey: r.toKey,
    km: r.km,
    flightNo: r.flightNo,
    fare: calculateFare(v, r.km, []),
  }));
});
</script>

<template lang="pug">
.PageFare
  .PageFare__watermark FARE

  //- 頁首
  .PageFare__header
    .PageFare__header-label FARE REFERENCE
    h1.PageFare__header-title {{ $t('fare.title') }}
    p.PageFare__header-intro {{ $t('fare.intro') }}

  //- 計價方式
  section.PageFare__section.is-cream
    .PageFare__section-label {{ $t('fare.how.label') }}
    h2.PageFare__section-title {{ $t('fare.how.title') }}
    p.PageFare__section-desc {{ $t('fare.how.desc') }}
    .PageFare__how-grid
      .PageFare__how-card
        .PageFare__how-k {{ $t('fare.how.baseTitle') }}
        p.PageFare__how-v {{ $t('fare.how.baseBody') }}
      .PageFare__how-card
        .PageFare__how-k {{ $t('fare.how.kmTitle') }}
        p.PageFare__how-v {{ $t('fare.how.kmBody') }}

  .PageFare__stripe

  //- 示範路線估價
  section.PageFare__section.is-off-white
    .PageFare__section-label {{ $t('fare.samples.label') }}
    h2.PageFare__section-title {{ $t('fare.samples.title') }}
    p.PageFare__section-desc {{ $t('fare.samples.desc') }}
    .PageFare__tickets
      .PageFare__ticket(v-for="s in sampleFares" :key="s.id")
        .PageFare__ticket-head
          .PageFare__ticket-route
            span.PageFare__ticket-code {{ s.fromCode }}
            span.PageFare__ticket-arrow ✈
            span.PageFare__ticket-code {{ s.toCode }}
          span.PageFare__ticket-flightno {{ s.flightNo }}
        .PageFare__ticket-names
          | {{ $t('routeBoard.routes.' + s.fromKey) }} → {{ $t('routeBoard.routes.' + s.toKey) }}
        .PageFare__ticket-stub
          .PageFare__ticket-km {{ $t('fare.samples.kmLabel', { km: s.km }) }}
          .PageFare__ticket-fare
            .PageFare__ticket-fare-label {{ $t('fare.samples.estLabel') }}
            .PageFare__ticket-fare-val NT${{ s.fare.toLocaleString() }}

  .PageFare__stripe

  //- 進階規則
  section.PageFare__section.is-cream
    .PageFare__section-label {{ $t('fare.advanced.label') }}
    h2.PageFare__section-title {{ $t('fare.advanced.title') }}
    p.PageFare__section-desc {{ $t('fare.advanced.desc') }}
    ul.PageFare__adv-list
      li {{ $t('fare.advanced.mountain') }}
      li {{ $t('fare.advanced.crossCounty') }}
      li {{ $t('fare.advanced.surcharge') }}
      li {{ $t('fare.advanced.promo') }}
    p.PageFare__disclaimer {{ $t('fare.disclaimer') }}

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

  &::before {
    content: '';
    width: 24px; height: 1.5px;
    background: var(--da-amber);
  }
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

// ── 計價方式 ──────────────────────────────────────────────
.PageFare__how-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.PageFare__how-card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  padding: 20px;
}

.PageFare__how-k {
  font-family: $font-display;
  font-size: 24px;
  color: var(--da-amber);
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.PageFare__how-v {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
}

// ── 示範路線估價票券 ──────────────────────────────────────
.PageFare__tickets {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.PageFare__ticket {
  background: var(--da-cream);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  overflow: hidden;
}

.PageFare__ticket-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
}

.PageFare__ticket-route {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PageFare__ticket-code {
  font-family: $font-display;
  font-size: 30px;
  color: var(--da-dark);
  letter-spacing: 0.04em;
}

.PageFare__ticket-arrow {
  color: var(--da-amber);
  font-size: 16px;
}

.PageFare__ticket-flightno {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--da-gray-light);
}

.PageFare__ticket-names {
  padding: 0 20px 12px;
  font-family: $font-body;
  font-size: 13px;
  color: var(--da-gray);
}

.PageFare__ticket-stub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-top: 2px dashed var(--da-gray-pale);
  background: var(--da-off-white);
}

.PageFare__ticket-km {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--da-gray);
}

.PageFare__ticket-fare {
  text-align: right;
}

.PageFare__ticket-fare-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageFare__ticket-fare-val {
  font-family: $font-display;
  font-size: 28px;
  color: var(--da-amber);
}

// ── 進階規則 ──────────────────────────────────────────────
.PageFare__adv-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PageFare__adv-list li {
  font-family: $font-body;
  font-size: 14px;
  color: var(--da-gray);
  line-height: 1.7;
  padding-left: 22px;
  position: relative;
}

.PageFare__adv-list li::before {
  content: '✈';
  position: absolute;
  left: 0;
  color: var(--da-amber);
}

.PageFare__disclaimer {
  font-family: $font-body;
  font-size: 12px;
  color: var(--da-gray-light);
  line-height: 1.7;
  margin-top: 18px;
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
