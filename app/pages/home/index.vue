<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

// ── Wave 2 P4：「下一趟」單張卡片（取代原 upcoming 三筆列表，/upcoming 整頁刪除）──
const { isSignIn } = storeToRefs(StoreAuth());
const storeConfig = StoreConfig();

const nextTrip = ref<UpcomingOrder | null>(null);
const nextTripLoaded = ref(false);

const _LocLabel = (loc: GooglePlace | undefined): string => {
  if (!loc) return '--';
  const raw = loc.displayName ?? loc.address ?? '--';
  return raw.split(',')[0].split('(')[0].trim();
};

const nextTripDisplay = computed(() => {
  if (!nextTrip.value) return null;
  const o = nextTrip.value;
  const dt = $dayjs(o.pickupDateTime);
  const vehicleCfg = storeConfig.GetVehicle(o.vehicleType);
  return {
    orderId: o.orderId,
    from: _LocLabel(o.pickupLocation),
    to: _LocLabel(o.dropoffLocation),
    status: o.orderStatus,
    date: dt.isValid() ? dt.format('YYYY.MM.DD') : '',
    time: dt.isValid() ? dt.format('HH:mm') : '',
    vehicle: vehicleCfg?.label.zh ?? t(`vehicle.${o.vehicleType}`, o.vehicleType),
    passengers: o.passengerCount,
  };
});

const ApiLoadNextTrip = async () => {
  if (!isSignIn.value) {
    nextTrip.value = null;
    nextTripLoaded.value = true;
    return;
  }
  try {
    const res = await $api.GetUpcomingOrder();
    if (res.status?.code !== 200) {
      console.error('[home/nextTrip] load failed:', res.status?.message?.zh_tw);
      return;
    }
    nextTrip.value = (res.data as UpcomingOrder | null) ?? null;
  } catch (err) {
    console.error('[home/nextTrip] exception:', err);
  } finally {
    nextTripLoaded.value = true;
  }
};

const ClickOpenNextTrip = () => {
  if (nextTrip.value) navigateTo(`/orders/${nextTrip.value.orderId}`);
};

// 30s polling + visibility refresh（與 admin/driver/passenger orders 一致）
let nextTripTimer: ReturnType<typeof setInterval> | null = null;
const NEXT_TRIP_POLL_MS = 30_000;
const _OnVisibilityChange = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') ApiLoadNextTrip();
};
watch(isSignIn, () => { ApiLoadNextTrip(); });

// ── Scroll reveal observer（提升至 setup 範圍，動態加入的 .reveal 也可補 observe） ──
// 修 bug：onMounted 跑 querySelectorAll('.reveal') 時 trip-card 還在 v-if="nextTripDisplay"
// 後面尚未 render，observer 沒抓到它 → 永遠維持 opacity: 0 → 「卡片可點但空白」
let revealObserver: IntersectionObserver | null = null;
const _observedReveals = typeof WeakSet !== 'undefined' ? new WeakSet<Element>() : null;
const _observeNewReveals = () => {
  if (!revealObserver || typeof document === 'undefined') return;
  document.querySelectorAll('.reveal').forEach((el) => {
    if (_observedReveals && _observedReveals.has(el)) return;
    revealObserver!.observe(el);
    _observedReveals?.add(el);
  });
};

// 任何 nextTrip 狀態變化 → DOM 更新後補 observe（新出現的 trip-card / empty-cta）
watch([nextTripLoaded, nextTripDisplay], async () => {
  await nextTick();
  _observeNewReveals();
});

// ── 生命週期 ──────────────────────────────────────────────
onMounted(() => {
  // 載入下一趟
  ApiLoadNextTrip();
  nextTripTimer = setInterval(ApiLoadNextTrip, NEXT_TRIP_POLL_MS);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', _OnVisibilityChange);

  // Scroll reveal
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add('visible');
    });
  }, { threshold: 0.1 });
  _observeNewReveals();
});

onUnmounted(() => {
  if (nextTripTimer) clearInterval(nextTripTimer);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', _OnVisibilityChange);
});
</script>

<template lang="pug">
.PageHome
  //- ── HERO ────────────────────────────────────────────────────
  section#home.PageHome__hero-section
    .PageHome__hero
      .PageHome__hero-bg
      .PageHome__hero-runway

      .PageHome__airport-badge.is-tpe TPE
      .PageHome__airport-badge.is-jfk JFK
      .PageHome__airport-badge.is-nrt NRT

      svg.PageHome__hero-plane(viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg")
        path(d="M44 8L4 22L18 26L20 44L28 32L40 36L44 8Z" fill="#1A1814" stroke="#1A1814" stroke-width="1.5" stroke-linejoin="round")

      .PageHome__hero-content
        .PageHome__hero-tag {{ $t('home.hero.tag') }}
        h1.PageHome__hero-title
          | DESTINATION
          span.PageHome__hero-title-line2 ANYWHERE
        p.PageHome__hero-subtitle {{ $t('home.hero.subtitle') }}
        .PageHome__hero-cta
          button.PageHome__cta-primary(@click="navigateTo('/booking')") {{ $t('home.hero.cta.book') }}
          button.PageHome__cta-secondary(@click="navigateTo('/fare')") {{ $t('home.hero.cta.fare') }}

  //- ── STRIPE ──────────────────────────────────────────────────
  .PageHome__stripe

  //- ── Wave 2 P4：下一趟（單張卡 / 無單 CTA）──────────────────
  section#nextTrip.PageHome__section.is-cream
    .PageHome__section-label DEPARTURE & ARRIVAL
    h2.PageHome__section-title {{ $t('home.nextTrip.title') }}
    p.PageHome__section-desc {{ nextTripDisplay ? $t('home.nextTrip.descHas') : $t('home.nextTrip.descEmpty') }}

    //- 有單：點擊跳訂單詳情頁
    .PageHome__trip-card.is-clickable.reveal(
      v-if="nextTripDisplay"
      role="button"
      tabindex="0"
      @click="ClickOpenNextTrip"
      @keydown.enter="ClickOpenNextTrip"
    )
      .PageHome__trip-header
        .PageHome__trip-route
          .PageHome__route-code {{ nextTripDisplay.from }}
          .PageHome__route-arrow
            .PageHome__route-line
            span ✈
            .PageHome__route-line
          .PageHome__route-code {{ nextTripDisplay.to }}
        span.PageHome__trip-status(:class="`is-${nextTripDisplay.status}`") {{ $t('status.' + nextTripDisplay.status) }}
      .PageHome__trip-info
        .PageHome__info-item
          .PageHome__info-label {{ $t('home.nextTrip.date') }}
          .PageHome__info-val {{ nextTripDisplay.date }}
        .PageHome__info-item
          .PageHome__info-label {{ $t('home.nextTrip.time') }}
          .PageHome__info-val {{ nextTripDisplay.time }}
        .PageHome__info-item
          .PageHome__info-label {{ $t('home.nextTrip.vehicle') }}
          .PageHome__info-val {{ nextTripDisplay.vehicle }}
        .PageHome__info-item
          .PageHome__info-label {{ $t('home.nextTrip.passengers') }}
          .PageHome__info-val {{ nextTripDisplay.passengers }}

    //- 無單：CTA 卡（已登入但無 active order；未登入也走此分支以鼓勵訂車）
    button.PageHome__next-trip-empty.reveal(
      v-else-if="nextTripLoaded"
      type="button"
      @click="navigateTo('/booking')"
    )
      span.PageHome__next-trip-empty-icon ＋
      span.PageHome__next-trip-empty-text {{ $t('home.nextTrip.emptyCta') }}

  //- ── 航班看板＝熱門路線 ──────────────────────────────────────
  PassengerHomeRouteBoard

  //- ── 服務特色 ────────────────────────────────────────────────
  PassengerHomeFeatures

  //- ── How-it-works ───────────────────────────────────────────
  PassengerHomeSteps

  //- ── 優惠專區（無生效折扣碼時自身 v-if 隱藏整區）──────────────
  PassengerHomePromo

  //- ── 服務範圍 ────────────────────────────────────────────────
  PassengerHomeCoverage

  //- ── 精選 FAQ ────────────────────────────────────────────────
  section.PageHome__section.is-cream
    .PageHome__section-label {{ $t('homeFaq.label') }}
    h2.PageHome__section-title {{ $t('homeFaq.title') }}
    p.PageHome__section-desc {{ $t('homeFaq.desc') }}
    PassengerFaqList(:item-keys="FAQ_HOME_PICKS")
    button.PageHome__faq-more(type="button" @click="navigateTo('/faq')")
      | {{ $t('homeFaq.more') }}

  //- ── 結尾雙動作 CTA ──────────────────────────────────────────
  PassengerHomeClosing

  //- ── Footer ─────────────────────────────────────────────────
  CommonFooter

</template>


<style lang="scss" scoped>
// ── 字體變數 ──────────────────────────────────────────────────────────────────
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

// ── 動畫 ──────────────────────────────────────────────────────────────────────
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes flyIn {
  from { opacity: 0; transform: translateX(40px) rotate(-10deg); }
  to   { opacity: 0.2; transform: translateX(0) rotate(0deg); }
}

@keyframes floatY {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-12px); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
}

// ── 頁面根節點 ────────────────────────────────────────────────────────────────
.PageHome {
  background: var(--da-off-white);
  color: var(--da-dark);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

// ── HERO ──────────────────────────────────────────────────────────────────────
.PageHome__hero-section {
  padding: 0;
}

.PageHome__hero {
  min-height: 100svh;
  padding-top: 56px;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding-bottom: 60px;
}

.PageHome__hero-bg {
  position: absolute;
  inset: 0;
  background: var(--da-cream);
}

.PageHome__hero-runway {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 220px;
  background: repeating-linear-gradient(
    -45deg,
    rgba(245, 200, 66, 0.12) 0px, rgba(245, 200, 66, 0.12) 20px,
    transparent 20px, transparent 40px
  );
  pointer-events: none;
}

// Airport badge watermarks
.PageHome__airport-badge {
  position: absolute;
  font-family: $font-display;
  letter-spacing: 0.06em;
  color: var(--da-dark);
  opacity: 0.06;
  pointer-events: none;
  user-select: none;

  &.is-tpe {
    font-size: 120px;
    top: 80px; right: -20px;
    animation: floatY 8s ease-in-out infinite;
  }
  &.is-jfk {
    font-size: 80px;
    top: 200px; left: -10px;
    animation: floatY 10s 2s ease-in-out infinite;
  }
  &.is-nrt {
    font-size: 60px;
    top: 320px; right: 10px;
    animation: floatY 7s 1s ease-in-out infinite;
  }
}

.PageHome__hero-plane {
  position: absolute;
  top: 120px; right: 24px;
  width: 48px;
  opacity: 0.2;
  animation: flyIn 1.2s 0.5s ease both, floatY 6s 1.7s ease-in-out infinite;
}

.PageHome__hero-content {
  position: relative;
  padding: 0 24px;
  z-index: 2;
}

.PageHome__hero-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 20px;
  padding: 6px 14px;
  border: 1.5px solid var(--da-amber);
  border-radius: 100px;
  animation: fadeUp 0.8s ease both;

  &::before {
    content: '';
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--da-amber);
    animation: pulse 2s ease infinite;
  }
}

.PageHome__hero-title {
  font-family: $font-display;
  font-size: clamp(72px, 22vw, 108px);
  line-height: 0.88;
  letter-spacing: -0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
  animation: fadeUp 0.8s 0.1s ease both;
}

.PageHome__hero-title-line2 {
  color: var(--da-amber);
  display: block;
  font-size: clamp(56px, 17vw, 82px);
  letter-spacing: 0.02em;
}

.PageHome__hero-subtitle {
  font-family: $font-body;
  font-size: 15px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.6;
  margin-bottom: 32px;
  max-width: 320px;
  animation: fadeUp 0.8s 0.2s ease both;
}

.PageHome__hero-cta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  animation: fadeUp 0.8s 0.3s ease both;
}

.PageHome__cta-primary,
.PageHome__cta-secondary {
  flex: 1;
  min-width: 140px;
  padding: 16px 24px;
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;

  &:active { transform: scale(0.97); }
}

.PageHome__cta-primary {
  background: var(--da-dark);
  color: var(--da-cream);
  border: none;
}

.PageHome__cta-secondary {
  background: transparent;
  color: var(--da-dark);
  border: 1.5px solid var(--da-dark);
}

// ── STRIPE DIVIDER ────────────────────────────────────────────────────────────
.PageHome__stripe {
  height: 12px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow) 0px, var(--da-stripe-yellow) 12px,
    var(--da-stripe-dark) 12px, var(--da-stripe-dark) 24px
  );
  opacity: 0.85;
}

// ── SECTION ───────────────────────────────────────────────────────────────────
.PageHome__section {
  padding: 72px 24px;
  scroll-margin-top: 56px;

  &.is-cream    { background: var(--da-cream); }
  &.is-off-white { background: var(--da-off-white); }
}

.PageHome__section-label {
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

.PageHome__section-title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PageHome__section-desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
}

// ── TRIP CARD ─────────────────────────────────────────────────────────────────
.PageHome__trip-card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 20px;
  padding: 20px;
  margin-bottom: 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
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

  // Wave 2 P4：可點擊整卡跳訂單詳情頁
  &.is-clickable {
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;

    &:hover {
      border-color: rgba(212, 134, 10, 0.35);
      box-shadow: 0 6px 28px rgba(0, 0, 0, 0.08);
    }
    &:active { transform: scale(0.99); }
    &:focus-visible {
      outline: 2px solid var(--da-amber);
      outline-offset: 2px;
    }
  }
}

// Wave 2 P4：無單時的 CTA 卡（樣式與 trip-card 同框，但偏 dashed 邀請感）
.PageHome__next-trip-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 28px 20px;
  border-radius: 20px;
  border: 1.5px dashed rgba(212, 134, 10, 0.45);
  background: rgba(212, 134, 10, 0.04);
  color: var(--da-amber);
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;

  &:hover {
    background: rgba(212, 134, 10, 0.1);
    border-color: rgba(212, 134, 10, 0.7);
  }
  &:active { transform: scale(0.99); }
}

.PageHome__next-trip-empty-icon {
  font-family: $font-display;
  font-size: 24px;
  line-height: 1;
}

.PageHome__next-trip-empty-text {
  letter-spacing: 0.12em;
}

.PageHome__trip-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.PageHome__trip-route {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PageHome__route-code {
  font-family: $font-display;
  font-size: 28px;
  letter-spacing: 0.04em;
  line-height: 1;
  color: var(--da-dark);
}

.PageHome__route-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  color: var(--da-amber);
  font-size: 18px;
}

.PageHome__route-line {
  width: 24px; height: 1.5px;
  background: linear-gradient(90deg, var(--da-amber), var(--da-amber-light));
}

.PageHome__trip-status {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 5px 12px;
  border-radius: 100px;

  &.is-confirmed {
    background: rgba(212, 134, 10, 0.12);
    color: var(--da-amber);
    border: 1px solid rgba(212, 134, 10, 0.25);
  }
  &.is-pending {
    background: rgba(26, 24, 20, 0.06);
    color: var(--da-dark);
    border: 1px solid rgba(26, 24, 20, 0.15);
  }
}

.PageHome__trip-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.PageHome__info-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-gray-light);
  margin-bottom: 3px;
}

.PageHome__info-val {
  font-size: 14px;
  font-weight: 500;
  color: var(--da-dark);
  font-family: $font-body;
}

// ── FAQ MORE ──────────────────────────────────────────────────────────────────
.PageHome__faq-more {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  background: transparent;
  color: var(--da-dark);
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1.5px solid var(--da-dark);
  border-radius: 12px;
  cursor: pointer;

  &:active { transform: scale(0.98); }
}

// ── SCROLL REVEAL ─────────────────────────────────────────────────────────────
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease, transform 0.6s ease;

  &.visible {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
