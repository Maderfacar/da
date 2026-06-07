<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

// ── Home redesign 2026-05-27 ──────────────────────────────
// 重排首頁：Hero → 安心接送的理由(合併 Steps+LINE) → 即將到來行程 → 預約您的行程 CTA → 現正優惠
// 移除：RouteBoard / Coverage / FAQ / Closing（component 檔保留以利未來重用）

const { isSignIn } = storeToRefs(StoreAuth());
const storeConfig = StoreConfig();

const nextTrip = ref<UpcomingOrder | null>(null);
const nextTripLoaded = ref(false);

const _LocLabel = (loc: GooglePlace | undefined | null): string => {
  if (!loc) return '--';
  const raw = loc.displayName ?? loc.address ?? '--';
  return raw.split(',')[0].split('(')[0].trim();
};

const nextTripDisplay = computed(() => {
  if (!nextTrip.value) return null;
  const o = nextTrip.value;
  const dt = $dayjs(o.pickupDateTime);
  const vehicleCfg = storeConfig.GetVehicle(o.vehicleType);
  const stopovers = Array.isArray(o.stopovers) ? o.stopovers.filter(Boolean) : [];

  // 司機車型顯示：vehicleModel（自由文字）> 訂單 vehicleType label > driver.vehicleType label
  const driverVehicleLabel = (() => {
    if (!o.driver) return '';
    const m = o.driver.vehicleModel?.trim();
    if (m) return m;
    const t2 = o.driver.vehicleType?.trim();
    if (!t2) return '';
    const cfg = storeConfig.GetVehicle(t2);
    return cfg?.label.zh ?? t2;
  })();

  return {
    orderId: o.orderId,
    pickup: _LocLabel(o.pickupLocation),
    stopovers: stopovers.map((s) => _LocLabel(s)).filter((s) => s !== '--'),
    dropoff: _LocLabel(o.dropoffLocation),
    status: o.orderStatus,
    date: dt.isValid() ? dt.format('YYYY.MM.DD') : '',
    time: dt.isValid() ? dt.format('HH:mm') : '',
    weekday: dt.isValid() ? dt.format('dd') : '',
    vehicle: vehicleCfg?.label.zh ?? t(`vehicle.${o.vehicleType}`, o.vehicleType),
    passengers: o.passengerCount,
    flightNumber: o.flightNumber ?? '',
    driver: o.driver
      ? {
          displayName: o.driver.displayName,
          phone: o.driver.phone,
          plateNumber: o.driver.plateNumber,
          vehicleLabel: driverVehicleLabel,
        }
      : null,
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

// 30s polling + visibility refresh
let nextTripTimer: ReturnType<typeof setInterval> | null = null;
const NEXT_TRIP_POLL_MS = 30_000;
const _OnVisibilityChange = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') ApiLoadNextTrip();
};
watch(isSignIn, () => { ApiLoadNextTrip(); });

// Scroll reveal observer
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

watch([nextTripLoaded, nextTripDisplay], async () => {
  await nextTick();
  _observeNewReveals();
});

onMounted(() => {
  ApiLoadNextTrip();
  nextTripTimer = setInterval(ApiLoadNextTrip, NEXT_TRIP_POLL_MS);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', _OnVisibilityChange);

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

      //- 浮動機場碼水印（9 個錯位散佈）
      .PageHome__airport-badge.is-tpe TPE
      .PageHome__airport-badge.is-jfk JFK
      .PageHome__airport-badge.is-nrt NRT
      .PageHome__airport-badge.is-hnd HND
      .PageHome__airport-badge.is-icn ICN
      .PageHome__airport-badge.is-lax LAX
      .PageHome__airport-badge.is-hkg HKG
      .PageHome__airport-badge.is-sin SIN
      .PageHome__airport-badge.is-sfo SFO

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

  //- ── 1. 即將到來行程（Hero 下第一順位）──────────────────
  section#nextTrip.PageHome__section.is-off-white
    .PageHome__section-label DEPARTURE & ARRIVAL
    h2.PageHome__section-title {{ $t('home.nextTrip.title') }}
    p.PageHome__section-desc {{ nextTripDisplay ? $t('home.nextTrip.descHas') : $t('home.nextTrip.descEmpty') }}

    //- 有單：完整資訊 + 點擊跳訂單詳情頁
    .PageHome__trip-card.is-clickable.reveal(
      v-if="nextTripDisplay"
      role="button"
      tabindex="0"
      @click="ClickOpenNextTrip"
      @keydown.enter="ClickOpenNextTrip"
    )
      //- 區塊 1：日期時間（置頂）
      .PageHome__trip-datetime
        .PageHome__trip-datetime-left
          .PageHome__trip-date {{ nextTripDisplay.date }}
          .PageHome__trip-weekday(v-if="nextTripDisplay.weekday") {{ nextTripDisplay.weekday }}
        .PageHome__trip-time {{ nextTripDisplay.time }}
        span.PageHome__trip-status(:class="`is-${nextTripDisplay.status}`") {{ $t('status.' + nextTripDisplay.status) }}

      //- 區塊 2：路線（上車 → 中途 → 下車）
      .PageHome__trip-route
        .PageHome__trip-route-row
          span.PageHome__trip-route-dot.is-pickup
          .PageHome__trip-route-text
            .PageHome__trip-route-label {{ $t('home.nextTrip.pickup') }}
            .PageHome__trip-route-val {{ nextTripDisplay.pickup }}
        .PageHome__trip-route-row(v-for="(s, i) in nextTripDisplay.stopovers" :key="i")
          span.PageHome__trip-route-dot.is-stop
          .PageHome__trip-route-text
            .PageHome__trip-route-label {{ $t('home.nextTrip.stopover') }}{{ nextTripDisplay.stopovers.length > 1 ? ` ${i + 1}` : '' }}
            .PageHome__trip-route-val {{ s }}
        .PageHome__trip-route-row
          span.PageHome__trip-route-dot.is-dropoff
          .PageHome__trip-route-text
            .PageHome__trip-route-label {{ $t('home.nextTrip.dropoff') }}
            .PageHome__trip-route-val {{ nextTripDisplay.dropoff }}

      //- 區塊 3：航班（接送機才有）
      .PageHome__trip-flight(v-if="nextTripDisplay.flightNumber")
        span.PageHome__trip-flight-icon ✈
        span.PageHome__trip-flight-label {{ $t('home.nextTrip.flightNumber') }}
        span.PageHome__trip-flight-val {{ nextTripDisplay.flightNumber }}

      //- 區塊 4：司機資料（confirmed 後才出現）
      .PageHome__trip-driver(v-if="nextTripDisplay.driver")
        .PageHome__trip-driver-head
          span.PageHome__trip-driver-badge {{ $t('home.nextTrip.driverSection') }}
        .PageHome__trip-driver-rows
          .PageHome__trip-driver-row
            span.PageHome__trip-driver-key {{ $t('home.nextTrip.driverName') }}
            span.PageHome__trip-driver-val {{ nextTripDisplay.driver.displayName || '—' }}
          .PageHome__trip-driver-row(v-if="nextTripDisplay.driver.phone")
            span.PageHome__trip-driver-key {{ $t('home.nextTrip.driverPhone') }}
            a.PageHome__trip-driver-phone(
              :href="`tel:${nextTripDisplay.driver.phone}`"
              @click.stop
            ) {{ nextTripDisplay.driver.phone }}
              span.PageHome__trip-driver-call ☎ {{ $t('home.nextTrip.callDriver') }}
          .PageHome__trip-driver-row(v-if="nextTripDisplay.driver.vehicleLabel")
            span.PageHome__trip-driver-key {{ $t('home.nextTrip.vehicle') }}
            span.PageHome__trip-driver-val.is-vehicle {{ nextTripDisplay.driver.vehicleLabel }}
          .PageHome__trip-driver-row(v-if="nextTripDisplay.driver.plateNumber")
            span.PageHome__trip-driver-key {{ $t('home.nextTrip.plateNumber') }}
            span.PageHome__trip-driver-plate {{ nextTripDisplay.driver.plateNumber }}

    //- 無單：CTA 卡
    button.PageHome__next-trip-empty.reveal(
      v-else-if="nextTripLoaded"
      type="button"
      @click="navigateTo('/booking')"
    )
      span.PageHome__next-trip-empty-icon ＋
      span.PageHome__next-trip-empty-text {{ $t('home.nextTrip.emptyCta') }}

  //- ── 2. 安心接送的理由（合併 Steps + LINE Only 提示）───────
  PassengerHomeFeatures

  //- ── 3. 預約您的行程 CTA ────────────────────────────────
  section.PageHome__book-section
    .PageHome__book-card.reveal
      .PageHome__book-label BOOK YOUR TRIP
      h2.PageHome__book-title {{ $t('home.book.title') }}
      p.PageHome__book-desc {{ $t('home.book.desc') }}
      button.PageHome__book-btn(@click="navigateTo('/booking')")
        | {{ $t('home.book.btn') }}
        span.PageHome__book-btn-arrow →

  //- ── 4. 現正優惠（無折扣碼自動隱藏）───────────────────
  PassengerHomePromo
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

// Airport badge watermarks — 9 個錯位浮動
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
    top: 60px; right: -20px;
    animation: floatY 8s ease-in-out infinite;
  }
  &.is-jfk {
    font-size: 80px;
    top: 200px; left: -10px;
    animation: floatY 10s 2s ease-in-out infinite;
  }
  &.is-nrt {
    font-size: 60px;
    top: 320px; right: 16px;
    animation: floatY 7s 1s ease-in-out infinite;
  }
  &.is-hnd {
    font-size: 72px;
    top: 420px; left: 20px;
    animation: floatY 9s 0.5s ease-in-out infinite;
  }
  &.is-icn {
    font-size: 56px;
    top: 520px; right: 40px;
    animation: floatY 11s 1.5s ease-in-out infinite;
  }
  &.is-lax {
    font-size: 90px;
    top: 140px; left: 38%;
    opacity: 0.045;
    animation: floatY 13s 0.8s ease-in-out infinite;
  }
  &.is-hkg {
    font-size: 50px;
    top: 600px; left: -8px;
    animation: floatY 6s 2.4s ease-in-out infinite;
  }
  &.is-sin {
    font-size: 64px;
    top: 680px; right: 24px;
    animation: floatY 12s 1.2s ease-in-out infinite;
  }
  &.is-sfo {
    font-size: 56px;
    top: 760px; left: 36%;
    animation: floatY 8s 3.2s ease-in-out infinite;
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
  gap: 10px;
  flex-wrap: wrap;
  animation: fadeUp 0.8s 0.3s ease both;
}

.PageHome__cta-primary,
.PageHome__cta-secondary {
  flex: 1 1 calc(50% - 5px);
  min-width: 130px;
  padding: 14px 16px;
  font-family: $font-condensed;
  font-size: 14px;
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
  flex-basis: 100%;
  background: var(--da-dark);
  color: var(--da-cream);
  border: none;
  padding: 16px 24px;
  font-size: 15px;
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
  padding: 64px 24px;
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
  font-size: clamp(36px, 10vw, 48px);
  line-height: 0.95;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PageHome__section-desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 28px;
  max-width: 320px;
  font-family: $font-body;
}

// ── TRIP CARD（手機優先重排）─────────────────────────────────────────────────
.PageHome__trip-card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 20px;
  padding: 20px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 20px;

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px; height: 100%;
    background: var(--da-amber);
    border-radius: 20px 0 0 20px;
  }

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

// 區塊 1：日期時間
.PageHome__trip-datetime {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px dashed rgba(26, 24, 20, 0.1);
}

.PageHome__trip-datetime-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.PageHome__trip-date {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--da-dark);
}

.PageHome__trip-weekday {
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageHome__trip-time {
  font-family: $font-display;
  font-size: 30px;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--da-amber);
  font-variant-numeric: tabular-nums;
}

.PageHome__trip-status {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 5px 10px;
  border-radius: 100px;
  margin-left: auto;
  white-space: nowrap;

  &.is-pending {
    background: rgba(26, 24, 20, 0.06);
    color: var(--da-dark);
    border: 1px solid rgba(26, 24, 20, 0.15);
  }
  &.is-confirmed,
  &.is-en_route,
  &.is-arrived_pickup,
  &.is-in_transit {
    background: rgba(212, 134, 10, 0.12);
    color: var(--da-amber);
    border: 1px solid rgba(212, 134, 10, 0.25);
  }
}

// 區塊 2：路線
.PageHome__trip-route {
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
}

.PageHome__trip-route-row {
  display: grid;
  grid-template-columns: 14px 1fr;
  gap: 12px;
  align-items: flex-start;
  position: relative;

  // 用 ::after 連虛線（最後一行不畫）
  &:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 18px;
    bottom: -14px;
    width: 2px;
    background: repeating-linear-gradient(to bottom, rgba(212, 134, 10, 0.5) 0 3px, transparent 3px 7px);
  }
}

.PageHome__trip-route-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
  position: relative;
  z-index: 1;

  &.is-pickup {
    background: var(--da-amber);
    box-shadow: 0 0 0 3px rgba(212, 134, 10, 0.15);
  }
  &.is-stop {
    background: var(--da-cream);
    border: 2px solid var(--da-amber);
  }
  &.is-dropoff {
    background: var(--da-dark);
    box-shadow: 0 0 0 3px rgba(26, 24, 20, 0.1);
  }
}

.PageHome__trip-route-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-gray-light);
  margin-bottom: 2px;
}

.PageHome__trip-route-val {
  font-size: 15px;
  font-weight: 500;
  color: var(--da-dark);
  font-family: $font-body;
  line-height: 1.4;
  word-break: break-word;
}

// 區塊 3：航班
.PageHome__trip-flight {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(212, 134, 10, 0.08);
  border: 1px solid rgba(212, 134, 10, 0.2);
  border-radius: 10px;
}

.PageHome__trip-flight-icon {
  font-size: 14px;
  color: var(--da-amber);
}

.PageHome__trip-flight-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--da-amber);
}

.PageHome__trip-flight-val {
  font-family: $font-display;
  font-size: 16px;
  letter-spacing: 0.05em;
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

// 區塊 4：司機資料
.PageHome__trip-driver {
  padding-top: 14px;
  border-top: 1px dashed rgba(26, 24, 20, 0.12);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageHome__trip-driver-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.PageHome__trip-driver-badge {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #06c755;
  background: rgba(6, 199, 85, 0.12);
  padding: 3px 8px;
  border-radius: 100px;
}

.PageHome__trip-driver-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageHome__trip-driver-row {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 12px;
  align-items: center;
}

.PageHome__trip-driver-key {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageHome__trip-driver-val {
  font-size: 14px;
  font-weight: 500;
  color: var(--da-dark);
  font-family: $font-body;
  word-break: break-word;

  // 車型放大、加粗 — 與車牌一致辨識度
  &.is-vehicle {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
}

.PageHome__trip-driver-plate {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.08em;
  color: var(--da-dark);
  background: var(--da-cream);
  padding: 6px 14px;
  border-radius: 8px;
  border: 2px solid var(--da-dark);
  justify-self: start;
  font-variant-numeric: tabular-nums;
}

.PageHome__trip-driver-phone {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: $font-body;
  font-size: 15px;
  font-weight: 600;
  color: var(--da-amber);
  text-decoration: none;
  font-variant-numeric: tabular-nums;

  &:hover { text-decoration: underline; }
}

.PageHome__trip-driver-call {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: var(--da-amber);
  color: var(--da-cream);
  padding: 3px 8px;
  border-radius: 100px;
}

// 無單 CTA
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

// ── 預約您的行程 CTA section ──────────────────────────────────────────────────
.PageHome__book-section {
  padding: 64px 24px;
  background: var(--da-cream);
}

.PageHome__book-card {
  background: linear-gradient(135deg, var(--da-dark), #2a2520);
  color: var(--da-cream);
  border-radius: 24px;
  padding: 32px 24px;
  text-align: left;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: -40px;
    right: -40px;
    width: 160px;
    height: 160px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(245, 200, 66, 0.25), transparent 70%);
    pointer-events: none;
  }
}

.PageHome__book-label {
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

.PageHome__book-title {
  font-family: $font-display;
  font-size: clamp(36px, 11vw, 52px);
  line-height: 0.95;
  letter-spacing: 0.01em;
  color: var(--da-cream);
  margin-bottom: 12px;
}

.PageHome__book-desc {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: rgba(248, 244, 235, 0.7);
  line-height: 1.7;
  margin-bottom: 24px;
  max-width: 320px;
}

.PageHome__book-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  background: var(--da-amber);
  color: var(--da-dark);
  border: none;
  border-radius: 100px;
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.15s, opacity 0.15s;

  &:hover { opacity: 0.92; }
  &:active { transform: scale(0.97); }
}

.PageHome__book-btn-arrow {
  font-size: 18px;
  font-family: $font-display;
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
