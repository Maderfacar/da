<script setup lang="ts">
// /fare — 車型介紹（/fleet 合併進來；2026-06-07）
//
// 結構順序（2026-06-07 v2）：
//   1. VEHICLE LINEUP：車型 swiper（採 booking step 3 同款卡片視覺；hero 圖區拉高凸顯車型照片）
//   2. TRY IT：PassengerFareEstimator（自己算算看；最終價格下方常駐車資說明）
//   3. PRICING ENGINE：3 卡計費引擎介紹
//   4. CTA：前往訂車試算
//
// 已移除：頁首 hero 區（路線參考價 title）/ 車型 slider 下方 25km 黑底樣本試算沙盒
import { Swiper, SwiperSlide } from 'swiper/vue';
import { Navigation } from 'swiper/modules';
import type { Swiper as SwiperInstance } from 'swiper/types';
import 'swiper/css';
import 'swiper/css/navigation';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { locale, t } = useI18n();
const storeConfig = StoreConfig();

// W2 AEO：description / OG / twitter（title 由 front-desk layout titleTemplate 處理）
useSeoMeta({
  description: () => t('meta.description.passenger.fare'),
  ogType: 'website',
  ogTitle: () => `${t('meta.title.passenger.fare')} · ${t('meta.brand.passenger')}`,
  ogDescription: () => t('meta.description.passenger.fare'),
  twitterCard: 'summary_large_image',
});

// W3 AEO：Service + PriceSpecification JSON-LD
// 描述計價結構（基本起跳 + 里程費 + 加成），給 AI 解析「車資怎麼算」
// SSR fix（2026-06-25）：children → innerHTML，函式形式 → 同步陣列（對齊 Nuxt 官方範例）
const _siteConfig = useRuntimeConfig();
const _siteUrl = (_siteConfig.public.siteUrl as string) || 'https://da-line-liff-app.vercel.app';
const _fareLd = JSON.stringify(buildFareServiceLd(_siteUrl, t));
useHead({
  script: [
    { type: 'application/ld+json', innerHTML: _fareLd },
  ],
});

const vehicles = computed(() => storeConfig.EnabledVehicles);

// 預設 active 為第一台啟用車型（控制 vehicle-card 的 is-active class）
const activeVehicleId = ref<string>('');
watch(vehicles, (list) => {
  if (!activeVehicleId.value && list.length > 0) activeVehicleId.value = list[0].id;
}, { immediate: true });

const Loc = (label: { zh: string; en: string; ja: string } | undefined) =>
  storeConfig.LabelOf(label, locale.value as 'zh' | 'en' | 'ja');

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
</script>

<template lang="pug">
.PageFare
  //- W4 AEO：visually-hidden h1（語意化頂層標題給爬蟲，視覺由 watermark / section h2 主導）
  h1.sr-only {{ $t('meta.h1.passenger.fare') }}
  .PageFare__watermark FLEET

  //- ── Section 1：VEHICLE LINEUP — 車型 slider（hero 區拉高凸顯車型照片）──
  section.PageFare__section.is-cream.is-top
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
            :class="{ 'is-active': activeVehicleId === cfg.id }"
            @click="ClickVehicleCard(cfg.id)"
          )
            //- 主視覺：有 images.exterior 顯示縮圖，否則 fallback mdi icon
            .PageFare__vehicle-hero(v-if="cfg.images?.exterior")
              img.PageFare__vehicle-hero-img(:src="cfg.images.exterior" :alt="cfg.label.en")
            .PageFare__vehicle-hero.is-icon(v-else)
              NuxtIcon.PageFare__vehicle-hero-icon(:name="cfg.icon")
            //- 毛玻璃底欄（對齊 booking step3 vehicle-body；移除起跳價 + 每公里費率，價格僅在試算機呈現）
            .PageFare__vehicle-body
              .PageFare__vehicle-name {{ Loc(cfg.label) }}
              .PageFare__vehicle-sub {{ cfg.label.en }}
              .PageFare__vehicle-specs
                span
                  NuxtIcon(name="mdi:account-group")
                  | {{ cfg.capacity }} {{ $t('fleet.unit.person') }}
                span(v-if="cfg.luggageDescription && Loc(cfg.luggageDescription)")
                  NuxtIcon(name="mdi:bag-suitcase")
                  | {{ Loc(cfg.luggageDescription) }}
              .PageFare__vehicle-tagline(v-if="cfg.tagline && Loc(cfg.tagline)") {{ Loc(cfg.tagline) }}
      button.PageFare__slider-nav.is-next(
        type="button"
        :aria-label="$t('fare.vehicle.next')"
        @click="ClickSwiperNext"
      ) ›

  //- ── Section 2：自己算算看（合併原 engine 段落：公式說明 + 試算機 + 2 張小卡）──
  section.PageFare__section.is-off-white
    .PageFare__section-label {{ $t('fare.calc.label') }}
    h2.PageFare__section-title {{ $t('fare.calc.title') }}
    p.PageFare__section-desc {{ $t('fare.engine.desc') }}
    p.PageFare__section-desc {{ $t('fare.calc.desc') }}
    PassengerFareEstimator
    .PageFare__engine-grid
      .PageFare__engine-card
        .PageFare__engine-num 01
        .PageFare__engine-k {{ $t('fare.engine.card1Title') }}
        p.PageFare__engine-v {{ $t('fare.engine.card1Body') }}
      .PageFare__engine-card
        .PageFare__engine-num 02
        .PageFare__engine-k {{ $t('fare.engine.card2Title') }}
        p.PageFare__engine-v {{ $t('fare.engine.card2Body') }}

  .PageFare__stripe

  //- ── 結尾 CTA ──
  section.PageFare__cta
    h2.PageFare__cta-title {{ $t('fare.cta.title') }}
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

// ── 區塊 ──────────────────────────────────────────────────
.PageFare__section {
  padding: 72px 24px;
  scroll-margin-top: 56px;

  &.is-top { padding-top: 48px; }
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
  border: 1.5px solid var(--da-glass-border);
  border-radius: 20px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s;
  overflow: hidden;
  height: 380px;
  box-sizing: border-box;

  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
  }

  &.is-active {
    border-color: var(--da-amber);
    box-shadow: 0 10px 28px rgba(212, 134, 10, 0.18);
  }
}

// 車型 hero：鎖定固定高 220px，body 拿剩餘 160px（與 booking __vehicle-hero 對齊）
// 改回固定高的理由：body 內容（tagline v-if）會晃高度導致 flex:1 hero 圖片高低不一
.PageFare__vehicle-hero {
  flex: none;
  height: 220px;
  background: rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;

  &.is-icon {
    background: rgba(212, 134, 10, 0.08);
  }
}

.PageFare__vehicle-hero-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
}

.PageFare__vehicle-hero-icon {
  font-size: 72px;
  color: var(--da-amber);
}

// 毛玻璃底欄：拿 hero 後剩餘 160px；body 內容浮動但區域高度鎖死（與 booking __vehicle-body 完全對齊）
.PageFare__vehicle-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 14px 18px 16px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(250, 248, 244, 0.82);
  border-top: 1px solid rgba(255, 255, 255, 0.7);
  display: flex;
  flex-direction: column;
  gap: 5px;

  .PageFare__vehicle-card.is-active & {
    background: rgba(255, 245, 220, 0.88);
  }
}

.PageFare__vehicle-name {
  font-family: $font-body;
  font-size: 16px;
  font-weight: 700;
  color: var(--da-dark);
  letter-spacing: 0.01em;
  line-height: 1.2;
}

.PageFare__vehicle-sub {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--da-gray);
  text-transform: uppercase;
}

.PageFare__vehicle-specs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-family: $font-condensed;
  font-size: 13px;
  color: var(--da-gray);

  span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .nuxt-icon { font-size: 14px; color: var(--da-amber); }
}

.PageFare__vehicle-fare {
  font-family: $font-condensed;
  font-size: 13px;
  color: var(--da-gray);
  display: flex;
  gap: 6px;
  align-items: center;

  span { color: var(--da-amber); font-size: 12px; }
}

.PageFare__vehicle-tagline {
  font-family: $font-body;
  font-size: 12px;
  line-height: 1.4;
  color: var(--da-gray);
}

// ── PRICING ENGINE 卡 ─────────────────────────────────────
.PageFare__engine-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 48px;
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
