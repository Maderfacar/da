<script setup lang="ts">
// PassengerHomeRouteBoard — 首頁航班看板（熱門路線）
// 深色看板，每列一條熱門路線；翻牌呈現路線代碼；整列可點跳 /fare。
import { calculateFare } from '~shared/pricing';

const storeConfig = StoreConfig();

const standardVehicle = computed(() => storeConfig.EnabledVehicles[0]);

interface BoardRow {
  id: string;
  fromCode: string;
  toCode: string;
  fromKey: string;
  toKey: string;
  flightNo: string;
  fare: number;
}

const rows = computed<BoardRow[]>(() => {
  const v = standardVehicle.value;
  return POPULAR_ROUTES.map((r) => ({
    id: r.id,
    fromCode: r.fromCode,
    toCode: r.toCode,
    fromKey: r.fromKey,
    toKey: r.toKey,
    flightNo: r.flightNo,
    fare: v ? calculateFare(v, r.km, []) : 0,
  }));
});

// 翻牌觸發：進入視窗時把每列代碼從空白翻到目標值
const boardRef = ref<HTMLElement | null>(null);
const displayCodes = reactive<Record<string, { from: string; to: string }>>({});
let boardTriggered = false;
let obs: IntersectionObserver | null = null;
const staggerTimers: ReturnType<typeof setTimeout>[] = [];

POPULAR_ROUTES.forEach((r) => {
  displayCodes[r.id] = { from: ' '.repeat(r.fromCode.length), to: ' '.repeat(r.toCode.length) };
});

const ClickRow = () => navigateTo('/fare');

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !boardRef.value) return;
  obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && !boardTriggered) {
        boardTriggered = true;
        POPULAR_ROUTES.forEach((r, idx) => {
          staggerTimers.push(setTimeout(() => {
            displayCodes[r.id] = { from: r.fromCode, to: r.toCode };
          }, idx * 180));
        });
      }
    });
  }, { threshold: 0.25 });
  obs.observe(boardRef.value);
});

onUnmounted(() => {
  obs?.disconnect();
  obs = null;
  staggerTimers.forEach(clearTimeout);
});
</script>

<template lang="pug">
section.PassengerHomeRouteBoard(ref="boardRef")
  .PassengerHomeRouteBoard__head
    .PassengerHomeRouteBoard__label {{ $t('routeBoard.label') }}
    h2.PassengerHomeRouteBoard__title {{ $t('routeBoard.title') }}
    p.PassengerHomeRouteBoard__desc {{ $t('routeBoard.desc') }}

  .PassengerHomeRouteBoard__board
    .PassengerHomeRouteBoard__col-head
      span.PassengerHomeRouteBoard__col-flight {{ $t('routeBoard.flightCol') }}
      span.PassengerHomeRouteBoard__col-route {{ $t('routeBoard.routeCol') }}
      span.PassengerHomeRouteBoard__col-fare {{ $t('routeBoard.fareCol') }}

    button.PassengerHomeRouteBoard__row(
      v-for="row in rows"
      :key="row.id"
      type="button"
      @click="ClickRow"
    )
      span.PassengerHomeRouteBoard__flight {{ row.flightNo }}
      span.PassengerHomeRouteBoard__route
        SplitFlapBoard(:value="displayCodes[row.id].from" :char-delay="50" :cycles="6")
        span.PassengerHomeRouteBoard__route-arrow ✈
        SplitFlapBoard(:value="displayCodes[row.id].to" :char-delay="50" :cycles="6")
      span.PassengerHomeRouteBoard__fare
        span.PassengerHomeRouteBoard__fare-val {{ storeConfig.isLoaded ? `NT$${row.fare.toLocaleString()}` : '—' }}
        span.PassengerHomeRouteBoard__status {{ $t('routeBoard.statusOnTime') }}
</template>

<style lang="scss" scoped>
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

.PassengerHomeRouteBoard {
  background: var(--da-dark);
  padding: 56px 20px;
}

.PassengerHomeRouteBoard__head {
  margin-bottom: 24px;
}

.PassengerHomeRouteBoard__label {
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

.PassengerHomeRouteBoard__title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  color: var(--da-cream);
}

.PassengerHomeRouteBoard__desc {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: rgba(250, 248, 244, 0.55);
  margin-top: 8px;
  line-height: 1.7;
}

.PassengerHomeRouteBoard__board {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  overflow: hidden;
}

.PassengerHomeRouteBoard__col-head {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.PassengerHomeRouteBoard__col-flight {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.PassengerHomeRouteBoard__col-route {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.PassengerHomeRouteBoard__col-fare {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  text-align: right;
}

.PassengerHomeRouteBoard__row {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition: background 0.15s;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: rgba(212, 134, 10, 0.08);
  }

  &:active {
    background: rgba(212, 134, 10, 0.14);
  }
}

.PassengerHomeRouteBoard__flight {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--da-amber-light);
}

.PassengerHomeRouteBoard__route {
  display: flex;
  align-items: center;
  gap: 8px;
}

.PassengerHomeRouteBoard__route-arrow {
  color: var(--da-amber);
  font-size: 13px;
}

.PassengerHomeRouteBoard__fare {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.PassengerHomeRouteBoard__fare-val {
  font-family: $font-display;
  font-size: 22px;
  color: var(--da-cream);
  letter-spacing: 0.02em;
}

.PassengerHomeRouteBoard__status {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--da-amber);
}
</style>
