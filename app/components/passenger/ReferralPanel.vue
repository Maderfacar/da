<script setup lang="ts">
// PassengerReferralPanel — 歷史訂單頁「我的折扣碼／推薦進度」區塊
// 設計：openspec/changes/2026-05-20-referral-share-reward/design.md §C4 ③
//
// 自抓 /referral/me：顯示 referralCode、邀請進度（pending / rewarded）、未用折扣碼。
import type { ReferralCodeItem } from '@/protocol/fetch-api/api/referral';

const { t } = useI18n();

const loaded = ref(false);
const referralCode = ref('');
const enabled = ref(false);
const progress = ref({ pending: 0, rewarded: 0, total: 0 });
const codes = ref<ReferralCodeItem[]>([]);

// 區塊顯示條件：活動開放、或使用者已有折扣碼 / 推薦紀錄（feature 關閉仍讓既有碼可見）
const showPanel = computed(() =>
  loaded.value
  && !!referralCode.value
  && (enabled.value || codes.value.length > 0 || progress.value.total > 0),
);

const ApiLoadMe = async () => {
  const res = await $api.GetReferralMe();
  if (res.status?.code !== $enum.apiStatus.success) {
    // 載入失敗：靜默不顯示區塊（非關鍵資訊，不打擾訂單頁主流程）
    return;
  }
  referralCode.value = res.data.referralCode ?? '';
  enabled.value = res.data.campaign?.enabled ?? false;
  progress.value = res.data.progress ?? { pending: 0, rewarded: 0, total: 0 };
  codes.value = Array.isArray(res.data.codes) ? res.data.codes : [];
  loaded.value = true;
};

const FormatAmount = (amount: number) => `NT$ ${amount.toLocaleString()}`;
const FormatExpiry = (iso: string | null) =>
  iso ? t('referral.panel.validUntil', { date: $dayjs(iso).format('YYYY/MM/DD') }) : '';
const SourceLabel = (source: ReferralCodeItem['source']) => t(`referral.source.${source}`, '');

const ClickShare = () => navigateTo('/referral/share');

onMounted(ApiLoadMe);
</script>

<template lang="pug">
section.PassengerReferralPanel(v-if="showPanel")
  .PassengerReferralPanel__label MY REWARDS
  h2.PassengerReferralPanel__title {{ $t('referral.panel.title') }}

  //- 我的推薦碼
  .PassengerReferralPanel__code
    .PassengerReferralPanel__code-info
      .PassengerReferralPanel__code-caption {{ $t('referral.panel.myCode') }}
      .PassengerReferralPanel__code-value {{ referralCode }}
    button.PassengerReferralPanel__share(
      v-if="enabled"
      @click="ClickShare"
    ) {{ $t('referral.panel.shareBtn') }}

  //- 邀請進度
  .PassengerReferralPanel__progress
    .PassengerReferralPanel__stat
      .PassengerReferralPanel__stat-num {{ progress.pending }}
      .PassengerReferralPanel__stat-cap {{ $t('referral.panel.pending') }}
    .PassengerReferralPanel__stat
      .PassengerReferralPanel__stat-num {{ progress.rewarded }}
      .PassengerReferralPanel__stat-cap {{ $t('referral.panel.rewarded') }}

  //- 未用折扣碼
  .PassengerReferralPanel__codes
    .PassengerReferralPanel__codes-cap {{ $t('referral.panel.myCoupons') }}
    .PassengerReferralPanel__empty(v-if="codes.length === 0") {{ $t('referral.panel.noCoupons') }}
    ul.PassengerReferralPanel__list(v-else)
      li.PassengerReferralPanel__item(v-for="c in codes" :key="c.code")
        .PassengerReferralPanel__item-main
          span.PassengerReferralPanel__item-code {{ c.code }}
          span.PassengerReferralPanel__item-tag(v-if="SourceLabel(c.source)") {{ SourceLabel(c.source) }}
        .PassengerReferralPanel__item-meta
          span.PassengerReferralPanel__item-amount {{ FormatAmount(c.discountAmount) }}
          span.PassengerReferralPanel__item-expiry {{ FormatExpiry(c.validUntil) }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;

.PassengerReferralPanel {
  margin-bottom: 16px;
}

.PassengerReferralPanel__label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--da-amber);
  margin-bottom: 6px;
}

.PassengerReferralPanel__title {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.04em;
  color: var(--da-dark);
  margin-bottom: 12px;
}

// ── 推薦碼卡（dark accent）─────────────────────────────────
.PassengerReferralPanel__code {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--da-dark);
  border: 1px solid rgba(212, 134, 10, 0.35);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 10px;
  box-shadow: 0 8px 32px rgba(26, 24, 20, 0.18);
}

.PassengerReferralPanel__code-info {
  flex: 1;
  min-width: 0;
}

.PassengerReferralPanel__code-caption {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--da-amber-light);
  margin-bottom: 4px;
}

.PassengerReferralPanel__code-value {
  font-family: $font-display;
  font-size: 30px;
  letter-spacing: 0.16em;
  color: var(--da-cream);
  font-variant-numeric: tabular-nums;
}

.PassengerReferralPanel__share {
  flex-shrink: 0;
  padding: 9px 16px;
  background: #06c755;
  border: 1px solid #06c755;
  border-radius: 100px;
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;

  &:hover { opacity: 0.92; }
  &:active { transform: scale(0.98); }
}

// ── 邀請進度 ──────────────────────────────────────────────
.PassengerReferralPanel__progress {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 10px;
}

.PassengerReferralPanel__stat {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 14px;
  padding: 14px;
  text-align: center;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}

.PassengerReferralPanel__stat-num {
  font-family: $font-display;
  font-size: 32px;
  line-height: 1;
  color: var(--da-amber);
  font-variant-numeric: tabular-nums;
}

.PassengerReferralPanel__stat-cap {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--da-gray);
  margin-top: 4px;
}

// ── 未用折扣碼 ────────────────────────────────────────────
.PassengerReferralPanel__codes {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 16px;
  padding: 14px 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}

.PassengerReferralPanel__codes-cap {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--da-gray);
  margin-bottom: 10px;
}

.PassengerReferralPanel__empty {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: var(--da-gray-light);
  padding: 6px 0;
}

.PassengerReferralPanel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PassengerReferralPanel__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px dashed rgba(212, 134, 10, 0.4);
  border-radius: 12px;
  background: var(--da-amber-pale);
}

.PassengerReferralPanel__item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.PassengerReferralPanel__item-code {
  font-family: $font-display;
  font-size: 18px;
  letter-spacing: 0.08em;
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
}

.PassengerReferralPanel__item-tag {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba(212, 134, 10, 0.16);
  color: var(--da-amber);
  white-space: nowrap;
}

.PassengerReferralPanel__item-meta {
  text-align: right;
  flex-shrink: 0;
}

.PassengerReferralPanel__item-amount {
  display: block;
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  color: var(--da-amber);
}

.PassengerReferralPanel__item-expiry {
  display: block;
  font-family: $font-condensed;
  font-size: 10px;
  color: var(--da-gray);
}
</style>
