<script setup lang="ts">
import type { AdminUser } from '@/protocol/fetch-api/api/admin';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

// P8-5：三分頁（待審核 / 已核准 / 已拒絕）+ 展開檢視申請資料 + 拒絕 / 解除冷卻
type Tab = 'pending' | 'approved' | 'rejected';
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const loading = ref(false);
const drivers = ref<AdminUser[]>([]);
const activeTab = ref<Tab>('pending');
const expandedUid = ref<string>('');

// 分類規則：
//   approved=true                                    → 已核准
//   approved=false + rejectedAt 在 24h 內             → 已拒絕（冷卻中）
//   approved=false + 無 rejectedAt 或冷卻已過          → 待審核
const isCoolingDown = (d: AdminUser): boolean => {
  const ra = d.driverApplication?.rejectedAt;
  if (!ra) return false;
  return Date.now() - new Date(ra).getTime() < COOLDOWN_MS;
};

const approvedDrivers = computed(() => drivers.value.filter((d) => d.approved));
const rejectedDrivers = computed(() => drivers.value.filter((d) => !d.approved && isCoolingDown(d)));
const pendingDrivers  = computed(() => drivers.value.filter((d) => !d.approved && !isCoolingDown(d)));

const filteredDrivers = computed(() => {
  if (activeTab.value === 'approved') return approvedDrivers.value;
  if (activeTab.value === 'rejected') return rejectedDrivers.value;
  return pendingDrivers.value;
});

const ApiLoadDrivers = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAdminUsers({ role: 'driver' });
    // 防禦：res.data 在 server 失敗時可能是 {} 而非 array（methods.ts FilterRes 預設 data:{}）
    // 直接賦值會讓 filteredDrivers 的 .filter() throw TypeError，導致 spinner 卡住
    drivers.value = Array.isArray(res.data) ? (res.data as AdminUser[]) : [];
  } catch (err) {
    console.error('[admin/drivers] load failed:', err);
    drivers.value = [];
  } finally {
    loading.value = false;
  }
};

const ToggleExpand = (uid: string) => {
  expandedUid.value = expandedUid.value === uid ? '' : uid;
};

// ── 操作：核准 / 拒絕 / 解除冷卻 / 撤銷 ─────────────────
const ClickApprove = async (uid: string) => {
  const res = await $api.PatchAdminUser(uid, { approved: true });
  if (res.status.code === 200) {
    await ApiLoadDrivers();
    ElMessage({ message: '已核准', type: 'success' });
  }
};

const ClickReject = async (uid: string) => {
  // CLAUDE.md 禁用 ElMessageBox.prompt，改用瀏覽器原生 prompt 取得拒絕原因
  const rejectReason = window.prompt('請輸入拒絕原因（將顯示給司機，按取消放棄）') ?? '';
  if (!rejectReason.trim()) return;
  const res = await $api.PatchAdminUser(uid, {
    removeRole: 'driver',
    rejectedAt: new Date().toISOString(),
    rejectReason: rejectReason.trim(),
  });
  if (res.status.code === 200) {
    await ApiLoadDrivers();
    ElMessage({ message: '已拒絕，24h 冷卻啟動', type: 'warning' });
  }
};

const ClickClearCooldown = async (uid: string) => {
  const ok = await UseAsk('解除冷卻後該司機可立即重新申請，確定？');
  if (!ok) return;
  const res = await $api.PatchAdminUser(uid, { rejectedAt: null });
  if (res.status.code === 200) {
    await ApiLoadDrivers();
    ElMessage({ message: '已解除冷卻', type: 'success' });
  }
};

const ClickRevoke = async (uid: string) => {
  const ok = await UseAsk('確定撤銷此司機的存取權？（保留 driver role 但 approved=false）');
  if (!ok) return;
  const res = await $api.PatchAdminUser(uid, { approved: false });
  if (res.status.code === 200) {
    await ApiLoadDrivers();
    ElMessage({ message: '已撤銷', type: 'warning' });
  }
};

// 倒數顯示（每秒更新）
const tick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  ApiLoadDrivers();
  timer = setInterval(() => { tick.value++; }, 1000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const CooldownText = (d: AdminUser): string => {
  void tick.value;
  const ra = d.driverApplication?.rejectedAt;
  if (!ra) return '';
  const remain = COOLDOWN_MS - (Date.now() - new Date(ra).getTime());
  if (remain <= 0) return '已過冷卻期';
  const h = Math.floor(remain / 3600_000);
  const m = Math.floor((remain % 3600_000) / 60_000);
  return `${h}h ${m}m`;
};

const VEHICLE_LABEL: Record<string, string> = {
  sedan: '商務轎車', mpv: '商務 MPV', suv: '商務 SUV', van: '廂型車',
};
const DOC_LABEL: Record<string, string> = {
  licenseUrl: '駕照',
  registrationUrl: '行照',
  insuranceUrl: '保險卡',
  goodCitizenUrl: '良民證',
};
</script>

<template lang="pug">
.PageAdminDrivers
  .PageAdminDrivers__header
    .PageAdminDrivers__header-label DRIVER MANAGEMENT
    h1.PageAdminDrivers__header-title 司機管理

  //- 統計
  .PageAdminDrivers__summary
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label PENDING
      .PageAdminDrivers__summary-val {{ pendingDrivers.length }}
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label APPROVED
      .PageAdminDrivers__summary-val {{ approvedDrivers.length }}
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label COOLDOWN
      .PageAdminDrivers__summary-val {{ rejectedDrivers.length }}

  //- 三分頁
  .PageAdminDrivers__tabs
    button.PageAdminDrivers__tab(
      :class="{ 'is-active': activeTab === 'pending' }"
      @click="activeTab = 'pending'"
    ) 待審核（{{ pendingDrivers.length }}）
    button.PageAdminDrivers__tab(
      :class="{ 'is-active': activeTab === 'approved' }"
      @click="activeTab = 'approved'"
    ) 已核准（{{ approvedDrivers.length }}）
    button.PageAdminDrivers__tab.is-rejected(
      :class="{ 'is-active': activeTab === 'rejected' }"
      @click="activeTab = 'rejected'"
    ) 冷卻中（{{ rejectedDrivers.length }}）

  .PageAdminDrivers__loading(v-if="loading")
    .PageAdminDrivers__spinner

  template(v-else)
    .PageAdminDrivers__empty(v-if="!filteredDrivers.length")
      p {{ activeTab === 'pending' ? '暫無待審核申請' : activeTab === 'approved' ? '暫無核准司機' : '無冷卻中司機' }}

    .PageAdminDrivers__list(v-else)
      .PageAdminDrivers__card(
        v-for="d in filteredDrivers"
        :key="d.uid"
        :class="{ 'is-expanded': expandedUid === d.uid }"
      )
        //- 卡片頭：頭像 + 名稱 + 狀態
        .PageAdminDrivers__card-top(@click="ToggleExpand(d.uid)")
          .PageAdminDrivers__avatar-wrap
            img.PageAdminDrivers__avatar(v-if="d.pictureUrl" :src="d.pictureUrl" :alt="d.displayName")
            .PageAdminDrivers__avatar-fallback(v-else) {{ d.displayName.slice(0, 1) }}
          .PageAdminDrivers__info
            .PageAdminDrivers__name {{ d.displayName }}
            .PageAdminDrivers__uid UID: {{ d.uid.slice(0, 12) }}…
          span.PageAdminDrivers__status(
            :class="d.approved ? 'is-approved' : (isCoolingDown(d) ? 'is-rejected' : 'is-pending')"
          )
            template(v-if="d.approved") 已核准
            template(v-else-if="isCoolingDown(d)") 冷卻 {{ CooldownText(d) }}
            template(v-else) 待審核
          //- P26：每張卡片右上加詳情頁連結（不刪 expand 行為，admin 仍可快速展開檢視）
          NuxtLink.PageAdminDrivers__detail-link(
            :to="`/admin/drivers/${d.uid}`"
            @click.stop
          ) 詳情 →
          .PageAdminDrivers__chevron(:class="{ 'is-up': expandedUid === d.uid }") ▾

        //- 展開區：申請資料 + 證件 + 操作
        .PageAdminDrivers__expand(v-if="expandedUid === d.uid")

          //- 申請資料
          .PageAdminDrivers__expand-section(v-if="d.driverApplication")
            .PageAdminDrivers__expand-title 申請資料
            .PageAdminDrivers__expand-grid
              .PageAdminDrivers__expand-row
                span.PageAdminDrivers__expand-key 司機姓名
                span.PageAdminDrivers__expand-val {{ d.driverApplication.driverName ?? '—' }}
              .PageAdminDrivers__expand-row
                span.PageAdminDrivers__expand-key 聯絡電話
                span.PageAdminDrivers__expand-val {{ d.driverApplication.phone ?? '—' }}
              .PageAdminDrivers__expand-row
                span.PageAdminDrivers__expand-key 車牌號碼
                span.PageAdminDrivers__expand-val {{ d.driverApplication.plateNumber ?? '—' }}
              .PageAdminDrivers__expand-row
                span.PageAdminDrivers__expand-key 車型
                span.PageAdminDrivers__expand-val {{ VEHICLE_LABEL[d.driverApplication.vehicleType ?? ''] ?? '—' }}
              .PageAdminDrivers__expand-row
                span.PageAdminDrivers__expand-key 銀行代號
                span.PageAdminDrivers__expand-val {{ d.driverApplication.bankCode ?? '—' }}
              .PageAdminDrivers__expand-row
                span.PageAdminDrivers__expand-key 銀行帳號
                span.PageAdminDrivers__expand-val {{ d.driverApplication.bankAccount ?? '—' }}
              .PageAdminDrivers__expand-row(v-if="d.driverApplication.appliedAt")
                span.PageAdminDrivers__expand-key 申請時間
                span.PageAdminDrivers__expand-val {{ $dayjs(d.driverApplication.appliedAt).format('YYYY/MM/DD HH:mm') }}

          //- 證件圖片
          .PageAdminDrivers__expand-section(v-if="d.driverApplication?.documents")
            .PageAdminDrivers__expand-title 證件圖片
            .PageAdminDrivers__docs
              template(v-for="(url, key) in d.driverApplication.documents" :key="key")
                a.PageAdminDrivers__doc(
                  v-if="url"
                  :href="url"
                  target="_blank"
                  rel="noopener"
                )
                  img.PageAdminDrivers__doc-img(
                    v-if="!url.toLowerCase().includes('.pdf')"
                    :src="url"
                    :alt="DOC_LABEL[key]"
                  )
                  .PageAdminDrivers__doc-pdf(v-else)
                    span 📄
                    span PDF
                  .PageAdminDrivers__doc-label {{ DOC_LABEL[key] }}

          //- 拒絕原因（冷卻中顯示）
          .PageAdminDrivers__expand-section(v-if="isCoolingDown(d) && d.driverApplication?.rejectReason")
            .PageAdminDrivers__expand-title 拒絕原因
            .PageAdminDrivers__reject-reason {{ d.driverApplication.rejectReason }}

          //- 操作按鈕（依狀態顯示）
          .PageAdminDrivers__actions
            //- 待審核：核准 + 拒絕
            template(v-if="!d.approved && !isCoolingDown(d)")
              button.PageAdminDrivers__action-btn.is-approve(@click="ClickApprove(d.uid)") 核准
              button.PageAdminDrivers__action-btn.is-reject(@click="ClickReject(d.uid)") 拒絕

            //- 已核准：撤銷
            template(v-if="d.approved")
              button.PageAdminDrivers__action-btn.is-revoke(@click="ClickRevoke(d.uid)") 撤銷存取

            //- 冷卻中：解除冷卻 + 核准 + 拒絕
            template(v-if="!d.approved && isCoolingDown(d)")
              button.PageAdminDrivers__action-btn.is-clear(@click="ClickClearCooldown(d.uid)") 解除冷卻
              button.PageAdminDrivers__action-btn.is-approve(@click="ClickApprove(d.uid)") 直接核准
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
  margin-bottom: 16px;
}

@media (max-width: 767.98px) {
  .PageAdminDrivers__summary {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
}

@media (max-width: 479.98px) {
  .PageAdminDrivers__summary {
    grid-template-columns: 1fr;
  }
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

// ── 三分頁 ──────────────────────────────────────────────
.PageAdminDrivers__tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.PageAdminDrivers__tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 6px 14px;
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

  &.is-rejected.is-active {
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
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
  overflow: hidden;
  transition: border-color 0.15s;

  &.is-expanded {
    border-color: rgba($amber, 0.3);
  }
}

.PageAdminDrivers__card-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.02); }
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
  letter-spacing: 0.06em;
  padding: 3px 10px;
  border-radius: 100px;
  flex-shrink: 0;

  &.is-approved { background: rgba(80, 200, 120, 0.1); border: 1px solid rgba(80, 200, 120, 0.3); color: #50c878; }
  &.is-pending  { background: rgba(255, 200, 0, 0.1); border: 1px solid rgba(255, 200, 0, 0.3); color: #f5c518; }
  &.is-rejected { background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.3); color: #f87171; }
}

.PageAdminDrivers__detail-link {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba($amber, 0.1);
  color: $amber;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-decoration: none;
  margin-left: 8px;
  transition: background 0.15s;

  &:hover { background: rgba($amber, 0.2); }
}

.PageAdminDrivers__chevron {
  font-size: 14px;
  color: $muted;
  transition: transform 0.2s;
  margin-left: 4px;

  &.is-up { transform: rotate(180deg); }
}

// ── 展開區 ──────────────────────────────────────────────
.PageAdminDrivers__expand {
  border-top: 1px solid $border;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.PageAdminDrivers__expand-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageAdminDrivers__expand-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: $amber;
}

.PageAdminDrivers__expand-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
}

@media (max-width: 480px) {
  .PageAdminDrivers__expand-grid {
    grid-template-columns: 1fr;
  }
}

.PageAdminDrivers__expand-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: 'Barlow Condensed', sans-serif;
}

.PageAdminDrivers__expand-key {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: $muted;
}

.PageAdminDrivers__expand-val {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  word-break: break-all;
}

.PageAdminDrivers__docs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.PageAdminDrivers__doc {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid $border;
  background: rgba(0, 0, 0, 0.3);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s;

  &:hover { border-color: rgba($amber, 0.5); }
}

.PageAdminDrivers__doc-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.PageAdminDrivers__doc-pdf {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: rgba(255, 255, 255, 0.7);

  span:first-child { font-size: 24px; }
  span:last-child {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 0.12em;
  }
}

.PageAdminDrivers__doc-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

.PageAdminDrivers__reject-reason {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(248, 113, 113, 0.9);
  background: rgba(248, 113, 113, 0.06);
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
}

// ── 操作按鈕 ────────────────────────────────────────────
.PageAdminDrivers__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.PageAdminDrivers__action-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  border: 1px solid;

  &:active { transform: scale(0.98); }
  &:hover { opacity: 0.85; }

  &.is-approve {
    background: rgba(34, 197, 94, 0.14);
    border-color: rgba(34, 197, 94, 0.4);
    color: #4ade80;
  }
  &.is-reject {
    background: rgba(248, 113, 113, 0.12);
    border-color: rgba(248, 113, 113, 0.35);
    color: #f87171;
  }
  &.is-revoke {
    background: rgba(255, 200, 0, 0.08);
    border-color: rgba(255, 200, 0, 0.3);
    color: #f5c518;
  }
  &.is-clear {
    background: rgba(212, 134, 10, 0.14);
    border-color: rgba(212, 134, 10, 0.4);
    color: $amber;
  }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
