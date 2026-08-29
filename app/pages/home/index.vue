<script setup lang="ts">
import type { AnnouncementListItem } from '@/protocol/fetch-api/api/announcement';
import type { FlightInfo } from '@@/api/flight.get';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

// ── 口袋航廈 第四版（2026-08-29）─────────────────────────────────────────────
//
// 改的是**版面**，不是色票 —— 上一輪換完色票之後版面沒動，這一版把它補上。
//
// 拿掉：佔滿第一屏的品牌大字、hero 三顆 CTA、頁尾三段行銷（Features / Promo / book CTA）。
//   行銷內容歸未登入的 `/`（marketing layout 本來就有 hero / coverage / features / CTA），
//   登入後的人不需要被推銷 —— 提案總則 04。
//
// 換成（一進來就看得到東西，提案總則 02）：
//   1. 「下一趟」主卡 —— 全頁唯一的縞黑面，帶倒數 / 航班即時狀態 / 一鍵撥打；
//      沒有行程時同一個位置換成訂車三格（接機 / 送機 / 包車）
//   2. 桃機今日出境人流迷你圖 —— 司機端與 admin 早就有這份資料，乘客更需要它決定幾點出門
//   3. 快速操作四格
//   4. 最新公告
//
// 每一塊的資料都對得到站上已經在跑的端點，沒有需要新後端的東西：
//   /nuxt-api/orders/upcoming · /api/flight · /api/airport/flow ·
//   /nuxt-api/orders · /nuxt-api/announcements

const { t } = useI18n();
const { isSignIn, lineProfile } = storeToRefs(StoreAuth());
const storeConfig = StoreConfig();

// ── 下一趟 ────────────────────────────────────────────────────────────────────
const nextTrip = ref<UpcomingOrder | null>(null);
const nextTripLoaded = ref(false);

const _LocLabel = (loc: GooglePlace | undefined | null): string => {
  if (!loc) return '--';
  const raw = loc.displayName ?? loc.address ?? '--';
  return raw.split(',')[0].split('(')[0].trim();
};

const nextTripDisplay = computed(() => {
  // 防呆：res.data 曾出現「非 null 但缺 orderId 的空殼」，那會讓 dayjs(undefined) 回到當下
  // 時間、渲染出一張假行程卡。缺 orderId 一律視為無單。
  if (!nextTrip.value?.orderId) return null;
  const o = nextTrip.value;
  const dt = $dayjs(o.pickupDateTime);
  const vehicleCfg = storeConfig.GetVehicle(o.vehicleType);

  const driverVehicleLabel = (() => {
    if (!o.driver) return '';
    const m = o.driver.vehicleModel?.trim();
    if (m) return m;
    const raw = o.driver.vehicleType?.trim();
    if (!raw) return '';
    return storeConfig.GetVehicle(raw)?.label.zh ?? raw;
  })();

  return {
    orderId: o.orderId,
    orderType: o.orderType,
    pickup: _LocLabel(o.pickupLocation),
    dropoff: _LocLabel(o.dropoffLocation),
    status: o.orderStatus,
    iso: o.pickupDateTime,
    valid: dt.isValid(),
    monthDay: dt.isValid() ? dt.format('MM / DD') : '',
    time: dt.isValid() ? dt.format('HH:mm') : '',
    vehicle: vehicleCfg?.label.zh ?? t(`vehicle.${o.vehicleType}`, o.vehicleType),
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

/** 倒數：>= 1 天顯示天數，< 1 天顯示小時，< 1 小時顯示「即將出發」 */
const countdown = computed(() => {
  const d = nextTripDisplay.value;
  if (!d?.valid) return '';
  const diffMin = $dayjs(d.iso).diff($dayjs(), 'minute');
  if (diffMin <= 0) return t('home.pocket.next.countdownNow');
  if (diffMin < 60) return t('home.pocket.next.countdownSoon');
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return t('home.pocket.next.countdownHours', { n: hours });
  return t('home.pocket.next.countdownDays', { n: Math.floor(hours / 24) });
});

const ApiLoadNextTrip = async () => {
  if (!isSignIn.value) {
    nextTrip.value = null;
    nextTripLoaded.value = true;
    return;
  }
  try {
    const res = await $api.GetUpcomingOrder();
    if (res.status?.code !== $enum.apiStatus.success) {
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

// ── 航班即時狀態（訂單詳情早就在用同一支端點）────────────────────────────────
const flight = ref<FlightInfo | null>(null);

const ApiLoadFlight = async () => {
  const d = nextTripDisplay.value;
  flight.value = null;
  if (!d?.flightNumber || !d.valid) return;
  // direction 依 orderType 推，與 BookingStepType 同一條規則
  const direction = d.orderType === 'airport-dropoff' ? 'departure' : 'arrival';
  const date = $dayjs(d.iso).format('YYYY-MM-DD');
  const flightNo = d.flightNumber.replace(/\s+/g, '').toUpperCase();
  try {
    const res = await $fetch<{ data: FlightInfo | null; status: { code: number } }>(
      `/api/flight?flightNo=${flightNo}&direction=${direction}&date=${date}`,
    );
    if (res?.status?.code === $enum.apiStatus.success) flight.value = res.data ?? null;
  } catch {
    // 航班查不到不是錯誤（可能還沒排班 / 供應商沒有這班），主卡照樣要出得來
  }
};

const flightLine = computed(() => {
  const f = flight.value;
  const d = nextTripDisplay.value;
  if (!d?.flightNumber) return null;
  if (!f) return { no: d.flightNumber, place: '', status: '', statusKey: 'unknown', eta: '' };
  const isArrival = f.direction === 'arrival';
  const place = isArrival ? f.origin?.cityName : f.destination?.cityName;
  const et = $dayjs(f.estimatedTime);
  return {
    no: f.flightNo || d.flightNumber,
    place: place ?? '',
    status: t(`booking.type.flightStatus.${f.status}`, t('booking.type.flightStatus.unknown')),
    statusKey: f.status,
    eta: et.isValid()
      ? t(isArrival ? 'home.pocket.next.etaArrive' : 'home.pocket.next.etaDepart', { time: et.format('HH:mm') })
      : '',
  };
});

/** 主卡右下角的機場代碼浮水印 —— 裝飾同時是資訊（顯示這趟的實際機場） */
const airportCode = computed(() => {
  const f = flight.value;
  if (!f) return 'TPE';
  return (f.direction === 'arrival' ? f.origin?.iataCode : f.destination?.iataCode) || 'TPE';
});

const ClickOpenNextTrip = () => {
  if (nextTrip.value) navigateTo(`/orders/${nextTrip.value.orderId}`);
};
const ClickCallDriver = (e: Event) => {
  e.stopPropagation();
  const phone = nextTripDisplay.value?.driver?.phone;
  if (phone) window.location.href = `tel:${phone}`;
};

// ── 沒有行程時的訂車三格 ──────────────────────────────────────────────────────
const GO_TYPES = [
  { id: 'airport-pickup', icon: 'mdi:airplane-landing' },
  { id: 'airport-dropoff', icon: 'mdi:airplane-takeoff' },
  { id: 'charter', icon: 'mdi:car-clock' },
] as const;
const ClickGo = (type: string) => navigateTo(`/booking?type=${type}`);

// ── 桃機今日出境人流 ──────────────────────────────────────────────────────────
const crowdHours = ref<Array<{ hour: number; forecastCount: number }>>([]);
const crowdPeakHour = ref<number | null>(null);

const crowdBars = computed(() => {
  const hours = crowdHours.value;
  if (!hours.length) return [];
  const max = Math.max(...hours.map((h) => h.forecastCount), 1);
  // 只畫 05:00–23:00 —— 凌晨那幾根永遠是 0，畫出來只是把有意義的區間壓扁
  return hours
    .filter((h) => h.hour >= 5 && h.hour <= 23)
    .map((h) => ({
      hour: h.hour,
      pct: Math.round((h.forecastCount / max) * 100),
      isPeak: h.hour === crowdPeakHour.value,
    }));
});

const crowdPeakLabel = computed(() =>
  crowdPeakHour.value === null
    ? ''
    : t('home.pocket.crowd.peak', { hour: String(crowdPeakHour.value).padStart(2, '0') }),
);

const ApiLoadCrowd = async () => {
  try {
    const res = await $api.GetAirportForecast();
    if (res.status?.code !== $enum.apiStatus.success || !res.data) return;
    crowdHours.value = res.data.hours ?? [];
    crowdPeakHour.value = res.data.peakHour ?? null;
  } catch {
    // 人流是輔助資訊，拿不到就整塊不顯示
  }
};

// ── 快速操作 + 最新公告 ───────────────────────────────────────────────────────
const activeOrderCount = ref(0);
const newsItems = ref<AnnouncementListItem[]>([]);
const DONE_ORDER_STATUS = new Set(['completed', 'cancelled']);

const QUICK_TILES = [
  { id: 'orders', path: '/orders', icon: 'mdi:file-document-outline', labelKey: 'home.pocket.quick.orders' },
  { id: 'estimate', path: '/fare', icon: 'mdi:calculator-variant-outline', labelKey: 'home.pocket.quick.estimate' },
  { id: 'referral', path: '/referral/share', icon: 'mdi:gift-outline', labelKey: 'home.pocket.quick.referral' },
  { id: 'faq', path: '/faq', icon: 'mdi:lifebuoy', labelKey: 'home.pocket.quick.support' },
] as const;

const ApiLoadQuickInfo = async () => {
  if (!isSignIn.value) {
    activeOrderCount.value = 0;
    newsItems.value = [];
    return;
  }
  try {
    const res = await $api.GetOrderList({});
    if (res.status?.code === $enum.apiStatus.success && Array.isArray(res.data)) {
      activeOrderCount.value = res.data.filter((o) => !DONE_ORDER_STATUS.has(o.orderStatus)).length;
    }
  } catch (err) {
    console.error('[home/quick] 訂單數載入失敗:', err);
  }
  try {
    const res = await $api.GetAnnouncements({ limit: 3 });
    if (res.status?.code === $enum.apiStatus.success) newsItems.value = res.data?.items ?? [];
  } catch (err) {
    console.error('[home/news] 公告載入失敗:', err);
  }
};

const unreadNewsCount = computed(() => newsItems.value.filter((n) => !n.isRead).length);
const ClickOpenNews = (id: string) => navigateTo(`/notifications/${id}`);

// ── 問候語 ────────────────────────────────────────────────────────────────────
const greeting = computed(() => {
  const h = $dayjs().hour();
  const key = h < 11 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const name = lineProfile.value?.displayName ?? '';
  return name
    ? t(`home.pocket.greeting.${key}Named`, { name })
    : t(`home.pocket.greeting.${key}`);
});

// ── 生命週期 ──────────────────────────────────────────────────────────────────
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 30_000;
const _OnVisibility = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') ApiLoadNextTrip();
};

watch(isSignIn, () => { ApiLoadNextTrip(); ApiLoadQuickInfo(); });
watch(() => nextTripDisplay.value?.flightNumber, () => { ApiLoadFlight(); });

onMounted(() => {
  ApiLoadNextTrip();
  ApiLoadQuickInfo();
  ApiLoadCrowd();
  pollTimer = setInterval(ApiLoadNextTrip, POLL_MS);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', _OnVisibility);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', _OnVisibility);
});
</script>

<template lang="pug">
.PageHome
  p.PageHome__greeting {{ greeting }}

  //- ── 1. 下一趟（有單）────────────────────────────────────────────────
  article.PageHome__next(
    v-if="nextTripDisplay"
    data-surface="dark"
    role="button"
    tabindex="0"
    @click="ClickOpenNextTrip"
    @keydown.enter="ClickOpenNextTrip"
  )
    .PageHome__next-runway
    span.PageHome__next-code {{ airportCode }}

    .PageHome__next-head
      span.PageHome__next-kicker {{ airportCode }} · next trip
      span.PageHome__next-countdown.u-data(v-if="countdown") {{ countdown }}

    .PageHome__next-when
      span.PageHome__next-date.u-data {{ nextTripDisplay.monthDay }}
      span.PageHome__next-time.u-data {{ nextTripDisplay.time }}

    p.PageHome__next-route
      | {{ nextTripDisplay.pickup }}
      span.PageHome__next-arrow →
      | {{ nextTripDisplay.dropoff }}

    //- 航班即時狀態（訂單詳情同一支端點；查不到只顯示航班號）
    .PageHome__next-flight(v-if="flightLine")
      span.PageHome__next-flight-no.u-data {{ flightLine.no }}
      span.PageHome__next-flight-place(v-if="flightLine.place") {{ flightLine.place }}
      span.PageHome__next-flight-status(
        v-if="flightLine.status"
        :class="`is-${flightLine.statusKey}`"
      ) {{ flightLine.status }}
      span.PageHome__next-flight-eta.u-data(v-if="flightLine.eta") {{ flightLine.eta }}

    //- 司機（已敲定才有）
    .PageHome__next-driver(v-if="nextTripDisplay.driver")
      span.PageHome__next-driver-name {{ nextTripDisplay.driver.displayName }}
      span.PageHome__next-driver-plate.u-data {{ nextTripDisplay.driver.plateNumber }}
      button.PageHome__next-call(
        v-if="nextTripDisplay.driver.phone"
        type="button"
        @click="ClickCallDriver"
      )
        NuxtIcon.PageHome__next-call-icon(name="mdi:phone")
        | {{ $t('home.pocket.next.call') }}

  //- ── 1'. 沒有行程 → 同一個位置換成訂車三格 ─────────────────────────
  section.PageHome__go(v-else-if="nextTripLoaded")
    p.PageHome__kicker {{ $t('home.pocket.go.kicker') }}
    h2.PageHome__go-title {{ $t('home.pocket.go.title') }}
    .PageHome__go-grid
      button.PageHome__go-tile(
        v-for="g in GO_TYPES"
        :key="g.id"
        type="button"
        @click="ClickGo(g.id)"
      )
        NuxtIcon.PageHome__go-icon(:name="g.icon")
        span.PageHome__go-label {{ $t(`orderType.${g.id}`) }}

  //- ── 2. 桃機今日出境人流 ────────────────────────────────────────────
  section.PageHome__crowd(v-if="crowdBars.length")
    .PageHome__crowd-head
      p.PageHome__kicker {{ $t('home.pocket.crowd.kicker') }}
      span.PageHome__crowd-peak.u-data(v-if="crowdPeakLabel") {{ crowdPeakLabel }}
    h2.PageHome__crowd-title {{ $t('home.pocket.crowd.title') }}
    .PageHome__crowd-chart
      span.PageHome__crowd-bar(
        v-for="b in crowdBars"
        :key="b.hour"
        :class="{ 'is-peak': b.isPeak }"
        :style="{ height: `${Math.max(b.pct, 4)}%` }"
      )
    .PageHome__crowd-axis
      span.u-data 05
      span.u-data 12
      span.u-data 18
      span.u-data 23

  //- ── 3. 快速操作 ────────────────────────────────────────────────────
  section.PageHome__quick
    p.PageHome__kicker {{ $t('home.pocket.quick.kicker') }}
    .PageHome__quick-grid
      button.PageHome__quick-tile(
        v-for="q in QUICK_TILES"
        :key="q.id"
        type="button"
        @click="navigateTo(q.path)"
      )
        NuxtIcon.PageHome__quick-icon(:name="q.icon")
        span.PageHome__quick-label {{ $t(q.labelKey) }}
        span.PageHome__quick-badge.u-data(
          v-if="q.id === 'orders' && activeOrderCount > 0"
        ) {{ activeOrderCount }}

  //- ── 4. 最新公告 ────────────────────────────────────────────────────
  section.PageHome__news(v-if="newsItems.length")
    .PageHome__news-head
      p.PageHome__kicker {{ $t('home.pocket.news.kicker') }}
      span.PageHome__news-unread.u-data(v-if="unreadNewsCount > 0") {{ unreadNewsCount }}
    h2.PageHome__news-title {{ $t('home.news.title') }}
    ul.PageHome__news-list
      li.PageHome__news-item(v-for="n in newsItems" :key="n.id")
        button.PageHome__news-row(type="button" @click="ClickOpenNews(n.id)")
          span.PageHome__news-dot(v-if="!n.isRead")
          span.PageHome__news-name {{ n.title }}
          span.PageHome__news-date.u-data {{ $dayjs(n.publishedAt).format('MM/DD') }}
    button.PageHome__news-more(type="button" @click="navigateTo('/notifications')")
      | {{ $t('home.news.more') }}
</template>

<style lang="scss" scoped>
/* 提案總則 02：卡片，不是「大標題 + 一段段區塊」。
   所以這頁沒有襯線巨標題，也沒有滿版分段底色 —— 一進來就是東西。 */
.PageHome {
  max-width: var(--shell);
  margin-inline: auto;
  padding-block: 72px 32px;
  padding-inline: max(16px, calc((100% - var(--shell)) / 2));
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.PageHome__greeting {
  font-family: var(--ff-display);
  font-size: var(--fs-h3);
  color: var(--ink);
  margin: 0;
}

/* 裝飾語彙 C：kicker + 前導短橫（站上既有的區塊標題語法） */
.PageHome__kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--accent-text);
  margin: 0;
}

.PageHome__kicker::before {
  content: '';
  width: 14px;
  height: 1px;
  background: var(--accent);
}

/* ── 下一趟主卡：全頁唯一的縞黑面 ───────────────────────────────── */
.PageHome__next {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-lg);
  background: var(--surface-deep);
  color: var(--surface-raised);
  padding: 20px;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform var(--dur-fast) var(--ease-out);
}

.PageHome__next:active { transform: scale(0.995); }

/* 裝飾語彙 D：底部一層 13% 亮銅斜紋，讓縞黑面在骨白裡有重量而不是一個黑方塊 */
.PageHome__next-runway {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 64px;
  opacity: 0.13;
  background: repeating-linear-gradient(
    -45deg,
    transparent 0 12px,
    var(--da-amber-light) 12px 24px
  );
  pointer-events: none;
}

/* 裝飾語彙 B：機場代碼浮水印 —— 顯示這趟的實際機場，裝飾同時是資訊 */
.PageHome__next-code {
  position: absolute;
  right: 12px;
  bottom: -14px;
  font-family: var(--ff-display);
  font-size: var(--fs-hero);
  line-height: var(--lh-flat);
  color: var(--surface-a06);
  pointer-events: none;
  user-select: none;
}

.PageHome__next-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.PageHome__next-kicker {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--accent-lit);
}

.PageHome__next-countdown {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--surface-a72);
  padding: 3px 10px;
  border: 1px solid var(--surface-a20);
  border-radius: var(--r-pill);
}

.PageHome__next-when {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-top: 14px;
}

.PageHome__next-date {
  font-size: var(--fs-h2);
  font-weight: 300;
  letter-spacing: var(--ls-snug);
  color: var(--surface-a72);
}

.PageHome__next-time {
  font-size: var(--fs-display);
  font-weight: 300;
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-tight);
}

.PageHome__next-route {
  position: relative;
  margin: 10px 0 0;
  font-size: var(--fs-body);
  color: var(--surface-a88);
}

.PageHome__next-arrow {
  color: var(--accent-lit);
  margin-inline: 8px;
}

.PageHome__next-flight {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--surface-a12);
  font-size: var(--fs-body-sm);
  color: var(--surface-a72);
}

.PageHome__next-flight-no {
  font-weight: 700;
  color: var(--surface-raised);
}

/* 語意四色只用在狀態（提案裝飾語彙 E）—— 這裡的顏色是判讀依據，不是配色 */
.PageHome__next-flight-status {
  padding: 2px 8px;
  border-radius: var(--r-pill);
  font-weight: 600;
}

.PageHome__next-flight-status.is-scheduled,
.PageHome__next-flight-status.is-landed {
  background: var(--good-a15);
  color: var(--good-lit);
}

.PageHome__next-flight-status.is-active {
  background: var(--note-a15);
  color: var(--note-lit);
}

.PageHome__next-flight-status.is-delayed {
  background: var(--wait-a15);
  color: var(--wait-lit);
}

.PageHome__next-flight-status.is-cancelled {
  background: var(--stop-a15);
  color: var(--stop-lit);
}

.PageHome__next-driver {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--surface-a12);
  font-size: var(--fs-body-sm);
}

.PageHome__next-driver-name {
  font-family: var(--ff-display);
  font-size: var(--fs-body-lg);
}

.PageHome__next-driver-plate {
  color: var(--surface-a72);
}

/* 提案總則 03：主要動作在拇指構得到的地方 —— 主卡上的撥打貼右側 */
.PageHome__next-call {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--tap);
  padding: 0 16px;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--surface-raised);
  color: var(--ink);
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  font-weight: 600;
  cursor: pointer;
}

.PageHome__next-call-icon { font-size: var(--fs-body); }

/* ── 沒有行程：訂車三格 ─────────────────────────────────────────── */
.PageHome__go {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: 20px;
}

.PageHome__go-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  margin: 6px 0 16px;
  color: var(--ink);
}

.PageHome__go-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.PageHome__go-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: 88px;
  justify-content: center;
  padding: 12px 6px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--surface-ground);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out);
}

.PageHome__go-tile:hover { border-color: var(--accent-a40); }

.PageHome__go-icon {
  font-size: var(--fs-h2);
  color: var(--accent);
}

.PageHome__go-label {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--ink);
}

/* ── 桃機人流迷你圖 ─────────────────────────────────────────────── */
.PageHome__crowd {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: 18px 20px 14px;
}

.PageHome__crowd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.PageHome__crowd-peak {
  font-size: var(--fs-label);
  font-weight: 600;
  color: var(--wait);
  background: var(--wait-a08);
  border-radius: var(--r-pill);
  padding: 3px 10px;
}

.PageHome__crowd-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h4);
  margin: 6px 0 14px;
  color: var(--ink);
}

.PageHome__crowd-chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 56px;
}

.PageHome__crowd-bar {
  flex: 1;
  background: var(--accent-a30);
}

.PageHome__crowd-bar.is-peak { background: var(--wait); }

.PageHome__crowd-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: var(--fs-label);
  color: var(--ink-mute);
}

/* ── 快速操作 ───────────────────────────────────────────────────── */
.PageHome__quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 12px;
}

.PageHome__quick-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 82px;
  padding: 12px 4px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--surface-raised);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out);
}

.PageHome__quick-tile:hover { border-color: var(--accent-a40); }

.PageHome__quick-icon {
  font-size: var(--fs-h3);
  color: var(--accent);
}

.PageHome__quick-label {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--ink-soft);
}

.PageHome__quick-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--r-pill);
  background: var(--accent);
  color: var(--surface-raised);
  font-size: var(--fs-label);
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

/* ── 最新公告 ───────────────────────────────────────────────────── */
.PageHome__news-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.PageHome__news-unread {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--r-pill);
  /* 與清單裡的未讀點同一個語彙（古銅＝「這裡有東西」），不用 stop ——
     語意四色只標狀態，「還沒看」不是錯誤。 */
  background: var(--accent-a12);
  color: var(--accent-text);
  font-size: var(--fs-label);
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}

.PageHome__news-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h4);
  margin: 6px 0 10px;
  color: var(--ink);
}

.PageHome__news-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.PageHome__news-item + .PageHome__news-item {
  border-top: 1px solid var(--hairline);
}

.PageHome__news-row {
  width: 100%;
  min-height: var(--tap);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

/* 未讀：左側一顆古銅點（提案第四張畫面） */
.PageHome__news-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-pill);
  background: var(--accent);
}

.PageHome__news-name {
  flex: 1;
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 日期靠右等高等寬，一眼掃時間 */
.PageHome__news-date {
  flex: none;
  font-size: var(--fs-label);
  color: var(--ink-mute);
}

.PageHome__news-more {
  width: 100%;
  min-height: var(--tap);
  margin-top: 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  background: none;
  color: var(--ink-soft);
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  cursor: pointer;
}

.PageHome__news-more:hover { border-color: var(--accent-a40); }

/* ── 桌機：同樣的內容，多欄並排（提案「另一半」）───────────────── */
@media (min-width: 901px) {
  .PageHome {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: start;
    gap: var(--space-md);
    padding-block: 96px 56px;
  }

  .PageHome__greeting,
  .PageHome__next,
  .PageHome__go {
    grid-column: 1 / -1;
  }

  .PageHome__next-when { margin-top: 18px; }
}
</style>
