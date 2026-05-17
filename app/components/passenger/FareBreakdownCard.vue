<script setup lang="ts">
interface Props {
  /** 顯示的預估車資（已套折扣時由呼叫端傳折後金額）；尚未估出為 null */
  fareTotal: number | null;
  loading?: boolean;
}

withDefaults(defineProps<Props>(), {
  loading: false,
});
</script>

<template lang="pug">
.PassengerFareBreakdownCard
  .PassengerFareBreakdownCard__head
    span.PassengerFareBreakdownCard__label {{ $t('booking.fareBreakdown.title') }}
    .PassengerFareBreakdownCard__head-right
      NuxtIcon.PassengerFareBreakdownCard__spin(v-if="loading" name="mdi:loading")
      span.PassengerFareBreakdownCard__total(v-else)
        | NT$ {{ fareTotal !== null ? fareTotal.toLocaleString() : '—' }}
</template>

<style lang="scss" scoped>
.PassengerFareBreakdownCard {
  background: var(--da-dark);
  border-radius: 16px;
  padding: 16px 20px;
}

.PassengerFareBreakdownCard__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.PassengerFareBreakdownCard__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PassengerFareBreakdownCard__head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.PassengerFareBreakdownCard__total {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 32px;
  color: var(--da-amber-light);
  letter-spacing: 0.05em;
}

.PassengerFareBreakdownCard__spin {
  font-size: 22px;
  color: var(--da-amber-light);
  animation: fare-breakdown-spin 0.8s linear infinite;
}

@keyframes fare-breakdown-spin {
  to { transform: rotate(360deg); }
}
</style>
