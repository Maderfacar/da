<script setup lang="ts">
import type { AdminUser } from '@/protocol/fetch-api/api/admin';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const loading = ref(false);
const drivers = ref<AdminUser[]>([]);
const filterApproved = ref<'' | 'approved' | 'pending'>('');

const approvedDrivers = computed(() => drivers.value.filter((d) => d.approved));
const pendingDrivers  = computed(() => drivers.value.filter((d) => !d.approved));

const filteredDrivers = computed(() => {
  if (filterApproved.value === 'approved') return approvedDrivers.value;
  if (filterApproved.value === 'pending')  return pendingDrivers.value;
  return drivers.value;
});

const ApiLoadDrivers = async () => {
  loading.value = true;
  const res = await $api.GetAdminUsers({ role: 'driver' });
  drivers.value = (res.data as AdminUser[]) ?? [];
  loading.value = false;
};

const ClickApprove = async (uid: string) => {
  const res = await $api.PatchAdminUser(uid, { approved: true });
  if (res.status.code === 200) {
    const d = drivers.value.find((x) => x.uid === uid);
    if (d) d.approved = true;
    ElMessage({ message: '已核准', type: 'success' });
  }
};

const ClickRevoke = async (uid: string) => {
  const ok = await UseAsk('確定要撤銷此司機的存取權？');
  if (!ok) return;
  const res = await $api.PatchAdminUser(uid, { approved: false });
  if (res.status.code === 200) {
    const d = drivers.value.find((x) => x.uid === uid);
    if (d) d.approved = false;
    ElMessage({ message: '已撤銷', type: 'warning' });
  }
};

onMounted(ApiLoadDrivers);
</script>

<template lang="pug">
.PageAdminDrivers
  .PageAdminDrivers__header
    .PageAdminDrivers__header-label DRIVER MANAGEMENT
    h1.PageAdminDrivers__header-title 司機管理

  .PageAdminDrivers__summary
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label TOTAL
      .PageAdminDrivers__summary-val {{ drivers.length }}
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label APPROVED
      .PageAdminDrivers__summary-val {{ approvedDrivers.length }}
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label PENDING
      .PageAdminDrivers__summary-val {{ pendingDrivers.length }}

  .PageAdminDrivers__toolbar
    .PageAdminDrivers__filters
      button.PageAdminDrivers__filter-btn(
        v-for="(label, key) in { '': '全部', approved: '已核准', pending: '待審核' }"
        :key="key"
        :class="{ 'is-active': filterApproved === key }"
        @click="filterApproved = key as ''"
      ) {{ label }}

  .PageAdminDrivers__loading(v-if="loading")
    .PageAdminDrivers__spinner

  template(v-else)
    .PageAdminDrivers__empty(v-if="!filteredDrivers.length")
      p 暫無司機資料

    .PageAdminDrivers__list(v-else)
      .PageAdminDrivers__card(v-for="d in filteredDrivers" :key="d.uid")
        .PageAdminDrivers__card-top
          .PageAdminDrivers__avatar-wrap
            img.PageAdminDrivers__avatar(v-if="d.pictureUrl" :src="d.pictureUrl" :alt="d.displayName")
            .PageAdminDrivers__avatar-fallback(v-else) {{ d.displayName.slice(0, 1) }}
          .PageAdminDrivers__info
            .PageAdminDrivers__name {{ d.displayName }}
            .PageAdminDrivers__uid UID: {{ d.uid.slice(0, 10) }}...
          span.PageAdminDrivers__status(:class="d.approved ? 'is-approved' : 'is-pending'") {{ d.approved ? '已核准' : '待審核' }}

        .PageAdminDrivers__card-meta
          .PageAdminDrivers__meta-item
            span.PageAdminDrivers__meta-label 加入時間
            span.PageAdminDrivers__meta-val {{ $dayjs(d.createdAt).format('YYYY/MM/DD') }}
          .PageAdminDrivers__meta-item
            span.PageAdminDrivers__meta-label LINE UID
            span.PageAdminDrivers__meta-val {{ d.lineUserId.slice(0, 10) }}...

        .PageAdminDrivers__card-actions
          button.PageAdminDrivers__action-btn.is-approve(
            v-if="!d.approved"
            @click="ClickApprove(d.uid)"
          ) 核准
          button.PageAdminDrivers__action-btn.is-revoke(
            v-if="d.approved"
            @click="ClickRevoke(d.uid)"
          ) 撤銷
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.35);

.PageAdminDrivers {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageAdminDrivers__header {
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

.PageAdminDrivers__summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.PageAdminDrivers__summary-item {
  background: $surface;
  border: 1px solid $border;
  border-radius: 14px;
  padding: 14px 16px;
}

.PageAdminDrivers__summary-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: $muted;
  margin-bottom: 6px;
}

.PageAdminDrivers__summary-val {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  color: #fff;
  line-height: 1;
}

.PageAdminDrivers__toolbar { margin-bottom: 16px; }

.PageAdminDrivers__filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.PageAdminDrivers__filter-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 12px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: $muted;
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.1);
    color: $amber;
  }
}

.PageAdminDrivers__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageAdminDrivers__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.PageAdminDrivers__empty {
  text-align: center;
  padding: 60px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: $muted;
}

.PageAdminDrivers__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageAdminDrivers__card {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  padding: 14px 16px;

  &-top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid $border;
  }

  &-meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  &-actions { display: flex; gap: 8px; }
}

.PageAdminDrivers__avatar-wrap { flex-shrink: 0; }

.PageAdminDrivers__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid rgba($amber, 0.3);
}

.PageAdminDrivers__avatar-fallback {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba($amber, 0.15);
  border: 1.5px solid rgba($amber, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: $amber;
}

.PageAdminDrivers__info { flex: 1; min-width: 0; }

.PageAdminDrivers__name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
}

.PageAdminDrivers__uid {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: $muted;
}

.PageAdminDrivers__status {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 10px;
  border-radius: 100px;
  flex-shrink: 0;

  &.is-approved { background: rgba(80, 200, 120, 0.1); border: 1px solid rgba(80, 200, 120, 0.3); color: #50c878; }
  &.is-pending  { background: rgba(255, 200, 0, 0.1); border: 1px solid rgba(255, 200, 0, 0.3); color: #f5c518; }
}

.PageAdminDrivers__meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.PageAdminDrivers__meta-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $muted;
}

.PageAdminDrivers__meta-val {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
}

.PageAdminDrivers__action-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  border: none;

  &.is-approve {
    background: rgba(80, 200, 120, 0.15);
    border: 1px solid rgba(80, 200, 120, 0.3);
    color: #50c878;
  }

  &.is-revoke {
    background: rgba(255, 80, 80, 0.08);
    border: 1px solid rgba(255, 80, 80, 0.2);
    color: rgba(255, 100, 100, 0.7);
  }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
