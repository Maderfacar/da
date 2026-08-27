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

  .DriverDispatchedOrderCard__foot
    .DriverDispatchedOrderCard__meta
      //- Booking v2 批次 2：child=0 退回「N 人」，否則拆「大人 X / 兒童 Y」
      span(v-if="(order.childCount ?? 0) > 0") 👥 大人 {{ order.adultCount ?? 1 }} / 兒童 {{ order.childCount }}
      span(v-else) 👥 {{ order.passengerCount }} 人
      span {{ order.distanceKm }} km
      span NT$ {{ order.estimatedFare.toLocaleString() }}
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
  font-size: 10px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent);
}

.DriverDispatchedOrderCard__id {
  font-family: var(--ff-label);
  font-size: 11px;
  color: var(--surface-a40);
  margin-left: auto;
}

.DriverDispatchedOrderCard__bid-tag {
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--good-a15);
  border: 1px solid var(--good-a30);
  color: var(--good);

  &.is-withdraw {
    background: var(--stop-a08);
    border-color: var(--stop-a30);
    color: var(--stop);
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
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--surface-a40);
  text-transform: uppercase;
}

.DriverDispatchedOrderCard__time-val {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: 22px;
  letter-spacing: 0.05em;
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
  font-size: 13px;
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
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 10px;
  margin-bottom: 12px;
  border-radius: var(--r-sm);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  color: var(--surface-a60);

  &.is-urgent {
    color: var(--stop);
    border-color: var(--stop-a30);
    background: var(--stop-a08);
  }

  &.is-expired {
    color: var(--surface-a50);
    font-style: italic;
  }
}

.DriverDispatchedOrderCard__chip {
  font-family: var(--ff-ui);
  font-size: 11px;
  padding: 3px 9px;
  border-radius: var(--r-pill);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a12);
  color: var(--surface-a72);
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
  font-size: 12px;
  color: var(--surface-a60);
}

.DriverDispatchedOrderCard__btns {
  display: flex;
  gap: 8px;
}

.DriverDispatchedOrderCard__btn {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--accent-a50);
  background: var(--accent-a12);
  color: var(--accent);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) { background: var(--accent-a20); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-withdraw {
    border-color: var(--stop-a45);
    background: var(--stop-a08);
    color: var(--stop);
    &:hover:not(:disabled) { background: var(--stop-a15); }
  }
}
</style>
