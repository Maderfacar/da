<script setup lang="ts">
import { ORDER_TYPES } from '~shared/pricing';
import type { OrderType } from '~shared/pricing';

interface Props {
  orderType: OrderType | undefined;
  pickupDateTime: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:orderType', val: OrderType): void;
  (e: 'update:pickupDateTime', val: string): void;
  (e: 'next'): void;
}>();

const selectedType = ref<OrderType | undefined>(props.orderType);
const dateTime = ref(props.pickupDateTime ?? '');

// 最早可預約：明天起
const minDate = computed(() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
});

watch(selectedType, (val) => { if (val) emit('update:orderType', val); });
watch(dateTime, (val) => emit('update:pickupDateTime', val));

const canNext = computed(() => !!selectedType.value && !!dateTime.value);

const ClickNext = () => {
  if (!canNext.value) return;
  emit('next');
};
</script>

<template lang="pug">
.PassengerBookingStepType
  .PassengerBookingStepType__section-label ORDER TYPE
  h2.PassengerBookingStepType__title 選擇行程類型

  .PassengerBookingStepType__grid
    .PassengerBookingStepType__card(
      v-for="t in ORDER_TYPES"
      :key="t.value"
      :class="{ 'is-active': selectedType === t.value }"
      @click="selectedType = t.value"
    )
      NuxtIcon.PassengerBookingStepType__card-icon(:name="t.icon")
      span.PassengerBookingStepType__card-en {{ t.labelEn }}
      span.PassengerBookingStepType__card-zh {{ t.label }}

  .PassengerBookingStepType__section-label.mt DATE &amp; TIME
  h2.PassengerBookingStepType__title 用車日期與時間

  ElDatePicker.PassengerBookingStepType__picker(
    v-model="dateTime"
    type="datetime"
    placeholder="選擇日期與時間"
    format="YYYY/MM/DD HH:mm"
    value-format="YYYY-MM-DDTHH:mm:ss"
    :min="minDate"
    :minute-step="15"
    style="width: 100%"
  )

  UiButton(
    type="primary"
    :disabled="!canNext"
    @click="ClickNext"
    style="margin-top: 28px; width: 100%"
  ) 下一步 NEXT →
</template>

<style lang="scss" scoped>
.PassengerBookingStepType {
  &__section-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--da-amber);
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;

    &::before {
      content: '';
      width: 24px;
      height: 1.5px;
      background: var(--da-amber);
    }

    &.mt { margin-top: 28px; }
  }

  &__title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    color: var(--da-dark);
    margin-bottom: 20px;
    letter-spacing: 0.02em;
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  &__card {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 16px;
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s, transform 0.15s;
    user-select: none;

    &:active { transform: scale(0.97); }

    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
    }
  }

  &__card-icon {
    font-size: 32px;
    color: var(--da-amber);
  }

  &__card-en {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--da-gray);
  }

  &__card-zh {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--da-dark);
  }
}
</style>
