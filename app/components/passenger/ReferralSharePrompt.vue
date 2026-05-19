<script setup lang="ts">
// PassengerReferralSharePrompt — 完成行程後的「分享提示卡」
// 設計：openspec/changes/2026-05-20-referral-share-reward/design.md §C4 ② / §8
//
// 由訂單詳情頁在訂單 completed 時掛載；自抓 /referral/me 確認活動 enabled，
// 活動未開放或無 referralCode 則不顯示（§8）。
const loaded = ref(false);
const enabled = ref(false);
const referralCode = ref('');
const welcomeAmount = ref(0);
const rewardAmount = ref(0);

const showPrompt = computed(() => loaded.value && enabled.value && !!referralCode.value);

const ApiLoadMe = async () => {
  const res = await $api.GetReferralMe();
  if (res.status?.code !== $enum.apiStatus.success) return;
  enabled.value = res.data.campaign?.enabled ?? false;
  referralCode.value = res.data.referralCode ?? '';
  welcomeAmount.value = res.data.campaign?.welcomeAmount ?? 0;
  rewardAmount.value = res.data.campaign?.rewardAmount ?? 0;
  loaded.value = true;
};

const ClickShare = () => navigateTo('/referral/share');

onMounted(ApiLoadMe);
</script>

<template lang="pug">
section.PassengerReferralSharePrompt(v-if="showPrompt")
  .PassengerReferralSharePrompt__icon 🎁
  .PassengerReferralSharePrompt__body
    .PassengerReferralSharePrompt__title {{ $t('referral.prompt.title') }}
    p.PassengerReferralSharePrompt__text
      | {{ $t('referral.prompt.body', { welcome: welcomeAmount, reward: rewardAmount }) }}
  button.PassengerReferralSharePrompt__btn(@click="ClickShare") {{ $t('referral.prompt.btn') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;

.PassengerReferralSharePrompt {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--da-dark);
  border: 1px solid rgba(212, 134, 10, 0.35);
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 14px;
  box-shadow: 0 8px 32px rgba(26, 24, 20, 0.18);
}

.PassengerReferralSharePrompt__icon {
  font-size: 30px;
  flex-shrink: 0;
}

.PassengerReferralSharePrompt__body {
  flex: 1;
  min-width: 0;
}

.PassengerReferralSharePrompt__title {
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--da-cream);
}

.PassengerReferralSharePrompt__text {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(245, 242, 236, 0.7);
  margin-top: 3px;
}

.PassengerReferralSharePrompt__btn {
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
</style>
