<script setup lang="ts">
// PassengerHistorySupport — 歷史訂單頁「客服資訊」（原 /profile P35 section）
const config = useRuntimeConfig().public;
const lineOaUrl = config.lineOaAddUrl as string;
const customerServicePhone = config.customerServicePhone as string;
const customerServiceHours = config.customerServiceHours as string;

// 撥號連結（tel:）— 把 +886 ( ) - 空白都去掉
const phoneTelLink = computed(() => {
  if (!customerServicePhone) return '';
  return `tel:${customerServicePhone.replace(/[^\d+]/g, '')}`;
});
</script>

<template lang="pug">
section.PassengerHistorySupport
  .PassengerHistorySupport__label SUPPORT
  h2.PassengerHistorySupport__title 客服資訊

  .PassengerHistorySupport__list
    //- LINE OA（一定顯示，是最主要聯絡管道）
    a.PassengerHistorySupport__row(
      v-if="lineOaUrl"
      :href="lineOaUrl"
      target="_blank"
      rel="noopener"
    )
      .PassengerHistorySupport__icon 💬
      .PassengerHistorySupport__body
        .PassengerHistorySupport__row-label LINE OFFICIAL
        .PassengerHistorySupport__row-val 透過 LINE 官方帳號聯繫
      .PassengerHistorySupport__arrow ›

    //- 客服電話（env 有設才顯示）
    a.PassengerHistorySupport__row(
      v-if="customerServicePhone"
      :href="phoneTelLink"
    )
      .PassengerHistorySupport__icon 📞
      .PassengerHistorySupport__body
        .PassengerHistorySupport__row-label PHONE
        .PassengerHistorySupport__row-val {{ customerServicePhone }}
        .PassengerHistorySupport__row-sub(v-if="customerServiceHours") {{ customerServiceHours }}
      .PassengerHistorySupport__arrow ›
</template>

<style lang="scss" scoped>

.PassengerHistorySupport {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: 18px 16px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-soft);
}

.PassengerHistorySupport__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--da-amber);
  margin-bottom: 6px;
}

.PassengerHistorySupport__title {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--da-dark);
  margin-bottom: 14px;
}

.PassengerHistorySupport__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PassengerHistorySupport__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--surface-a50);
  border: 1px solid var(--da-gray-pale);
  border-radius: var(--r-md);
  color: inherit;
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-a82);
    border-color: var(--accent-a30);
  }
}

.PassengerHistorySupport__icon {
  font-size: var(--fs-h2);
  flex-shrink: 0;
}

.PassengerHistorySupport__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.PassengerHistorySupport__row-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  color: var(--da-amber);
}

.PassengerHistorySupport__row-val {
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  color: var(--da-dark);
  letter-spacing: var(--ls-label);
}

.PassengerHistorySupport__row-sub {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--da-gray);
}

.PassengerHistorySupport__arrow {
  font-size: var(--fs-h3);
  color: var(--da-gray-light);
  flex-shrink: 0;
}
</style>
