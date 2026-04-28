<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

interface Notification {
  id: string;
  type: 'order_created' | 'order_cancelled' | 'driver_assigned' | 'trip_started' | 'trip_completed' | 'system';
  title: string;
  body: string;
  sentAt: string;
  recipients: number;
  channel: 'line' | 'push' | 'system';
}

const TYPE_LABEL: Record<string, string> = {
  order_created:   '訂單建立',
  order_cancelled: '訂單取消',
  driver_assigned: '司機分派',
  trip_started:    '行程開始',
  trip_completed:  '行程完成',
  system:          '系統通知',
};
const CHANNEL_LABEL: Record<string, string> = {
  line:   'LINE Bot',
  push:   'Push',
  system: '系統',
};
const CHANNEL_CLASS: Record<string, string> = {
  line:   'is-line',
  push:   'is-push',
  system: 'is-system',
};

const loading = ref(false);
const notifications = ref<Notification[]>([]);

const _loadMock = () => {
  notifications.value = [
    {
      id: 'N001', type: 'order_created', channel: 'line',
      title: '✅ 訂單確認通知', body: '您的接機訂單 #A1B2C3D4 已確認，用車時間：03/15 14:30',
      sentAt: $dayjs().subtract(10, 'minute').toISOString(), recipients: 1,
    },
    {
      id: 'N002', type: 'driver_assigned', channel: 'line',
      title: '🚗 司機已分派', body: '您的訂單已分派司機陳志明，車牌 ABC-1234，預計提早10分鐘抵達',
      sentAt: $dayjs().subtract(35, 'minute').toISOString(), recipients: 1,
    },
    {
      id: 'N003', type: 'trip_completed', channel: 'line',
      title: '🏁 行程完成', body: '感謝您使用 DestinationAnywhere，歡迎下次預約',
      sentAt: $dayjs().subtract(2, 'hour').toISOString(), recipients: 1,
    },
    {
      id: 'N004', type: 'system', channel: 'system',
      title: '系統維護公告', body: '2026/05/01 凌晨 2:00–4:00 系統維護，服務暫停',
      sentAt: $dayjs().subtract(1, 'day').toISOString(), recipients: 48,
    },
    {
      id: 'N005', type: 'order_cancelled', channel: 'line',
      title: '❌ 訂單取消通知', body: '訂單 #Q7R8S9T0 已取消，如有疑問請聯繫客服',
      sentAt: $dayjs().subtract(3, 'hour').toISOString(), recipients: 1,
    },
  ];
};

const stats = computed(() => ({
  total: notifications.value.length,
  today: notifications.value.filter((n) => $dayjs(n.sentAt).isAfter($dayjs().startOf('day'))).length,
  line: notifications.value.filter((n) => n.channel === 'line').length,
}));

onMounted(() => {
  loading.value = true;
  setTimeout(() => { _loadMock(); loading.value = false; }, 500);
});
</script>

<template lang="pug">
.PageAdminNotifications
  .PageAdminNotifications__header
    .PageAdminNotifications__header-label NOTIFICATION LOG
    h1.PageAdminNotifications__header-title 通知管理

  //- Stats
  .PageAdminNotifications__stats
    .PageAdminNotifications__stat
      .PageAdminNotifications__stat-label TOTAL
      .PageAdminNotifications__stat-val {{ stats.total }}
    .PageAdminNotifications__stat
      .PageAdminNotifications__stat-label TODAY
      .PageAdminNotifications__stat-val {{ stats.today }}
    .PageAdminNotifications__stat
      .PageAdminNotifications__stat-label LINE BOT
      .PageAdminNotifications__stat-val {{ stats.line }}

  //- Loading
  .PageAdminNotifications__loading(v-if="loading")
    .PageAdminNotifications__spinner

  template(v-else)
    .PageAdminNotifications__empty(v-if="!notifications.length")
      p 暫無通知紀錄

    .PageAdminNotifications__list(v-else)
      .PageAdminNotifications__item(v-for="n in notifications" :key="n.id")
        .PageAdminNotifications__item-head
          span.PageAdminNotifications__channel(:class="CHANNEL_CLASS[n.channel]") {{ CHANNEL_LABEL[n.channel] }}
          span.PageAdminNotifications__type {{ TYPE_LABEL[n.type] ?? n.type }}
          span.PageAdminNotifications__time {{ $dayjs(n.sentAt).format('MM/DD HH:mm') }}
        .PageAdminNotifications__title {{ n.title }}
        .PageAdminNotifications__body {{ n.body }}
        .PageAdminNotifications__item-foot
          span {{ n.recipients }} 位收件人
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.35);

.PageAdminNotifications {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageAdminNotifications__header {
  margin-bottom: 24px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    letter-spacing: 0.04em;
    color: #fff;
  }
}

.PageAdminNotifications__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 24px;
}

.PageAdminNotifications__stat {
  background: $surface;
  border: 1px solid $border;
  border-radius: 14px;
  padding: 14px 16px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: $muted;
    margin-bottom: 6px;
  }

  &-val {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    color: #fff;
    line-height: 1;
  }
}

.PageAdminNotifications__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageAdminNotifications__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.PageAdminNotifications__empty {
  text-align: center;
  padding: 60px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: $muted;
}

.PageAdminNotifications__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageAdminNotifications__item {
  background: $surface;
  border: 1px solid $border;
  border-radius: 14px;
  padding: 14px 16px;

  &-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  &-foot {
    margin-top: 8px;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    color: $muted;
  }
}

.PageAdminNotifications__channel {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 100px;

  &.is-line   { background: rgba(0, 185, 0, 0.12); border: 1px solid rgba(0, 185, 0, 0.3); color: #00c300; }
  &.is-push   { background: rgba(100, 160, 255, 0.12); border: 1px solid rgba(100, 160, 255, 0.3); color: #64a0ff; }
  &.is-system { background: rgba(255, 255, 255, 0.06); border: 1px solid $border; color: $muted; }
}

.PageAdminNotifications__type {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.PageAdminNotifications__time {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  margin-left: auto;
}

.PageAdminNotifications__title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 4px;
}

.PageAdminNotifications__body {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.6;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
