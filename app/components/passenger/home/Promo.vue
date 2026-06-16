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
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

.PassengerHomePromo {
  padding: 72px 24px;
  background: var(--da-cream);
}

.PassengerHomePromo__label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
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
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 8px;
}

.PassengerHomePromo__desc {
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin-bottom: 32px;
  max-width: 320px;
  font-family: $font-body;
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
  border-radius: 16px;
  overflow: hidden;
}

.PassengerHomePromo__card-main {
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  border-right: 2px dashed rgba(255, 255, 255, 0.15);
}

.PassengerHomePromo__code-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
}

.PassengerHomePromo__code-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PassengerHomePromo__code {
  font-family: $font-display;
  font-size: 26px;
  letter-spacing: 0.08em;
  color: var(--da-amber-light);
}

.PassengerHomePromo__copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: var(--da-amber-light);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s, color 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.3);
  }
  &:active { transform: scale(0.92); }

  &.is-copied {
    color: #6ee7a8;
    border-color: rgba(110, 231, 168, 0.5);
    background: rgba(110, 231, 168, 0.08);
  }
}

.PassengerHomePromo__copy-icon {
  font-size: 16px;
  line-height: 1;
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
  font-family: $font-condensed;
  font-size: 18px;
  font-weight: 700;
  color: var(--da-cream);
}

.PassengerHomePromo__meta {
  font-family: $font-body;
  font-size: 12px;
  color: rgba(250, 248, 244, 0.5);
}
</style>
