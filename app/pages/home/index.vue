<script setup lang="ts">
import type { AnnouncementListItem } from '@/protocol/fetch-api/api/announcement';

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
  // 防呆：即使 res.data 回到非 null 但缺 orderId 的空殼物件（FilterRes 已修，這層為 belt-and-suspenders），
  // 也視為無單，避免 dayjs(undefined) 回到「當下時間」造成假行程卡。
  if (!nextTrip.value || !nextTrip.value.orderId) return null;
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
// ── 快速操作 + 最新公告（2026-08-28）─────────────────────
// 介面方向提案的登入後首頁是「下一趟 → 快速操作 → 最新公告」——
// 狀態卡之後接的是功能，不是行銷。原本 hero 之後直接接三段行銷文案，
// 等於對已經買單的人繼續推銷。行銷區塊改排在功能之後。
const activeOrderCount = ref(0);
const newsItems = ref<AnnouncementListItem[]>([]);

/** 非進行中的訂單狀態（其餘一律算進行中） */
const DONE_ORDER_STATUS = new Set(['completed', 'cancelled']);

const ApiLoadQuickInfo = async () => {
  if (!isSignIn.value) {
    activeOrderCount.value = 0;
    newsItems.value = [];
    return;
  }
  try {
    const res = await $api.GetOrderList({});
    if (res.status?.code === 200 && Array.isArray(res.data)) {
      activeOrderCount.value = res.data.filter((o) => !DONE_ORDER_STATUS.has(o.orderStatus)).length;
    }
  } catch (err) {
    console.error('[home/quick] 訂單數載入失敗:', err);
  }
  try {
    const res = await $api.GetAnnouncements({ limit: 2 });
    if (res.status?.code === 200) newsItems.value = res.data?.items ?? [];
  } catch (err) {
    console.error('[home/news] 公告載入失敗:', err);
  }
};

const ClickOpenNews = (id: string) => navigateTo(`/notifications/${id}`);

let nextTripTimer: ReturnType<typeof setInterval> | null = null;
const NEXT_TRIP_POLL_MS = 30_000;
const _OnVisibilityChange = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') ApiLoadNextTrip();
};
watch(isSignIn, () => { ApiLoadNextTrip(); ApiLoadQuickInfo(); });

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
  ApiLoadQuickInfo();
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
        path(d="M44 8L4 22L18 26L20 44L28 32L40 36L44 8Z" fill="var(--ink)" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round")

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

    //- 無單：明確空狀態卡 + CTA
    .PageHome__next-trip-empty.reveal(v-else-if="nextTripLoaded")
      .PageHome__next-trip-empty-icon
        NuxtIcon(name="mdi:calendar-blank-outline")
      .PageHome__next-trip-empty-title {{ $t('home.nextTrip.emptyTitle') }}
      .PageHome__next-trip-empty-sub {{ $t('home.nextTrip.emptySub') }}
      button.PageHome__next-trip-empty-cta(type="button" @click="navigateTo('/booking')")
        span ＋
        span {{ $t('home.nextTrip.emptyCta') }}

  //- ── 2. 快速操作（狀態卡之後接功能，不接行銷）──────────
  section.PageHome__section.is-cream
    .PageHome__section-label QUICK ACTIONS
    h2.PageHome__section-title {{ $t('home.quick.title') }}
    .PageHome__quick.reveal
      button.PageHome__quick-row(type="button" @click="navigateTo('/booking')")
        .PageHome__quick-text
          .PageHome__quick-name {{ $t('home.quick.book') }}
          .PageHome__quick-desc {{ $t('home.quick.bookDesc') }}
        span.PageHome__quick-arrow →
      button.PageHome__quick-row(type="button" @click="navigateTo('/orders')")
        .PageHome__quick-text
          .PageHome__quick-name {{ $t('home.quick.orders') }}
          .PageHome__quick-desc {{ activeOrderCount > 0 ? $t('home.quick.ordersActive', { count: activeOrderCount }) : $t('home.quick.ordersEmpty') }}
        span.PageHome__quick-count(v-if="activeOrderCount > 0") {{ activeOrderCount }}
        span.PageHome__quick-arrow(v-else) →

  //- ── 3. 最新公告（無公告自動隱藏）──────────────────────
  section.PageHome__section.is-off-white(v-if="newsItems.length")
    .PageHome__section-label ANNOUNCEMENTS
    h2.PageHome__section-title {{ $t('home.news.title') }}
    .PageHome__news.reveal
      button.PageHome__news-row(
        v-for="n in newsItems"
        :key="n.id"
        type="button"
        @click="ClickOpenNews(n.id)"
      )
        span.PageHome__news-badge(v-if="!n.isRead") {{ $t('home.news.badgeNew') }}
        span.PageHome__news-title {{ n.title }}
        span.PageHome__news-arrow →
      button.PageHome__news-more(type="button" @click="navigateTo('/notifications')")
        | {{ $t('home.news.more') }}

  //- ── 4. 安心接送的理由（合併 Steps + LINE Only 提示）───────
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
    color-mix(in srgb, var(--da-stripe-yellow) 12%, transparent) 0px,
    color-mix(in srgb, var(--da-stripe-yellow) 12%, transparent) 20px,
    transparent 20px, transparent 40px
  );
  pointer-events: none;
}

// Airport badge watermarks — 9 個錯位浮動
.PageHome__airport-badge {
  position: absolute;
  font-family: var(--ff-display);
  letter-spacing: var(--ls-label);
  color: var(--da-dark);
  opacity: 0.06;
  pointer-events: none;
  user-select: none;

  &.is-tpe {
    font-size: var(--fs-mega);
    top: 60px; right: -20px;
    animation: floatY 8s ease-in-out infinite;
  }
  &.is-jfk {
    font-size: var(--fs-hero);
    top: 200px; left: -10px;
    animation: floatY 10s 2s ease-in-out infinite;
  }
  &.is-nrt {
    font-size: var(--fs-hero);
    top: 320px; right: 16px;
    animation: floatY 7s 1s ease-in-out infinite;
  }
  &.is-hnd {
    font-size: var(--fs-hero);
    top: 420px; left: 20px;
    animation: floatY 9s 0.5s ease-in-out infinite;
  }
  &.is-icn {
    font-size: var(--fs-hero);
    top: 520px; right: 40px;
    animation: floatY 11s 1.5s ease-in-out infinite;
  }
  &.is-lax {
    font-size: var(--fs-mega);
    top: 140px; left: 38%;
    opacity: 0.045;
    animation: floatY 13s 0.8s ease-in-out infinite;
  }
  &.is-hkg {
    font-size: var(--fs-display);
    top: 600px; left: -8px;
    animation: floatY 6s 2.4s ease-in-out infinite;
  }
  &.is-sin {
    font-size: var(--fs-hero);
    top: 680px; right: 24px;
    animation: floatY 12s 1.2s ease-in-out infinite;
  }
  &.is-sfo {
    font-size: var(--fs-hero);
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 20px;
  padding: 6px 14px;
  border: 1.5px solid var(--da-amber);
  border-radius: var(--r-pill);
  animation: fadeUp 0.8s ease both;

  &::before {
    content: '';
    width: 6px; height: 6px;
    border-radius: var(--r-round);
    background: var(--da-amber);
    animation: pulse 2s ease infinite;
  }
}

.PageHome__hero-title {
  font-family: var(--ff-display);
  font-size: clamp(72px, 22vw, 108px);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-tight);
  color: var(--da-dark);
  margin-bottom: 8px;
  animation: fadeUp 0.8s 0.1s ease both;
}

.PageHome__hero-title-line2 {
  color: var(--da-amber);
  display: block;
  font-size: clamp(56px, 17vw, 82px);
  letter-spacing: var(--ls-snug);
}

.PageHome__hero-subtitle {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
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
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: all var(--dur-base) var(--ease-out);
  text-align: center;

  &:active { transform: scale(0.97); }
}

.PageHome__cta-primary {
  flex-basis: 100%;
  background: var(--da-dark);
  color: var(--da-cream);
  border: none;
  padding: 16px 24px;
  font-size: var(--fs-body);
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
  padding-block: var(--space-section);
  padding-inline: max(var(--gutter), calc((100% - var(--shell)) / 2));
  scroll-margin-top: 56px;

  &.is-cream    { background: var(--da-cream); }
  &.is-off-white { background: var(--da-off-white); }
}

.PageHome__section-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
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
  font-family: var(--ff-display);
  font-size: clamp(36px, 10vw, 48px);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-snug);
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PageHome__section-desc {
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
  margin-bottom: 28px;
  max-width: 320px;
  font-family: var(--ff-ui);
}

// ── TRIP CARD（手機優先重排）─────────────────────────────────────────────────
.PageHome__trip-card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-xl);
  padding: 20px;
  box-shadow: var(--shadow-soft);
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
    border-radius: var(--r-xl) 0 0 var(--r-xl);
  }

  &.is-clickable {
    cursor: pointer;
    transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);

    &:hover {
      border-color: var(--accent-a30);
      box-shadow: var(--shadow-pop);
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
  border-bottom: 1px dashed var(--ink-a12);
}

.PageHome__trip-datetime-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.PageHome__trip-date {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-snug);
  line-height: var(--lh-flat);
  color: var(--da-dark);
}

.PageHome__trip-weekday {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageHome__trip-time {
  font-family: var(--ff-data);
  font-size: var(--fs-h1);
  letter-spacing: var(--ls-snug);
  line-height: var(--lh-flat);
  color: var(--da-amber);
  font-variant-numeric: tabular-nums;
}

.PageHome__trip-status {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  padding: 5px 10px;
  border-radius: var(--r-pill);
  margin-left: auto;
  white-space: nowrap;

  &.is-pending {
    background: var(--ink-a06);
    color: var(--da-dark);
    border: 1px solid var(--ink-a12);
  }
  &.is-confirmed,
  &.is-en_route,
  &.is-arrived_pickup,
  &.is-in_transit {
    background: var(--accent-a12);
    color: var(--da-amber);
    border: 1px solid var(--accent-a20);
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
    background: repeating-linear-gradient(to bottom, var(--accent-a50) 0 3px, transparent 3px 7px);
  }
}

.PageHome__trip-route-dot {
  width: 14px;
  height: 14px;
  border-radius: var(--r-round);
  margin-top: 4px;
  flex-shrink: 0;
  position: relative;
  z-index: 1;

  &.is-pickup {
    background: var(--da-amber);
    box-shadow: 0 0 0 3px var(--accent-a12);
  }
  &.is-stop {
    background: var(--da-cream);
    border: 2px solid var(--da-amber);
  }
  &.is-dropoff {
    background: var(--da-dark);
    box-shadow: 0 0 0 3px var(--ink-a12);
  }
}

.PageHome__trip-route-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--da-gray-light);
  margin-bottom: 2px;
}

.PageHome__trip-route-val {
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--da-dark);
  font-family: var(--ff-ui);
  line-height: var(--lh-normal);
  word-break: break-word;
}

// 區塊 3：航班
.PageHome__trip-flight {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--accent-a06);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-md);
}

.PageHome__trip-flight-icon {
  font-size: var(--fs-body);
  color: var(--da-amber);
}

.PageHome__trip-flight-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--da-amber);
}

.PageHome__trip-flight-val {
  font-family: var(--ff-data);
  font-size: var(--fs-body-lg);
  letter-spacing: var(--ls-label);
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

// 區塊 4：司機資料
.PageHome__trip-driver {
  padding-top: 14px;
  border-top: 1px dashed var(--ink-a12);
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--line-green);
  background: color-mix(in srgb, var(--line-green) 12%, transparent);
  padding: 3px 8px;
  border-radius: var(--r-pill);
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageHome__trip-driver-val {
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--da-dark);
  font-family: var(--ff-ui);
  word-break: break-word;

  // 車型放大、加粗 — 與車牌一致辨識度
  &.is-vehicle {
    font-size: var(--fs-body-lg);
    font-weight: 700;
    letter-spacing: var(--ls-snug);
  }
}

/* ── 快速操作 ────────────────────────────────────────────────
   刻意做成「列」而不是「卡片格」：格子是行銷語彙（每格等重、都在爭取注意），
   列是功能語彙（由上而下讀完就走）。列高吃 --tap，觸控目標不打折。 */
.PageHome__quick {
  display: grid;
  gap: var(--space-2xs);
}

.PageHome__quick-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  min-height: var(--tap);
  padding: var(--space-sm) var(--space-md);
  background: var(--da-off-white);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}

.PageHome__quick-row:hover {
  background: var(--surface-a96);
  border-color: var(--ink-a20);
}

.PageHome__quick-text {
  flex: 1;
  min-width: 0;
}

.PageHome__quick-name {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--da-dark);
}

.PageHome__quick-desc {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  font-weight: 300;
  color: var(--da-gray);
  margin-top: 2px;
}

/* 進行中筆數：唯一需要被一眼看到的數字，用襯線放大而不是加底色 */
.PageHome__quick-count {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  color: var(--da-amber);
  line-height: var(--lh-flat);
}

.PageHome__quick-arrow {
  font-size: var(--fs-body-lg);
  color: var(--da-gray-light);
}

/* ── 最新公告 ────────────────────────────────────────────── */
.PageHome__news {
  display: grid;
  gap: var(--space-2xs);
}

.PageHome__news-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  width: 100%;
  min-height: var(--tap);
  padding: var(--space-sm) var(--space-md);
  background: var(--da-cream);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}

.PageHome__news-row:hover {
  background: var(--surface-a96);
}

/* 未讀標記：用語意狀態色的 note（提示），不是自挑的紅 */
.PageHome__news-badge {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--note-a08);
  color: var(--note);
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 500;
  letter-spacing: var(--ls-label);
}

.PageHome__news-title {
  flex: 1;
  min-width: 0;
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-dark);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.PageHome__news-arrow {
  flex: none;
  font-size: var(--fs-body);
  color: var(--da-gray-light);
}

.PageHome__news-more {
  justify-self: start;
  margin-top: var(--space-2xs);
  padding: var(--space-2xs) 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--ink-a20);
  color: var(--da-gray);
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  cursor: pointer;
}

.PageHome__news-more:hover {
  color: var(--da-dark);
  border-bottom-color: var(--da-dark);
}

.PageHome__trip-driver-plate {
  /* 提案規則四：車牌用襯線排，與訂單編號的等寬感形成對比 */
  font-family: var(--ff-display);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-wide);
  color: var(--da-dark);
  background: var(--da-cream);
  padding: 6px 14px;
  border-radius: var(--r-sm);
  border: 2px solid var(--da-dark);
  justify-self: start;
  font-variant-numeric: tabular-nums;
}

.PageHome__trip-driver-phone {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  background: var(--da-amber);
  color: var(--da-cream);
  padding: 3px 8px;
  border-radius: var(--r-pill);
}

// 無單：明確空狀態卡
.PageHome__next-trip-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 36px 24px 32px;
  border-radius: var(--r-xl);
  border: 1.5px dashed var(--ink-a20);
  background: var(--ink-a06);
  text-align: center;
}

.PageHome__next-trip-empty-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-round);
  background: var(--accent-a12);
  color: var(--da-amber);
  font-size: var(--fs-h1);
  margin-bottom: 4px;
}

.PageHome__next-trip-empty-title {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-lg);
  font-weight: 700;
  color: var(--da-dark);
  letter-spacing: var(--ls-snug);
}

.PageHome__next-trip-empty-sub {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
  max-width: 280px;
  margin-bottom: 8px;
}

.PageHome__next-trip-empty-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--da-dark);
  color: var(--da-cream);
  border: none;
  border-radius: var(--r-pill);
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover { opacity: 0.92; }
  &:active { transform: scale(0.97); }

  span:first-child {
    font-family: var(--ff-display);
    font-size: var(--fs-body-lg);
    line-height: var(--lh-flat);
  }
}

// ── 預約您的行程 CTA section ──────────────────────────────────────────────────
.PageHome__book-section {
  padding-block: var(--space-section);
  padding-inline: max(var(--gutter), calc((100% - var(--shell)) / 2));
  background: var(--da-cream);
}

.PageHome__book-card {
  background: linear-gradient(135deg, var(--da-dark), var(--surface-deep-3));
  color: var(--da-cream);
  border-radius: var(--r-xl);
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
    border-radius: var(--r-round);
    background: radial-gradient(circle, color-mix(in srgb, var(--da-stripe-yellow) 25%, transparent), transparent 70%);
    pointer-events: none;
  }
}

.PageHome__book-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
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
  font-family: var(--ff-display);
  font-size: clamp(36px, 11vw, 52px);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-snug);
  color: var(--da-cream);
  margin-bottom: 12px;
}

.PageHome__book-desc {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 300;
  color: color-mix(in srgb, var(--surface-raised) 70%, transparent);
  line-height: var(--lh-relaxed);
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
  border-radius: var(--r-pill);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);

  &:hover { opacity: 0.92; }
  &:active { transform: scale(0.97); }
}

.PageHome__book-btn-arrow {
  font-size: var(--fs-h4);
  font-family: var(--ff-display);
}

// ── SCROLL REVEAL ─────────────────────────────────────────────────────────────
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity var(--dur-slower) var(--ease-out), transform var(--dur-slower) var(--ease-out);

  &.visible {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
