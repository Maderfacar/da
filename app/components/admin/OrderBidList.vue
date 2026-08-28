<script setup lang="ts">
import type { AdminBidWithMatch } from '@/protocol/fetch-api/api/admin';

interface Props {
  bids: AdminBidWithMatch[];
  /** 進行中按鈕 disable（assigning 中 / orderStatus 非 pending） */
  assignDisabled?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  assignDisabled: false,
});

const emit = defineEmits<{
  (e: 'assign', driverId: string): void;
}>();

// 排序：未撤回優先 → matchCount desc → completedOrders desc → bidAt asc
const sortedBids = computed(() => {
  const arr = [...props.bids];
  arr.sort((a, b) => {
    const aActive = !a.withdrawnAt ? 1 : 0;
    const bActive = !b.withdrawnAt ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
    if (a.completedOrders !== b.completedOrders) return b.completedOrders - a.completedOrders;
    const aTs = a.bidAt ? Date.parse(a.bidAt) : 0;
    const bTs = b.bidAt ? Date.parse(b.bidAt) : 0;
    return aTs - bTs;
  });
  return arr;
});

const FormatTime = (iso: string | null): string => {
  if (!iso) return '—';
  return $dayjs(iso).format('MM/DD HH:mm');
};

const ClickAssign = (driverId: string) => {
  if (props.assignDisabled) return;
  emit('assign', driverId);
};
</script>

<template lang="pug">
.AdminOrderBidList
  .AdminOrderBidList__empty(v-if="!sortedBids.length")
    span 目前無司機喊單
  .AdminOrderBidList__list(v-else)
    .AdminOrderBidList__row(
      v-for="bid in sortedBids"
      :key="bid.driverId + (bid.withdrawnAt ?? '')"
      :class="{ 'is-withdrawn': !!bid.withdrawnAt }"
    )
      .AdminOrderBidList__info
        .AdminOrderBidList__name {{ bid.driverDisplayName || bid.driverId.slice(0, 8) }}
          span.AdminOrderBidList__withdraw-tag(v-if="bid.withdrawnAt") 已撤回
        .AdminOrderBidList__meta
          span.AdminOrderBidList__match(v-if="bid.preferenceCount > 0") ★ {{ bid.matchCount }}/{{ bid.preferenceCount }} 命中
          span.AdminOrderBidList__match.is-none(v-else) ★ 乘客未選偏好
          span.AdminOrderBidList__divider •
          span ✓ {{ bid.completedOrders }} 趟
          template(v-if="bid.verifiedAt")
            span.AdminOrderBidList__divider •
            span 已認證 {{ FormatTime(bid.verifiedAt) }}
        .AdminOrderBidList__tags(v-if="bid.matchedTagNames.length")
          span.AdminOrderBidList__tag(v-for="(n, i) in bid.matchedTagNames" :key="i") {{ n }}
        .AdminOrderBidList__time 喊單時間：{{ FormatTime(bid.bidAt) }}
      button.AdminOrderBidList__assign(
        v-if="!bid.withdrawnAt"
        :disabled="assignDisabled"
        type="button"
        @click="ClickAssign(bid.driverId)"
      ) 指派此司機
</template>

<style lang="scss" scoped>




.AdminOrderBidList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.AdminOrderBidList__empty {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
  padding: 16px 0;
  text-align: center;
}

.AdminOrderBidList__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.AdminOrderBidList__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-md);
  background: var(--surface-a06);

  &.is-withdrawn {
    opacity: 0.4;
    filter: grayscale(0.6);
  }
}

.AdminOrderBidList__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.AdminOrderBidList__name {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--surface-a82);
  display: flex;
  align-items: center;
  gap: 8px;
}

.AdminOrderBidList__withdraw-tag {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--r-pill);
  background: var(--stop-a15);
  border: 1px solid var(--stop-a30);
  color: var(--stop);
}

.AdminOrderBidList__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.AdminOrderBidList__match {
  color: var(--accent-text);
  font-weight: 700;
  &.is-none { color: var(--surface-a40); font-weight: 500; }
}

.AdminOrderBidList__divider {
  color: var(--surface-a20);
}

.AdminOrderBidList__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.AdminOrderBidList__tag {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent-a90);
}

.AdminOrderBidList__time {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.AdminOrderBidList__assign {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 8px 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--accent-a50);
  background: var(--accent-a12);
  color: var(--accent-text);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: var(--accent-a20);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

@media (max-width: 599.98px) {
  .AdminOrderBidList__row {
    flex-direction: column;
    align-items: stretch;
  }
  .AdminOrderBidList__assign {
    width: 100%;
  }
}
</style>
