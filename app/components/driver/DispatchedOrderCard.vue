<script setup lang="ts">
import type { DriverDispatchedOrderItem } from '@/protocol/fetch-api/api/driver';
import { useCountdown } from '@/composables/app/use-countdown';

interface Props {
  order: DriverDispatchedOrderItem;
  /** 是否顯示「撤回喊單」按鈕（mine tab）；available tab 預設 false */
  showWithdraw?: boolean;
  /** 撤回 / 開啟動作 disable */
  busy?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  showWithdraw: false,
  busy: false,
});

const emit = defineEmits<{
  (e: 'open' | 'withdraw', orderId: string): void;
}>();

const ORDER_TYPE_LABEL: Record<string, string> = {
  'airport-pickup':  '接機',
  'airport-dropoff': '送機',
  'charter':         '包車',
  'transfer':        '接送',
};

const orderShort = computed(() => props.order.orderId.slice(0, 8).toUpperCase());

// 介面方向提案（第四畫面規則二）：派單等級用古銅描邊章，最高級古銅、其餘素色。
// 值域見 shared/types/dispatch-visibility.ts —— '2' 只有高級司機看得到，'0' 全體可見。
const DISPATCH_LEVEL_LABEL: Record<string, string> = {
  '2': '高級專屬',
  '1': '標準開放',
  '0': '全體開放',
};
const levelLabel = computed(() => DISPATCH_LEVEL_LABEL[props.order.dispatchCurrentLevel] ?? '');
const isTopLevel = computed(() => props.order.dispatchCurrentLevel === '2');

const pickupAddr = computed(() => props.order.pickupLocation.displayName || props.order.pickupLocation.address);
const dropoffAddr = computed(() => props.order.dropoffLocation.displayName || props.order.dropoffLocation.address);

const preferenceChips = computed(() =>
  (props.order.preferences?.tagSnapshot ?? []).map((t) => t.name.zh_tw),
);

// Wave 2B+2C：倒數至下一次自動降級（currentLevel='0' 或缺 nextDowngradeAt 不顯）
const nextDowngradeIso = computed<string | null>(() => props.order.dispatchNextDowngradeAt ?? null);
const countdown = useCountdown(nextDowngradeIso);
const showCountdown = computed(() => !!props.order.dispatchNextDowngradeAt);
const isUrgent = computed(
  () => countdown.remainingSeconds.value !== null && countdown.remainingSeconds.value <= 60,
);

const ClickOpen = () => {
  if (props.busy) return;
  emit('open', props.order.orderId);
};

const ClickWithdraw = (e: Event) => {
  e.stopPropagation();
  if (props.busy) return;
  emit('withdraw', props.order.orderId);
};
</script>

<template lang="pug">
.DriverDispatchedOrderCard(@click="ClickOpen" :class="{ 'is-bid': order.myBidStatus === 'bid', 'is-withdrawn': order.myBidStatus === 'withdrawn' }")
  .DriverDispatchedOrderCard__head
    .DriverDispatchedOrderCard__type-badge {{ ORDER_TYPE_LABEL[order.orderType] ?? order.orderType }}
    .DriverDispatchedOrderCard__level(v-if="levelLabel" :class="{ 'is-top': isTopLevel }") {{ levelLabel }}
    .DriverDispatchedOrderCard__id \#{{ orderShort }}
    .DriverDispatchedOrderCard__bid-tag(v-if="order.myBidStatus === 'bid'") 已喊單
    .DriverDispatchedOrderCard__bid-tag.is-withdraw(v-else-if="order.myBidStatus === 'withdrawn'") 已撤回

  .DriverDispatchedOrderCard__time
    span.DriverDispatchedOrderCard__time-label 用車時間
    span.DriverDispatchedOrderCard__time-val {{ $dayjs(order.pickupDateTime).format('MM/DD HH:mm') }}

  .DriverDispatchedOrderCard__route
    .DriverDispatchedOrderCard__route-point.is-pickup
      .DriverDispatchedOrderCard__route-dot
      span {{ pickupAddr }}
    .DriverDispatchedOrderCard__route-line
    .DriverDispatchedOrderCard__route-point.is-dropoff
      .DriverDispatchedOrderCard__route-dot
      span {{ dropoffAddr }}

  .DriverDispatchedOrderCard__chips(v-if="preferenceChips.length")
    span.DriverDispatchedOrderCard__chip(v-for="(c, i) in preferenceChips" :key="i") {{ c }}

  //- Wave 2B+2C：等級倒數（next downgrade 剩餘時間；0 → 「即將降級」等下次 GET 觸發 lazy）
  .DriverDispatchedOrderCard__countdown(
    v-if="showCountdown"
    :class="{ 'is-urgent': isUrgent, 'is-expired': countdown.isExpired.value }"
  )
    template(v-if="countdown.isExpired.value")
      | ⏱ {{ $t('driver.dispatch.aboutToDowngrade') }}
    template(v-else)
      | ⏱ {{ $t('driver.dispatch.countdownLabel', { time: countdown.text.value }) }}

  //- 提案規則一：金額是卡片上最大的字，改用襯線排
  .DriverDispatchedOrderCard__fare
    span.DriverDispatchedOrderCard__fare-cur NT$
    span.DriverDispatchedOrderCard__fare-val {{ order.estimatedFare.toLocaleString() }}

  .DriverDispatchedOrderCard__foot
    .DriverDispatchedOrderCard__meta
      //- Booking v2 批次 2：child=0 退回「N 人」，否則拆「大人 X / 兒童 Y」
      span(v-if="(order.childCount ?? 0) > 0") 👥 大人 {{ order.adultCount ?? 1 }} / 兒童 {{ order.childCount }}
      span(v-else) 👥 {{ order.passengerCount }} 人
      span {{ order.distanceKm }} km
    .DriverDispatchedOrderCard__btns
      button.DriverDispatchedOrderCard__btn.is-withdraw(
        v-if="showWithdraw && order.myBidStatus === 'bid'"
        :disabled="busy"
        type="button"
        @click="ClickWithdraw"
      ) 撤回喊單
      button.DriverDispatchedOrderCard__btn.is-open(
        :disabled="busy"
        type="button"
        @click.stop="ClickOpen"
      ) 查看詳情 ›
</template>

<style lang="scss" scoped>

.DriverDispatchedOrderCard {
  padding: 16px;
  border-radius: var(--r-lg);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-a06);
    border-color: var(--accent-a30);
  }

  &.is-bid {
    border-color: var(--accent-a50);
    background: var(--accent-a06);
  }

  &.is-withdrawn {
    opacity: 0.65;
  }
}

.DriverDispatchedOrderCard__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.DriverDispatchedOrderCard__type-badge {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent);
}

.DriverDispatchedOrderCard__id {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
  margin-left: auto;
}

// 提案規則二：派單等級用描邊章，不用實心色塊 —— 一張單上已經有夠多東西要看。
.DriverDispatchedOrderCard__level {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  line-height: var(--lh-flat);
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: transparent;
  border: 1px solid var(--surface-a20);
  color: var(--surface-a60);
}

.DriverDispatchedOrderCard__level.is-top {
  border-color: var(--accent-a50);
  color: var(--accent);
}

.DriverDispatchedOrderCard__bid-tag {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--good-a15);
  border: 1px solid var(--good-a30);
  color: var(--good);

  // 提案規則三：紅是整個 app 唯一的一種意思（異常／破壞性動作）。
  // 「已撤回」是既成狀態不是異常，改素色描邊。
  &.is-withdraw {
    background: transparent;
    border-color: var(--surface-a20);
    color: var(--surface-a60);
  }
}

.DriverDispatchedOrderCard__time {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}

.DriverDispatchedOrderCard__time-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-caps-lg);
  color: var(--surface-a40);
  text-transform: uppercase;
}

.DriverDispatchedOrderCard__time-val {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--surface-raised);
}

.DriverDispatchedOrderCard__route {
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
  padding: 12px;
  border-radius: var(--r-md);
  background: var(--ink-a20);
}

.DriverDispatchedOrderCard__route-point {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--surface-a82);

  span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.DriverDispatchedOrderCard__route-dot {
  width: 8px; height: 8px;
  border-radius: var(--r-round);
  flex-shrink: 0;
}

.DriverDispatchedOrderCard__route-point.is-pickup .DriverDispatchedOrderCard__route-dot {
  background: var(--accent);
}
.DriverDispatchedOrderCard__route-point.is-dropoff .DriverDispatchedOrderCard__route-dot {
  background: var(--good);
}

.DriverDispatchedOrderCard__route-line {
  width: 1px;
  height: 16px;
  background: var(--surface-a12);
  margin-left: 3.5px;
  margin-top: 4px;
  margin-bottom: 4px;
}

.DriverDispatchedOrderCard__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.DriverDispatchedOrderCard__countdown {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  padding: 5px 10px;
  margin-bottom: 12px;
  border-radius: var(--r-sm);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  color: var(--surface-a60);

  // 提案規則三：即將降級是「時間壓力」不是異常，用香檳色，紅留給回報異常。
  &.is-urgent {
    color: var(--wait);
    border-color: var(--wait-a30);
    background: var(--wait-a08);
  }

  &.is-expired {
    color: var(--surface-a50);
    font-style: italic;
  }
}

.DriverDispatchedOrderCard__chip {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  padding: 3px 9px;
  border-radius: var(--r-pill);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a12);
  color: var(--surface-a72);
}

// 提案規則一：金額換襯線，且是卡片上最大的字（時間 --fs-h2 之上一階）。
.DriverDispatchedOrderCard__fare {
  display: flex;
  align-items: baseline;
  gap: var(--space-2xs);
  margin-bottom: 12px;
}

.DriverDispatchedOrderCard__fare-cur {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--surface-a60);
}

.DriverDispatchedOrderCard__fare-val {
  font-family: var(--ff-display);
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h1);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-tight);
  color: var(--surface-raised);
}

.DriverDispatchedOrderCard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.DriverDispatchedOrderCard__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a60);
}

.DriverDispatchedOrderCard__btns {
  display: flex;
  gap: 8px;
}

.DriverDispatchedOrderCard__btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 7px 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--accent-a50);
  background: var(--accent-a12);
  color: var(--accent);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) { background: var(--accent-a20); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }

  // 提案規則三：全站唯一的紅，且是描邊不是實心。
  &.is-withdraw {
    border-color: var(--stop-a45);
    background: transparent;
    color: var(--stop);
    &:hover:not(:disabled) { background: var(--stop-a08); }
  }
}
</style>
