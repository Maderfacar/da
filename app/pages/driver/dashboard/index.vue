<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const driverName = computed(() => authStore.lineProfile?.displayName ?? '司機');
const now = computed(() => $dayjs().format('YYYY / MM / DD'));

const tripsToday = ref(0);
const earningsToday = ref(0);

// P29：driver OA 加好友 CTA（核准後第一次進 dashboard 顯示，可 dismiss）
const runtimeConfig = useRuntimeConfig();
const driverOaUrl = computed(() => runtimeConfig.public.lineOaAddUrlDriver as string);
const OA_DISMISS_KEY = 'driver-oa-cta-dismissed-v1';
const showOaCta = ref(false);
onMounted(() => {
  if (!driverOaUrl.value) return;
  if (localStorage.getItem(OA_DISMISS_KEY) === '1') return;
  showOaCta.value = true;
});
const ClickDismissOaCta = () => {
  localStorage.setItem(OA_DISMISS_KEY, '1');
  showOaCta.value = false;
};

const ApiLoadStats = async () => {
  const uid = authStore.user?.uid;
  if (!uid) return;
  const res = await $api.GetDriverStats(uid);
  if (res.status.code === 200 && res.data) {
    const data = res.data as DriverStats;
    tripsToday.value = data.tripsToday;
    earningsToday.value = data.earningsToday;
  }
};

// ONLINE HRS 暫時隱藏：永遠顯示 0 對 driver 沒參考價值；之後接後端上線時數累計 API 再放回
const stats = computed(() => [
  { label: 'TRIPS TODAY', labelZh: '今日趟次', value: String(tripsToday.value), unit: '趟' },
  { label: 'EARNINGS',    labelZh: '今日收入', value: `NT$ ${earningsToday.value.toLocaleString()}`, unit: '' },
]);

onMounted(ApiLoadStats);
</script>

<template lang="pug">
.PageDriverDashboard
  //- P29：加 driver OA 為好友 CTA（核准司機第一次進 dashboard 看到，dismiss 後不再出現）
  .PageDriverDashboard__oa-cta(v-if="showOaCta")
    .PageDriverDashboard__oa-cta-icon 🔔
    .PageDriverDashboard__oa-cta-text
      strong 加 Driver LINE 為好友
      span 才能收到新派單與訂單更新通知
    a.PageDriverDashboard__oa-cta-btn(
      :href="driverOaUrl"
      target="_blank"
      rel="noopener"
    ) 加為好友
    button.PageDriverDashboard__oa-cta-dismiss(
      type="button"
      aria-label="關閉"
      @click="ClickDismissOaCta"
    ) ×

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

  //- 機場人流預報（精簡模式）+ 桃園氣象
  .PageDriverDashboard__widgets
    AdminAirportForecastWidget(:compact="true")
    WeatherWidget

  //- 狀態說明
  .PageDriverDashboard__notice
    p 前往「任務」頁開始上線並接受 GPS 追蹤
    p 前往「搶單」頁查看可接訂單
</template>

<style lang="scss" scoped>
$amber: #d4860a;

.PageDriverDashboard {
  padding: 80px 20px 32px;
  min-height: 100svh;
  background: #0d0f14;
  color: #fff;
}

// ── Driver OA CTA ──────────────────────────────────────────
.PageDriverDashboard__oa-cta {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 20px;
  background: rgba(6, 199, 85, 0.12);
  border: 1px solid rgba(6, 199, 85, 0.35);
  border-radius: 12px;
}

.PageDriverDashboard__oa-cta-icon { font-size: 22px; }

.PageDriverDashboard__oa-cta-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.PageDriverDashboard__oa-cta-text strong {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #fff;
}
.PageDriverDashboard__oa-cta-text span {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.4;
}

.PageDriverDashboard__oa-cta-btn {
  flex-shrink: 0;
  padding: 8px 16px;
  background: #06c755;
  color: #fff;
  border-radius: 100px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-decoration: none;
  white-space: nowrap;

  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.97); }
}

.PageDriverDashboard__oa-cta-dismiss {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;

  &:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
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

@media (max-width: 479.98px) {
  .PageDriverDashboard__stats {
    grid-template-columns: 1fr;
    gap: 8px;
  }
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

.PageDriverDashboard__widgets {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.PageDriverDashboard__notice {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  padding: 14px 16px;
  margin-top: 20px;

  p {
    font-family: 'Barlow', 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.35);
    line-height: 1.8;
    &::before { content: '· '; }
  }
}
</style>
