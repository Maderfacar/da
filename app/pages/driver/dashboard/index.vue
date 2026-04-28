<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const driverName = computed(() => authStore.lineProfile?.displayName ?? '司機');

// Mock 今日統計（正式串接時改呼叫 API）
const stats = [
  { label: 'TRIPS TODAY', labelZh: '今日趟次', value: '0', unit: '趟' },
  { label: 'EARNINGS',    labelZh: '今日收入', value: 'NT$ 0', unit: '' },
  { label: 'ONLINE HRS',  labelZh: '上線時數', value: '0',     unit: 'hr' },
];

const now = computed(() => $dayjs().format('YYYY / MM / DD'));
</script>

<template lang="pug">
.PageDriverDashboard
  //- 頁首
  .PageDriverDashboard__header
    .PageDriverDashboard__header-label DRIVER PORTAL
    h1.PageDriverDashboard__header-title 歡迎回來
    p.PageDriverDashboard__header-name {{ driverName }}
    p.PageDriverDashboard__header-date {{ now }}

  //- 今日統計
  .PageDriverDashboard__stats
    .PageDriverDashboard__stat(v-for="s in stats" :key="s.label")
      .PageDriverDashboard__stat-label {{ s.label }}
      .PageDriverDashboard__stat-val {{ s.value }}
      .PageDriverDashboard__stat-unit {{ s.unit }}

  //- 快捷操作
  .PageDriverDashboard__actions
    NuxtLink.PageDriverDashboard__action-btn.is-primary(to="/driver/pending")
      .PageDriverDashboard__action-icon 📋
      .PageDriverDashboard__action-text
        span 搶單
        small PENDING ORDERS
    NuxtLink.PageDriverDashboard__action-btn(to="/driver/trip")
      .PageDriverDashboard__action-icon ✅
      .PageDriverDashboard__action-text
        span 任務
        small MY TRIP

  //- 狀態說明
  .PageDriverDashboard__notice
    p 前往「任務」頁開始上線並接受 GPS 追蹤
    p 前往「搶單」頁查看可接訂單
</template>

<style lang="scss" scoped>
$amber: #d4860a;

.PageDriverDashboard {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: #0d0f14;
  color: #fff;
}

.PageDriverDashboard__header {
  margin-bottom: 32px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 40px;
    letter-spacing: 0.04em;
    line-height: 1;
    color: #fff;
  }

  &-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: $amber;
    margin-top: 4px;
  }

  &-date {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 0.15em;
    color: rgba(255, 255, 255, 0.3);
    margin-top: 2px;
  }
}

.PageDriverDashboard__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 28px;
}

.PageDriverDashboard__stat {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 14px 12px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 6px;
  }

  &-val {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 24px;
    color: #fff;
    line-height: 1;
  }

  &-unit {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    margin-top: 2px;
  }
}

.PageDriverDashboard__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.PageDriverDashboard__action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 16px;
  border-radius: 18px;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  text-decoration: none;
  transition: transform 0.15s, border-color 0.2s;

  &:active { transform: scale(0.97); }

  &.is-primary {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.08);
  }

  &-icon { font-size: 32px; }

  &-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;

    span {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 20px;
      color: #fff;
      letter-spacing: 0.05em;
    }

    small {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: rgba(255, 255, 255, 0.3);
    }
  }
}

.PageDriverDashboard__notice {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  padding: 14px 16px;

  p {
    font-family: 'Barlow', 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.35);
    line-height: 1.8;
    &::before { content: '· '; }
  }
}
</style>
