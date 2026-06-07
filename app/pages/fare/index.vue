<script setup lang="ts">
// /fare — 路線參考價（/fleet 合併進來；2026-06-07）
//
// 結構順序：
//   1. VEHICLE LINEUP：車型 swiper（採 booking step 3 同款卡片視覺）+ 該車型 25km 樣本試算（沙盒）
//   2. TRY IT：PassengerFareEstimator（自己算算看；最終價格下方常駐車資說明）
//   3. PRICING ENGINE：3 卡計費引擎介紹
//   4. CTA：前往訂車試算
import { Swiper, SwiperSlide } from 'swiper/vue';
import { Navigation } from 'swiper/modules';
import type { Swiper as SwiperInstance } from 'swiper/types';
import 'swiper/css';
import 'swiper/css/navigation';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t, locale } = useI18n();
const storeConfig = StoreConfig();

const vehicles = computed(() => storeConfig.EnabledVehicles);

// 預設 active 為第一台啟用車型
const activeVehicleId = ref<string>('');
watch(vehicles, (list) => {
  if (!activeVehicleId.value && list.length > 0) activeVehicleId.value = list[0].id;
}, { immediate: true });

const activeVehicle = computed(() =>
  storeConfig.GetVehicle(activeVehicleId.value),
);

const Loc = (label: { zh: string; en: string; ja: string } | undefined) =>
  storeConfig.LabelOf(label, locale.value as 'zh' | 'en' | 'ja');

// ── 沙盒：25 公里樣本試算 ───────────────────────────────────
const SAMPLE_KM = 25;
const sampleFare = computed(() => {
  const cfg = activeVehicle.value;
  if (!cfg) return 0;
  return Math.ceil((cfg.baseFare + SAMPLE_KM * cfg.perKmRate) / 50) * 50;
});

// ── Swiper ──────────────────────────────────────────────────
const swiperRef = ref<SwiperInstance | null>(null);
const OnSwiperReady = (sw: SwiperInstance) => { swiperRef.value = sw; };
const ClickSwiperPrev = () => swiperRef.value?.slidePrev();
const ClickSwiperNext = () => swiperRef.value?.slideNext();
const swiperModules = [Navigation];
const swiperBreakpoints = {
  0: { slidesPerView: 1.2, spaceBetween: 10 },
  480: { slidesPerView: 1.5, spaceBetween: 12 },
  768: { slidesPerView: 2.2, spaceBetween: 14 },
  1024: { slidesPerView: 2.5, spaceBetween: 16 },
};

const ClickVehicleCard = (id: string) => { activeVehicleId.value = id; };
const ClickBookActiveVehicle = () => {
  if (!activeVehicleId.value) return;
  navigateTo({ path: '/booking', query: { vehicleType: activeVehicleId.value } });
};
</script>

<template lang="pug">
.PageFare
  .PageFare__watermark FARE

  //- 頁首
  .PageFare__header
    .PageFare__header-label FARE REFERENCE
    h1.PageFare__header-title {{ $t('fare.title') }}
    p.PageFare__header-intro {{ $t('fare.intro') }}

  //- ── Section 1：VEHICLE LINEUP — 車型 slider + 沙盒（25km 樣本試算）──
  section.PageFare__section.is-cream
    .PageFare__section-label {{ $t('fare.vehicle.label') }}
    h2.PageFare__section-title {{ $t('fare.vehicle.title') }}
    p.PageFare__section-desc {{ $t('fare.vehicle.desc') }}

    .PageFare__slider(v-if="vehicles.length")
      button.PageFare__slider-nav.is-prev(
        type="button"
        :aria-label="$t('fare.vehicle.prev')"
        @click="ClickSwiperPrev"
      ) ‹
      Swiper.PageFare__swiper(
        :modules="swiperModules"
        :breakpoints="swiperBreakpoints"
        :grab-cursor="true"
        :centered-slides="false"
        :slides-per-view="1.5"
        :space-between="12"
        :watch-overflow="true"
        @swiper="OnSwiperReady"
      )
        SwiperSlide(v-for="cfg in vehicles" :key="cfg.id")
          .PageFare__vehicle-card(
            :class="[{ 'is-active': activeVehicleId === cfg.id }, /(business|vip)/.test(cfg.id) ? 'is-luxury' : 'is-standard']"
            @click="ClickVehicleCard(cfg.id)"
          )
            //- 主視覺：有 images.exterior 顯示縮圖，否則 fallback mdi icon
            .PageFare__vehicle-hero(v-if="cfg.images?.exterior")
              img.PageFare__vehicle-hero-img(:src="cfg.images.exterior" :alt="cfg.label.en")
            .PageFare__vehicle-hero.is-icon(v-else)
              NuxtIcon.PageFare__vehicle-hero-icon(:name="cfg.icon")
            .PageFare__vehicle-name {{ Loc(cfg.label) }}
            .PageFare__vehicle-sub {{ cfg.label.en }}
            .PageFare__vehicle-specs
              span
                NuxtIcon(name="mdi:account-group")
                | {{ cfg.capacity }} {{ $t('fleet.unit.person') }}
              span(v-if="cfg.luggageDescription && Loc(cfg.luggageDescription)")
                NuxtIcon(name="mdi:bag-suitcase")
                | {{ Loc(cfg.luggageDescription) }}
            .PageFare__vehicle-fare
              | {{ $t('booking.options.baseFare', { fare: cfg.baseFare }) }}
              span + NT${{ cfg.perKmRate }}/km
            .PageFare__vehicle-tagline(v-if="cfg.tagline && Loc(cfg.tagline)") {{ Loc(cfg.tagline) }}
      button.PageFare__slider-nav.is-next(
        type="button"
        :aria-label="$t('fare.vehicle.next')"
        @click="ClickSwiperNext"
      ) ›

    //- 沙盒：當前選中車型的 25 公里樣本試算（黑底卡，呈現方式對齊 booking 估價樣式）
    Transition(name="fare-sandbox-fade" mode="out-in")
      .PageFare__sandbox(v-if="activeVehicle" :key="activeVehicleId")
        .PageFare__sandbox-head
          .PageFare__sandbox-eyebrow {{ $t('fare.vehicle.sampleLabel') }}
          .PageFare__sandbox-name {{ Loc(activeVehicle.label) }}
        .PageFare__sandbox-specs
          .PageFare__sandbox-spec
            NuxtIcon(name="mdi:account-group")
            .PageFare__sandbox-spec-val {{ activeVehicle.capacity }} {{ $t('fleet.unit.person') }}
            .PageFare__sandbox-spec-key {{ $t('fare.vehicle.specCapacity') }}
          .PageFare__sandbox-spec(v-if="activeVehicle.luggageDescription && Loc(activeVehicle.luggageDescription)")
            NuxtIcon(name="mdi:bag-suitcase")
            .PageFare__sandbox-spec-val {{ Loc(activeVehicle.luggageDescription) }}
            .PageFare__sandbox-spec-key {{ $t('fare.vehicle.specLuggage') }}
          .PageFare__sandbox-spec
            NuxtIcon(name="mdi:currency-twd")
            .PageFare__sandbox-spec-val NT$ {{ activeVehicle.baseFare }}
            .PageFare__sandbox-spec-key {{ $t('fare.vehicle.specBaseFare') }}
          .PageFare__sandbox-spec
            NuxtIcon(name="mdi:map-marker-distance")
            .PageFare__sandbox-spec-val NT$ {{ activeVehicle.perKmRate }}
            .PageFare__sandbox-spec-key {{ $t('fare.vehicle.specPerKm') }}
        .PageFare__sandbox-fare
          span.PageFare__sandbox-fare-cur NT$
          strong.PageFare__sandbox-fare-num {{ sampleFare.toLocaleString() }}
        p.PageFare__sandbox-note {{ $t('fare.vehicle.sampleNote') }}
        button.PageFare__sandbox-book(type="button" @click="ClickBookActiveVehicle") {{ $t('fare.vehicle.bookBtn') }}

  //- ── Section 2：TRY IT — 車資試算（自己算算看；含車資說明在最終價格下方）──
  section.PageFare__section.is-off-white
    .PageFare__section-label {{ $t('fare.calc.label') }}
    h2.PageFare__section-title {{ $t('fare.calc.title') }}
    p.PageFare__section-desc {{ $t('fare.calc.desc') }}
    PassengerFareEstimator

  .PageFare__stripe

  //- ── Section 3：PRICING ENGINE — 3 卡計價引擎介紹 ──
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

  .PageFare__stripe

  //- ── 結尾 CTA ──
  section.PageFare__cta
    h2.PageFare__cta-title {{ $t('fare.cta.title') }}
    p.PageFare__cta-desc {{ $t('fare.cta.desc') }}
    button.PageFare__cta-btn(type="button" @click="navigateTo('/booking')")
      | {{ $t('fare.cta.book') }}
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
  max-width: 420px;
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

// ── 車型 slider（booking step3 同款）─────────────────────
.PageFare__slider {
  position: relative;
  margin: 0 -8px 28px;
}

.PageFare__swiper {
  padding: 4px 8px 12px;
}

.PageFare__slider-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--da-gray-pale);
  background: rgba(255, 255, 255, 0.92);
  color: var(--da-dark);
  font-size: 22px;
  font-family: $font-display;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: background 0.15s, transform 0.1s;

  &.is-prev { left: 0; }
  &.is-next { right: 0; }

  &:hover { background: #fff; }
  &:active { transform: translateY(-50%) scale(0.92); }
}

.PageFare__vehicle-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.85);
  border: 1.5px solid var(--da-glass-border);
  border-radius: 18px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s;
  overflow: hidden;
  min-height: 280px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
  }

  &.is-active {
    border-color: var(--da-amber);
    box-shadow: 0 8px 24px rgba(212, 134, 10, 0.18);
  }

  &.is-luxury {
    background: linear-gradient(165deg, #1a1814 0%, #2a2520 100%);
    border-color: rgba(212, 134, 10, 0.32);
    color: var(--da-cream);

    &.is-active { border-color: var(--da-amber); }
  }
}

.PageFare__vehicle-hero {
  width: 100%;
  height: 110px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;

  .is-luxury & { background: rgba(255, 255, 255, 0.05); }

  &.is-icon {
    background: rgba(212, 134, 10, 0.08);

    .is-luxury & { background: rgba(212, 134, 10, 0.14); }
  }
}

.PageFare__vehicle-hero-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.PageFare__vehicle-hero-icon {
  font-size: 52px;
  color: var(--da-amber);
}

.PageFare__vehicle-name {
  font-family: $font-body;
  font-size: 17px;
  font-weight: 700;
  color: var(--da-dark);
  letter-spacing: 0.01em;
  line-height: 1.2;

  .is-luxury & { color: var(--da-cream); }
}

.PageFare__vehicle-sub {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.15em;
  color: var(--da-gray);
  text-transform: uppercase;
  margin-top: 2px;

  .is-luxury & { color: var(--da-amber); }
}

.PageFare__vehicle-specs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 10px;
  font-family: $font-condensed;
  font-size: 12px;
  color: var(--da-gray);

  .is-luxury & { color: rgba(250, 248, 244, 0.7); }

  span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .nuxt-icon { font-size: 14px; color: var(--da-amber); }
}

.PageFare__vehicle-fare {
  margin-top: 10px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--da-dark);

  .is-luxury & { color: var(--da-cream); }

  span {
    display: block;
    font-weight: 500;
    font-size: 11px;
    color: var(--da-gray);
    margin-top: 2px;

    .is-luxury & { color: rgba(250, 248, 244, 0.55); }
  }
}

.PageFare__vehicle-tagline {
  margin-top: 8px;
  font-family: $font-body;
  font-size: 12px;
  line-height: 1.55;
  color: var(--da-gray);

  .is-luxury & { color: rgba(250, 248, 244, 0.65); }
}

// ── 沙盒：黑底樣本試算卡 ─────────────────────────────────
.PageFare__sandbox {
  background: var(--da-dark);
  color: var(--da-cream);
  border-radius: 18px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.PageFare__sandbox-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
  padding-bottom: 12px;
}

.PageFare__sandbox-eyebrow {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--da-amber);
}

.PageFare__sandbox-name {
  font-family: $font-body;
  font-size: 15px;
  font-weight: 700;
  color: var(--da-cream);
}

.PageFare__sandbox-specs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.PageFare__sandbox-spec {
  display: grid;
  grid-template-columns: 22px 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 10px 12px;

  .nuxt-icon {
    grid-row: 1 / span 2;
    font-size: 18px;
    color: var(--da-amber);
  }
}

.PageFare__sandbox-spec-val {
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--da-cream);
}

.PageFare__sandbox-spec-key {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(250, 248, 244, 0.4);
}

.PageFare__sandbox-fare {
  margin-top: 6px;
  font-family: $font-display;
  font-size: 40px;
  letter-spacing: 0.04em;
  color: var(--da-amber-light);
  line-height: 1.1;
}

.PageFare__sandbox-fare-cur {
  font-size: 18px;
  margin-right: 4px;
  opacity: 0.7;
}

.PageFare__sandbox-fare-num {
  font-weight: 400;
}

.PageFare__sandbox-note {
  font-family: $font-body;
  font-size: 12px;
  color: rgba(250, 248, 244, 0.45);
  line-height: 1.55;
}

.PageFare__sandbox-book {
  margin-top: 6px;
  padding: 12px 18px;
  background: var(--da-amber);
  color: var(--da-dark);
  border: none;
  border-radius: 100px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.1s;

  &:active { transform: scale(0.97); }
}

.fare-sandbox-fade-enter-active,
.fare-sandbox-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.fare-sandbox-fade-enter-from,
.fare-sandbox-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
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
