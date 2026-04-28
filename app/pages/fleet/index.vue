<script setup lang="ts">
import { VEHICLE_CONFIGS, EXTRA_SERVICES, EXTRA_SERVICE_PRICE } from '~shared/pricing';
import type { VehicleType } from '~shared/pricing';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

const VEHICLE_ORDER: VehicleType[] = ['sedan', 'suv', 'van', 'premium'];

const VEHICLE_ICONS: Record<VehicleType, string> = {
  sedan:   'mdi:car-side',
  suv:     'mdi:car-estate',
  van:     'mdi:van-utility',
  premium: 'mdi:car-convertible',
};

const vehicles = VEHICLE_ORDER.map((type) => ({
  ...VEHICLE_CONFIGS[type],
  icon: VEHICLE_ICONS[type],
}));

const activeVehicle = ref<VehicleType>('sedan');
const selected = computed(() => vehicles.find((v) => v.type === activeVehicle.value)!);

// 試算：25km 範例
const SAMPLE_KM = 25;
const sampleFare = computed(() => {
  const cfg = VEHICLE_CONFIGS[activeVehicle.value];
  return Math.ceil((cfg.baseFare + SAMPLE_KM * cfg.perKmRate) / 50) * 50;
});
</script>

<template lang="pug">
.PageFleet
  .PageFleet__watermark FLEET

  //- 頁首
  .PageFleet__header
    .PageFleet__header-label VEHICLE LINEUP
    h1.PageFleet__header-title {{ $t('fleet.title') }}
    p.PageFleet__header-sub ALL FLEET CLASSES

  //- 車型選擇列
  .PageFleet__selector
    button.PageFleet__selector-btn(
      v-for="v in vehicles"
      :key="v.type"
      :class="{ 'is-active': activeVehicle === v.type }"
      @click="activeVehicle = v.type"
    )
      NuxtIcon.PageFleet__selector-icon(:name="v.icon")
      span.PageFleet__selector-label {{ v.label }}
      span.PageFleet__selector-en {{ v.labelEn }}

  //- 車型詳情卡
  Transition(name="fleet-fade" mode="out-in")
    .PageFleet__detail(:key="activeVehicle")
      //- 車型圖示區
      .PageFleet__car-visual
        NuxtIcon.PageFleet__car-icon(:name="VEHICLE_ICONS[activeVehicle]")
        .PageFleet__car-badge {{ selected.labelEn }}

      //- 核心規格
      .PageFleet__specs
        .PageFleet__spec-item
          NuxtIcon(name="mdi:account-group")
          .PageFleet__spec-info
            span.PageFleet__spec-val {{ selected.capacity }} {{ $t('fleet.unit.person') }}
            span.PageFleet__spec-key {{ $t('fleet.spec.capacity') }}
        .PageFleet__spec-item
          NuxtIcon(name="mdi:bag-suitcase")
          .PageFleet__spec-info
            span.PageFleet__spec-val {{ selected.luggageCapacity }} {{ $t('fleet.unit.piece') }}
            span.PageFleet__spec-key {{ $t('fleet.spec.luggage') }}
        .PageFleet__spec-item
          NuxtIcon(name="mdi:currency-twd")
          .PageFleet__spec-info
            span.PageFleet__spec-val NT$ {{ selected.baseFare }}
            span.PageFleet__spec-key {{ $t('fleet.spec.baseFare') }}
        .PageFleet__spec-item
          NuxtIcon(name="mdi:map-marker-distance")
          .PageFleet__spec-info
            span.PageFleet__spec-val NT$ {{ selected.perKmRate }}
            span.PageFleet__spec-key {{ $t('fleet.spec.perKm') }}

      //- 車型描述
      p.PageFleet__desc {{ $t('fleet.desc.' + activeVehicle) }}

      //- 試算區
      .PageFleet__estimate
        .PageFleet__estimate-label {{ $t('fleet.estimate.label', { km: SAMPLE_KM }) }}
        .PageFleet__estimate-fare
          span NT$
          strong {{ sampleFare.toLocaleString() }}
        p.PageFleet__estimate-note {{ $t('fleet.estimate.note') }}

      //- 預約按鈕
      UiButton(type="primary" style="width:100%" @click="navigateTo('/booking')") {{ $t('fleet.bookBtn') }}

  //- 分隔線
  .PageFleet__stripe

  //- 額外服務
  .PageFleet__extras
    .PageFleet__extras-label EXTRA SERVICES
    h2.PageFleet__extras-title {{ $t('fleet.extras.title') }}
    .PageFleet__extras-grid
      .PageFleet__extra-card(v-for="svc in EXTRA_SERVICES" :key="svc.value")
        NuxtIcon.PageFleet__extra-icon(:name="svc.icon")
        span.PageFleet__extra-name {{ $t('fleet.extras.' + svc.value) }}
        span.PageFleet__extra-price + NT$ {{ EXTRA_SERVICE_PRICE }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageFleet {
  position: relative;
  min-height: 100vh;
  background: var(--da-cream);
  padding: 76px 16px 120px;
  overflow: hidden;
}

.PageFleet__watermark {
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
.PageFleet__header {
  margin-bottom: 28px;
}

.PageFleet__header-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before {
    content: '';
    width: 20px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageFleet__header-title {
  font-family: $font-display;
  font-size: 48px;
  color: var(--da-dark);
  letter-spacing: 0.02em;
  line-height: 0.9;
}

.PageFleet__header-sub {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--da-gray-light);
  margin-top: 4px;
}

// ── 車型選擇列 ─────────────────────────────────────────────
.PageFleet__selector {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 24px;
}

.PageFleet__selector-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 4px;
  border-radius: 14px;
  border: 1.5px solid var(--da-gray-pale);
  background: rgba(255,255,255,0.6);
  cursor: pointer;
  transition: all 0.2s;

  &.is-active {
    border-color: var(--da-amber);
    background: rgba(212, 134, 10, 0.08);
  }

  &:active { transform: scale(0.96); }
}

.PageFleet__selector-icon {
  font-size: 22px;
  color: var(--da-gray);

  .is-active & { color: var(--da-amber); }
}

.PageFleet__selector-label {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--da-gray);
  line-height: 1.1;

  .is-active & { color: var(--da-dark); }
}

.PageFleet__selector-en {
  font-family: $font-condensed;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--da-gray-light);
  text-transform: uppercase;

  .is-active & { color: var(--da-amber); }
}

// ── 詳情卡 ────────────────────────────────────────────────
.PageFleet__detail {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 24px;
  padding: 24px 20px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 4px 24px rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

// ── 車型圖示 ──────────────────────────────────────────────
.PageFleet__car-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 0 8px;
}

.PageFleet__car-icon {
  font-size: 72px;
  color: var(--da-dark);
  opacity: 0.85;
}

.PageFleet__car-badge {
  font-family: $font-display;
  font-size: 14px;
  letter-spacing: 0.25em;
  color: var(--da-amber);
  text-transform: uppercase;
  padding: 4px 14px;
  border: 1.5px solid var(--da-amber);
  border-radius: 100px;
}

// ── 規格列 ────────────────────────────────────────────────
.PageFleet__specs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.PageFleet__spec-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(26,24,20,0.04);
  border-radius: 12px;
  padding: 12px 14px;

  .nuxt-icon { font-size: 20px; color: var(--da-amber); flex-shrink: 0; }
}

.PageFleet__spec-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.PageFleet__spec-val {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  color: var(--da-dark);
  letter-spacing: 0.05em;
}

.PageFleet__spec-key {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--da-gray-light);
}

// ── 描述 ──────────────────────────────────────────────────
.PageFleet__desc {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
}

// ── 試算 ──────────────────────────────────────────────────
.PageFleet__estimate {
  background: var(--da-dark);
  border-radius: 16px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageFleet__estimate-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.4);
}

.PageFleet__estimate-fare {
  font-family: $font-display;
  font-size: 36px;
  color: var(--da-amber-light);
  letter-spacing: 0.04em;
  line-height: 1.1;

  span { font-size: 16px; margin-right: 4px; opacity: 0.7; }
}

.PageFleet__estimate-note {
  font-family: $font-condensed;
  font-size: 10px;
  color: rgba(255,255,255,0.25);
  letter-spacing: 0.08em;
  line-height: 1.5;
}

// ── 分隔線 ────────────────────────────────────────────────
.PageFleet__stripe {
  height: 10px;
  margin: 36px -16px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow) 0px, var(--da-stripe-yellow) 10px,
    var(--da-stripe-dark) 10px, var(--da-stripe-dark) 20px
  );
  opacity: 0.7;
}

// ── 加值服務 ──────────────────────────────────────────────
.PageFleet__extras {
  padding: 0 0 8px;
}

.PageFleet__extras-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before {
    content: '';
    width: 20px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageFleet__extras-title {
  font-family: $font-display;
  font-size: 36px;
  color: var(--da-dark);
  letter-spacing: 0.02em;
  margin-bottom: 20px;
}

.PageFleet__extras-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.PageFleet__extra-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 12px;
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  text-align: center;
}

.PageFleet__extra-icon {
  font-size: 28px;
  color: var(--da-amber);
}

.PageFleet__extra-name {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--da-dark);
}

.PageFleet__extra-price {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--da-amber);
}

// ── 切換動畫 ──────────────────────────────────────────────
.fleet-fade-enter-active,
.fleet-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.fleet-fade-enter-from,
.fleet-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
