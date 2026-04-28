<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const displayName = computed(() => authStore.lineProfile?.displayName ?? '司機');
const pictureUrl  = computed(() => authStore.lineProfile?.pictureUrl ?? '');
const uid         = computed(() => authStore.user?.uid ?? '');

// Mock 司機資料（正式版接 Firestore driver document）
const driverInfo = reactive({
  vehicleType:  'MPV',
  licensePlate: 'ABC-1234',
  phone:        '0912-345-678',
  joinedDate:   '2025/01/15',
  totalTrips:   147,
  rating:       4.9,
});

const ClickSignOut = async () => {
  const { getAuth, signOut } = await import('firebase/auth');
  await signOut(getAuth());
  navigateTo('/');
};
</script>

<template lang="pug">
.PageDriverProfile
  .PageDriverProfile__header
    .PageDriverProfile__header-label MY PROFILE
    h1.PageDriverProfile__header-title 我的資料

  //- 頭像 + 名稱
  .PageDriverProfile__hero
    .PageDriverProfile__avatar-wrap
      img.PageDriverProfile__avatar(v-if="pictureUrl" :src="pictureUrl" alt="avatar")
      .PageDriverProfile__avatar-fallback(v-else) {{ displayName.slice(0, 1) }}
    .PageDriverProfile__hero-info
      .PageDriverProfile__name {{ displayName }}
      .PageDriverProfile__uid UID · {{ uid.slice(0, 8) }}
    .PageDriverProfile__rating
      span.PageDriverProfile__rating-star ⭐
      span.PageDriverProfile__rating-val {{ driverInfo.rating.toFixed(1) }}

  //- 統計
  .PageDriverProfile__stats
    .PageDriverProfile__stat
      .PageDriverProfile__stat-label TOTAL TRIPS
      .PageDriverProfile__stat-val {{ driverInfo.totalTrips }}
    .PageDriverProfile__stat
      .PageDriverProfile__stat-label RATING
      .PageDriverProfile__stat-val {{ driverInfo.rating.toFixed(1) }}
    .PageDriverProfile__stat
      .PageDriverProfile__stat-label JOINED
      .PageDriverProfile__stat-val {{ driverInfo.joinedDate }}

  //- 車輛資料
  .PageDriverProfile__section
    .PageDriverProfile__section-label VEHICLE INFO
    .PageDriverProfile__rows
      .PageDriverProfile__row
        span.PageDriverProfile__row-key 車型
        span.PageDriverProfile__row-val {{ driverInfo.vehicleType }}
      .PageDriverProfile__row
        span.PageDriverProfile__row-key 車牌
        span.PageDriverProfile__row-val {{ driverInfo.licensePlate }}
      .PageDriverProfile__row
        span.PageDriverProfile__row-key 聯絡電話
        span.PageDriverProfile__row-val {{ driverInfo.phone }}

  //- 帳號
  .PageDriverProfile__section
    .PageDriverProfile__section-label ACCOUNT
    .PageDriverProfile__rows
      .PageDriverProfile__row
        span.PageDriverProfile__row-key LINE 帳號
        span.PageDriverProfile__row-val {{ displayName }}
      .PageDriverProfile__row
        span.PageDriverProfile__row-key 身份
        span.PageDriverProfile__row-val 司機

  //- 登出
  button.PageDriverProfile__signout(@click="ClickSignOut") 登出
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.35);

.PageDriverProfile {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageDriverProfile__header {
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

.PageDriverProfile__hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: $surface;
  border: 1px solid $border;
  border-radius: 18px;
  margin-bottom: 16px;
}

.PageDriverProfile__avatar-wrap { flex-shrink: 0; }

.PageDriverProfile__avatar {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba($amber, 0.4);
}

.PageDriverProfile__avatar-fallback {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: rgba($amber, 0.15);
  border: 2px solid rgba($amber, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: $amber;
}

.PageDriverProfile__hero-info { flex: 1; min-width: 0; }

.PageDriverProfile__name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
}

.PageDriverProfile__uid {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  margin-top: 2px;
}

.PageDriverProfile__rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.PageDriverProfile__rating-star { font-size: 18px; }

.PageDriverProfile__rating-val {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 20px;
  color: $amber;
  line-height: 1;
}

.PageDriverProfile__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.PageDriverProfile__stat {
  background: $surface;
  border: 1px solid $border;
  border-radius: 14px;
  padding: 12px 14px;

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
    font-size: 20px;
    color: #fff;
    line-height: 1;
  }
}

.PageDriverProfile__section {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 14px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: $muted;
    padding: 10px 16px 8px;
    border-bottom: 1px solid $border;
    background: rgba(255, 255, 255, 0.02);
  }
}

.PageDriverProfile__rows { display: flex; flex-direction: column; }

.PageDriverProfile__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  &:last-child { border-bottom: none; }

  &-key {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    color: $muted;
  }

  &-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.8);
  }
}

.PageDriverProfile__signout {
  width: 100%;
  margin-top: 8px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 80, 80, 0.25);
  background: rgba(255, 80, 80, 0.06);
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 100, 100, 0.7);
  cursor: pointer;
  transition: all 0.15s;

  &:active { transform: scale(0.98); }
}
</style>
