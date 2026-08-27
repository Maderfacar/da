<script setup lang="ts">
// PassengerHomePromo — 首頁優惠專區
// 撈生效中折扣碼；無資料 / 載入失敗則整區不顯示（v-if）。

const { t } = useI18n();
const { isSignIn } = storeToRefs(StoreAuth());
const { showToast } = useToast();

interface PromoCode {
  code: string;
  discountAmount: number;
  validUntil: string | null;
  minFare: number | null;
  allowedOrderTypes: string[] | null;
}

const codes = ref<PromoCode[]>([]);
const loaded = ref(false);
const copiedCode = ref<string>('');

const hasPromo = computed(() => loaded.value && codes.value.length > 0);

const _FormatDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = $dayjs(iso);
  return d.isValid() ? d.format('YYYY.MM.DD') : '';
};

const ApiLoadPromo = async () => {
  if (!isSignIn.value) {
    codes.value = [];
    loaded.value = true;
    return;
  }
  try {
    const res = await $api.GetActiveDiscountCodes();
    if (res.status?.code === $enum.apiStatus.success && res.data) {
      codes.value = (res.data.items ?? []) as PromoCode[];
    }
  } catch (err) {
    console.error('[home/promo] load failed:', err);
  } finally {
    loaded.value = true;
  }
};

const ClickCopyCode = async (code: string) => {
  if (!code) return;
  if (!navigator.clipboard?.writeText) {
    showToast(t('homePromo.copyFailed'));
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    copiedCode.value = code;
    showToast(t('homePromo.codeCopied'));
    setTimeout(() => {
      if (copiedCode.value === code) copiedCode.value = '';
    }, 2000);
  } catch {
    showToast(t('homePromo.copyFailed'));
  }
};

watch(isSignIn, () => { ApiLoadPromo(); });

onMounted(() => { ApiLoadPromo(); });
</script>

<template lang="pug">
section.PassengerHomePromo(v-if="hasPromo")
  .PassengerHomePromo__label {{ $t('homePromo.label') }}
  h2.PassengerHomePromo__title {{ $t('homePromo.title') }}
  p.PassengerHomePromo__desc {{ $t('homePromo.desc') }}
  .PassengerHomePromo__list
    .PassengerHomePromo__card(v-for="c in codes" :key="c.code")
      .PassengerHomePromo__card-main
        .PassengerHomePromo__code-label {{ $t('homePromo.codeLabel') }}
        .PassengerHomePromo__code-row
          .PassengerHomePromo__code {{ c.code }}
          button.PassengerHomePromo__copy-btn(
            type="button"
            :class="{ 'is-copied': copiedCode === c.code }"
            :aria-label="$t('homePromo.copyCode')"
            @click="ClickCopyCode(c.code)"
          )
            NuxtIcon.PassengerHomePromo__copy-icon(:name="copiedCode === c.code ? 'mdi:check' : 'mdi:content-copy'")
      .PassengerHomePromo__card-info
        .PassengerHomePromo__amount {{ $t('homePromo.amount', { n: c.discountAmount.toLocaleString() }) }}
        .PassengerHomePromo__meta(v-if="c.minFare")
          | {{ $t('homePromo.minFare', { n: c.minFare.toLocaleString() }) }}
        .PassengerHomePromo__meta(v-if="c.validUntil")
          | {{ $t('homePromo.validUntil', { date: _FormatDate(c.validUntil) }) }}
</template>

<style lang="scss" scoped>

.PassengerHomePromo {
  padding-block: var(--space-section);
  padding-inline: max(var(--gutter), calc((100% - var(--shell)) / 2));
  background: var(--da-cream);
}

.PassengerHomePromo__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    width: 24px;
    height: 1.5px;
    background: var(--da-amber);
  }
}

.PassengerHomePromo__title {
  font-family: var(--ff-display);
  font-size: clamp(42px, 12vw, 56px);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-snug);
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PassengerHomePromo__desc {
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
  margin-bottom: 32px;
  max-width: 320px;
  font-family: var(--ff-ui);
}

.PassengerHomePromo__list {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PassengerHomePromo__card {
  display: flex;
  align-items: stretch;
  background: var(--da-dark);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.PassengerHomePromo__card-main {
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  border-right: 2px dashed var(--surface-a12);
}

.PassengerHomePromo__code-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--surface-a40);
}

.PassengerHomePromo__code-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PassengerHomePromo__code {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-wide);
  color: var(--da-amber-light);
}

.PassengerHomePromo__copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a20);
  background: var(--surface-a06);
  color: var(--da-amber-light);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-a12);
    border-color: var(--surface-a30);
  }
  &:active { transform: scale(0.92); }

  &.is-copied {
    color: var(--good);
    border-color: var(--good-a45);
    background: var(--good-a08);
  }
}

.PassengerHomePromo__copy-icon {
  font-size: var(--fs-body-lg);
  line-height: var(--lh-flat);
}

.PassengerHomePromo__card-info {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.PassengerHomePromo__amount {
  font-family: var(--ff-label);
  font-size: var(--fs-h4);
  font-weight: 700;
  color: var(--da-cream);
}

.PassengerHomePromo__meta {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a50);
}
</style>
