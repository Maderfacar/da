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
$amber: #d4860a;
$border: rgba(255, 255, 255, 0.1);
$text: rgba(255, 255, 255, 0.85);
$muted: rgba(255, 255, 255, 0.45);

.AdminOrderBidList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.AdminOrderBidList__empty {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
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
  border: 1px solid $border;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);

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
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: $text;
  display: flex;
  align-items: center;
  gap: 8px;
}

.AdminOrderBidList__withdraw-tag {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 100px;
  background: rgba(255, 100, 100, 0.12);
  border: 1px solid rgba(255, 100, 100, 0.3);
  color: rgba(255, 120, 120, 0.85);
}

.AdminOrderBidList__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.AdminOrderBidList__match {
  color: $amber;
  font-weight: 700;
  &.is-none { color: $muted; font-weight: 500; }
}

.AdminOrderBidList__divider {
  color: rgba(255, 255, 255, 0.18);
}

.AdminOrderBidList__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.AdminOrderBidList__tag {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba($amber, 0.12);
  border: 1px solid rgba($amber, 0.25);
  color: rgba($amber, 0.9);
}

.AdminOrderBidList__time {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: $muted;
}

.AdminOrderBidList__assign {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 8px 14px;
  border-radius: 100px;
  border: 1px solid rgba($amber, 0.5);
  background: rgba($amber, 0.12);
  color: $amber;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: rgba($amber, 0.2);
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
