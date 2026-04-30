<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

// ── 統計告示牌 ────────────────────────────────────────
interface StatItem {
  id: string
  num: string
  label: string
  sub: string
}

const stats = computed<StatItem[]>(() => [
  { id: 'ontime',   num: '98%',     label: t('home.stats.ontime'),   sub: 'ON-TIME'  },
  { id: 'journeys', num: '42,000+', label: t('home.stats.journeys'), sub: 'JOURNEYS' },
  { id: 'rating',   num: '4.9★',   label: t('home.stats.rating'),   sub: 'RATING'   },
  { id: 'service',  num: '24/7',    label: t('home.stats.service'),  sub: 'SERVICE'  },
]);

// 初始值：與目標等長的空白，讓每個 SplitFlapChar 都有 prop 變化觸發動畫
const displayNums = reactive<Record<string, string>>({
  ontime:   '   ',
  journeys: '       ',
  rating:   '    ',
  service:  '   ',
});

const statsBarRef = ref<HTMLElement | null>(null);
let statsTriggered = false;

// ── 近期行程（Firestore 真實資料）──────────────────────────────
const { user } = StoreAuth();

const VEHICLE_LABEL: Record<string, string> = {
  sedan: '房車', suv: 'SUV', van: '廂型', premium: '商務',
};

const upcomingTrips = ref<{
  from: string; to: string; status: string;
  date: string; time: string; vehicle: string;
  timeLabelKey: string; infoLabelKey: string; passengerCount: string;
}[]>([]);

const ApiLoadUpcomingTrips = async () => {
  if (!user.value?.uid) return;
  const res = await $api.GetOrderList({ userId: user.value.uid });
  const now = Date.now();
  const upcoming = (res.data ?? [])
    .filter((o) => {
      const isPending = ['pending', 'confirmed'].includes(o.orderStatus);
      const isFuture = new Date(o.pickupDateTime).getTime() > now;
      return isPending && isFuture;
    })
    .slice(0, 3)
    .map((o) => ({
      from: o.pickupLocation?.displayName?.split('(')?.[0]?.trim() ?? o.pickupLocation?.address?.slice(0, 6) ?? '--',
      to:   o.dropoffLocation?.displayName?.split('(')?.[0]?.trim() ?? o.dropoffLocation?.address?.slice(0, 6) ?? '--',
      status: o.orderStatus,
      date: $dayjs(o.pickupDateTime).format('YYYY.MM.DD'),
      time: $dayjs(o.pickupDateTime).format('HH:mm'),
      vehicle: VEHICLE_LABEL[o.vehicleType] ?? o.vehicleType,
      timeLabelKey: 'home.upcoming.pickupTime',
      infoLabelKey: 'home.upcoming.passengers',
      passengerCount: String(o.passengerCount ?? 1),
    }));
  upcomingTrips.value = upcoming;
};

// ── 生命週期 ──────────────────────────────────────────────
onMounted(() => {
  // 載入近期行程
  ApiLoadUpcomingTrips();

  // Scroll reveal
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add('visible');
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

  // Stats flip board
  const flipObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && !statsTriggered) {
        statsTriggered = true;
        stats.value.forEach((item, idx) => {
          setTimeout(() => { displayNums[item.id] = item.num; }, idx * 350);
        });
      }
    });
  }, { threshold: 0.4 });

  if (statsBarRef.value) flipObserver.observe(statsBarRef.value);
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

  //- ── STATS FLIP BOARD ────────────────────────────────────────
  .PageHome__stats(ref="statsBarRef")
    .PageHome__stats-grid
      .PageHome__stats-item(v-for="item in stats" :key="item.id")
        SplitFlapBoard(:value="displayNums[item.id]" :char-delay="55" :cycles="8")
        .PageHome__stats-label
          span {{ item.label }}
          span.PageHome__stats-sub {{ item.sub }}

  //- ── STRIPE ──────────────────────────────────────────────────
  .PageHome__stripe

  //- ── UPCOMING TRIPS ──────────────────────────────────────────
  section#upcoming.PageHome__section.is-cream
    .PageHome__section-label DEPARTURE & ARRIVAL
    h2.PageHome__section-title {{ $t('home.upcoming.title') }}
    p.PageHome__section-desc {{ $t('home.upcoming.desc') }}

    .PageHome__trip-card.reveal(
      v-for="(trip, idx) in upcomingTrips"
      :key="idx"
      :style="{ animationDelay: `${idx * 0.12}s` }"
    )
      .PageHome__trip-header
        .PageHome__trip-route
          .PageHome__route-code {{ trip.from }}
          .PageHome__route-arrow
            .PageHome__route-line
            span ✈
            .PageHome__route-line
          .PageHome__route-code {{ trip.to }}
        span.PageHome__trip-status(:class="`is-${trip.status}`") {{ $t('status.' + trip.status) }}
      .PageHome__trip-info
        .PageHome__info-item
          .PageHome__info-label {{ $t('home.upcoming.date') }}
          .PageHome__info-val {{ trip.date }}
        .PageHome__info-item
          .PageHome__info-label {{ $t(trip.timeLabelKey) }}
          .PageHome__info-val {{ trip.time }}
        .PageHome__info-item
          .PageHome__info-label {{ $t('home.upcoming.vehicle') }}
          .PageHome__info-val {{ trip.vehicle }}
        .PageHome__info-item
          .PageHome__info-label {{ $t(trip.infoLabelKey) }}
          .PageHome__info-val {{ trip.passengerCount }}

  //- ── STRIPE ──────────────────────────────────────────────────
  .PageHome__stripe

  //- ── QUICK BOOK CTA ──────────────────────────────────────────
  section#book.PageHome__section.is-off-white
    .PageHome__section-label BOOK YOUR JOURNEY
    h2.PageHome__section-title {{ $t('home.book.title') }}
    p.PageHome__section-desc {{ $t('home.book.desc') }}
    button.PageHome__book-cta-btn.reveal(@click="navigateTo('/booking')")
      svg(width="20" height="20" viewBox="0 0 24 24" fill="none")
        path(d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round")
      | {{ $t('home.book.btn') }}

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

// ── STATS FLIP BOARD ──────────────────────────────────────────────────────────
.PageHome__stats {
  background: var(--da-dark);
  padding: 32px 20px;
}

.PageHome__stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
}

.PageHome__stats-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.PageHome__stats-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;

  span {
    font-family: $font-condensed;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.3;
    text-align: center;
  }
}

.PageHome__stats-sub {
  color: rgba(255, 255, 255, 0.25) !important;
  font-size: 10px !important;
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

// ── BOOK CTA ──────────────────────────────────────────────────────────────────
.PageHome__book-cta-btn {
  width: 100%;
  padding: 18px;
  background: var(--da-dark);
  color: var(--da-cream);
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.12em;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;

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
