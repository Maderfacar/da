<script setup lang="ts">
import {
  ORDER_TYPES,
  buildTagSurchargeIndex,
  calcTagSurcharge,
  type TagSurchargeIndexEntry,
} from '~shared/pricing';
import type { FlightInfo } from '@@/api/flight.get';
import type { MapsRouteRes } from '~/protocol/fetch-api/api/maps';
import type { TagDto } from '@/protocol/fetch-api/api/tag';

interface Props {
  draft: Partial<CreateOrderParams>;
  distanceKm: number;
  durationMinutes: number;
  /** Fare V2：step 3 估價結果（含明細）；尚未估出則為 null */
  fareResult: MapsRouteRes | null;
  isLoading: boolean;
  flightInfo?: FlightInfo | null;
  contactPhone: string;
  notes: string;
  /** step 3 估出的折扣前車資（折扣預覽用）；尚未估出為 0 */
  fareTotal: number;
  /** Phase 1D：active vehicle tags（呼叫端載入） */
  availableTags?: TagDto[];
  /** Phase 1D：當前勾選的偏好 tag id 陣列 */
  selectedTagIds?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  flightInfo: null,
  availableTags: () => [] as TagDto[],
  selectedTagIds: () => [] as string[],
});

const { t, locale } = useI18n();
const emit = defineEmits<{
  (e: 'submit' | 'back'): void;
  (e: 'update:contactPhone' | 'update:notes' | 'update:discountCode', val: string): void;
  (e: 'update:selectedTagIds', val: string[]): void;
}>();

const storeConfig = StoreConfig();

const Loc = (label: { zh: string; en: string; ja: string } | undefined) =>
  storeConfig.LabelOf(label, locale.value as 'zh' | 'en' | 'ja');

const orderTypeLabel = computed(() =>
  ORDER_TYPES.find((t) => t.value === props.draft.orderType)?.label ?? '',
);

const vehicleLabel = computed(() => {
  if (!props.draft.vehicleType) return '';
  return Loc(storeConfig.GetVehicle(props.draft.vehicleType)?.label);
});

const extraLabels = computed(() =>
  (props.draft.extraServices ?? [])
    .map((id) => Loc(storeConfig.GetExtra(id)?.label))
    .filter((s) => s)
    .join(t('booking.confirm.extrasSep')),
);

// P23：行李改 luggageItems 明細顯示
const luggageDetails = computed(() => {
  const items = props.draft.luggageItems ?? [];
  return items
    .map((item) => {
      const lt = storeConfig.GetLuggageType(item.typeId);
      if (!lt) return '';
      return `${Loc(lt.label)} × ${item.count}`;
    })
    .filter((s) => s);
});

const totalSU = computed(() =>
  (props.draft.luggageItems ?? []).reduce((sum, item) => {
    const lt = storeConfig.GetLuggageType(item.typeId);
    return sum + (lt?.su ?? 0) * item.count;
  }, 0),
);

const formattedDateTime = computed(() => {
  if (!props.draft.pickupDateTime) return '';
  return $dayjs(props.draft.pickupDateTime).format('YYYY/MM/DD HH:mm');
});

// ── P20 聯絡資訊欄位 ─────────────────────────────────────────────────────────
const PHONE_REGEX = /^09\d{8}$/;
const NOTES_MAX = 200;

const phoneInput = ref(props.contactPhone ?? '');
const notesInput = ref(props.notes ?? '');

watch(() => props.contactPhone, (v) => {
  if (v !== phoneInput.value) phoneInput.value = v ?? '';
});
watch(() => props.notes, (v) => {
  if (v !== notesInput.value) notesInput.value = v ?? '';
});

const phoneTouched = ref(false);

const phoneValid = computed(() => PHONE_REGEX.test(phoneInput.value));
const phoneErrorMsg = computed(() => {
  if (!phoneTouched.value) return '';
  if (!phoneInput.value) return t('booking.form.contactPhoneRequired');
  if (!phoneValid.value) return t('booking.form.contactPhoneError');
  return '';
});

const OnPhoneInput = (val: string) => {
  // 只保留數字，最多 10 碼
  const cleaned = val.replace(/\D/g, '').slice(0, 10);
  phoneInput.value = cleaned;
  emit('update:contactPhone', cleaned);
};

const OnPhoneBlur = () => {
  phoneTouched.value = true;
};

const OnNotesInput = (val: string) => {
  const trimmed = val.slice(0, NOTES_MAX);
  notesInput.value = trimmed;
  emit('update:notes', trimmed);
};

const canSubmit = computed(() => phoneValid.value && !props.isLoading);

// ── 折扣碼 ───────────────────────────────────────────────────────────────────
const LANG_KEY: Record<string, 'zh_tw' | 'en' | 'ja'> = { zh: 'zh_tw', en: 'en', ja: 'ja' };

const discountInput = ref('');
const discountApplying = ref(false);
const appliedDiscount = ref<{ code: string; amount: number } | null>(null);
const discountError = ref('');

// Phase 1D：偏好標籤 — 摺疊狀態 + tagSurcharge 計算
const preferencesOpen = ref(false);

const tagSurchargeIndex = computed(() =>
  buildTagSurchargeIndex(
    (props.availableTags ?? []).map((t): TagSurchargeIndexEntry => ({
      id: t.id,
      group: t.group,
      scope: t.scope,
      surchargeAmount: t.surchargeAmount,
      status: t.status,
    })),
  ),
);

const tagSurcharge = computed(() =>
  calcTagSurcharge(props.selectedTagIds ?? [], tagSurchargeIndex.value).surcharge,
);

const HandleUpdateTags = (next: string[]) => {
  emit('update:selectedTagIds', next);
};

const ClickTogglePreferences = () => {
  preferencesOpen.value = !preferencesOpen.value;
};

// 最終價：fareTotal + tagSurcharge - discount（保證 >= 0）
const fareAfterDiscount = computed(() =>
  Math.max(0, props.fareTotal + tagSurcharge.value - (appliedDiscount.value?.amount ?? 0)),
);

const ApiApplyDiscount = async () => {
  const code = discountInput.value.trim();
  if (!code) {
    discountError.value = t('booking.discount.emptyCode');
    return;
  }
  if (!props.fareTotal || props.fareTotal <= 0) {
    discountError.value = t('booking.discount.noFare');
    return;
  }
  if (!props.draft.orderType) return;
  discountApplying.value = true;
  discountError.value = '';
  try {
    const res = await $api.ValidateDiscountCode({
      code,
      fare: props.fareTotal,
      orderType: props.draft.orderType,
    });
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      discountError.value = res.status?.message?.zh_tw ?? t('booking.discount.applyFail');
      return;
    }
    if (!res.data.valid) {
      const langKey = LANG_KEY[locale.value] ?? 'zh_tw';
      discountError.value = res.data.reason?.[langKey] ?? t('booking.discount.applyFail');
      return;
    }
    appliedDiscount.value = { code: code.toUpperCase(), amount: res.data.discountAmount };
    emit('update:discountCode', code.toUpperCase());
  } finally {
    discountApplying.value = false;
  }
};

const ClickClearDiscount = () => {
  appliedDiscount.value = null;
  discountInput.value = '';
  discountError.value = '';
  emit('update:discountCode', '');
};

const ClickSubmit = () => {
  phoneTouched.value = true;
  if (!phoneValid.value) return;
  emit('submit');
};
</script>

<template lang="pug">
.PassengerBookingStepConfirm
  .PassengerBookingStepConfirm__section-label CONFIRM ORDER
  h2.PassengerBookingStepConfirm__title {{ $t('booking.confirm.title') }}

  //- P20：聯絡資訊（必填 + 備註）
  .PassengerBookingStepConfirm__contact
    .PassengerBookingStepConfirm__contact-label {{ $t('booking.form.contactSection') }}

    .PassengerBookingStepConfirm__field
      label.PassengerBookingStepConfirm__field-label
        | {{ $t('booking.form.contactPhone') }}
        span.PassengerBookingStepConfirm__field-required *
      ElInput(
        :model-value="phoneInput"
        type="tel"
        inputmode="numeric"
        maxlength="10"
        :placeholder="$t('booking.form.contactPhonePlaceholder')"
        :class="{ 'is-error': phoneErrorMsg }"
        @update:model-value="OnPhoneInput"
        @blur="OnPhoneBlur"
      )
      .PassengerBookingStepConfirm__field-error(v-if="phoneErrorMsg") {{ phoneErrorMsg }}

    .PassengerBookingStepConfirm__field
      label.PassengerBookingStepConfirm__field-label
        | {{ $t('booking.form.notes') }}
        span.PassengerBookingStepConfirm__field-optional ({{ $t('booking.form.notesOptional') }})
      ElInput(
        :model-value="notesInput"
        type="textarea"
        :rows="3"
        :maxlength="NOTES_MAX"
        :placeholder="$t('booking.form.notesPlaceholder')"
        show-word-limit
        @update:model-value="OnNotesInput"
      )

  //- Phase 1D：偏好標籤（摺疊，可選）
  .PassengerBookingStepConfirm__contact(v-if="availableTags.length")
    .PassengerBookingStepConfirm__contact-label {{ $t('booking.preferences.title') }}
    button.PassengerBookingStepConfirm__pref-toggle(
      type="button"
      :class="{ 'is-open': preferencesOpen }"
      @click="ClickTogglePreferences"
    )
      span.PassengerBookingStepConfirm__pref-toggle-icon {{ preferencesOpen ? '−' : '+' }}
      span.PassengerBookingStepConfirm__pref-toggle-label
        | {{ preferencesOpen ? $t('booking.preferences.collapse') : $t('booking.preferences.expand') }}
      span.PassengerBookingStepConfirm__pref-toggle-count(v-if="selectedTagIds.length")
        | {{ $t('booking.preferences.selectedCount', { count: selectedTagIds.length }) }}
    .PassengerBookingStepConfirm__pref-hint(v-if="preferencesOpen") {{ $t('booking.preferences.hint') }}
    BookingPassengerTagPreferencePicker(
      v-if="preferencesOpen"
      :tags="availableTags"
      :model-value="selectedTagIds"
      :disabled="isLoading"
      @update:model-value="HandleUpdateTags"
    )
    .PassengerBookingStepConfirm__pref-detail(v-if="preferencesOpen && tagSurcharge > 0")
      | {{ $t('booking.preferences.surchargeDetail') }}

  //- 折扣碼
  .PassengerBookingStepConfirm__contact
    .PassengerBookingStepConfirm__contact-label {{ $t('booking.discount.section') }}
    template(v-if="!appliedDiscount")
      .PassengerBookingStepConfirm__discount-row
        ElInput(
          v-model="discountInput"
          maxlength="32"
          :placeholder="$t('booking.discount.placeholder')"
        )
        UiButton(
          type="secondary"
          :loading="discountApplying"
          @click="ApiApplyDiscount"
        ) {{ $t('booking.discount.apply') }}
      .PassengerBookingStepConfirm__field-error(v-if="discountError") {{ discountError }}
    .PassengerBookingStepConfirm__discount-applied(v-else)
      span.PassengerBookingStepConfirm__discount-ok
        | {{ $t('booking.discount.applied', { code: appliedDiscount.code }) }} −NT${{ appliedDiscount.amount }}
      button.PassengerBookingStepConfirm__discount-clear(@click="ClickClearDiscount")
        | {{ $t('booking.discount.clear') }}

  .PassengerBookingStepConfirm__card
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.orderType') }}
      span.PassengerBookingStepConfirm__row-value {{ orderTypeLabel }}
    .PassengerBookingStepConfirm__row(v-if="flightInfo")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.flightNo') }}
      span.PassengerBookingStepConfirm__row-value {{ flightInfo.flightNo }} · T{{ flightInfo.terminal }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.pickupTime') }}
      span.PassengerBookingStepConfirm__row-value {{ formattedDateTime }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.pickup') }}
      span.PassengerBookingStepConfirm__row-value {{ draft.pickupLocation?.displayName ?? draft.pickupLocation?.address }}
    .PassengerBookingStepConfirm__row(v-if="draft.stopovers?.length")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.stopover') }}
      span.PassengerBookingStepConfirm__row-value {{ draft.stopovers.map(s => s.displayName ?? s.address).join(' → ') }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.dropoff') }}
      span.PassengerBookingStepConfirm__row-value {{ draft.dropoffLocation?.displayName ?? draft.dropoffLocation?.address }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.passengers') }}
      span.PassengerBookingStepConfirm__row-value {{ $t('booking.confirm.passengerUnit', { n: draft.passengerCount }) }}
    .PassengerBookingStepConfirm__row(v-if="luggageDetails.length")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.luggage') }}
      span.PassengerBookingStepConfirm__row-value.PassengerBookingStepConfirm__row-value--multi
        | {{ luggageDetails.join('、') }}
        | （{{ totalSU }} SU）
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.vehicle') }}
      span.PassengerBookingStepConfirm__row-value {{ vehicleLabel }}
    .PassengerBookingStepConfirm__row(v-if="extraLabels")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.extras') }}
      span.PassengerBookingStepConfirm__row-value {{ extraLabels }}
    .PassengerBookingStepConfirm__row(v-if="phoneInput")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.contactPhone') }}
      span.PassengerBookingStepConfirm__row-value {{ phoneInput }}
    .PassengerBookingStepConfirm__row(v-if="notesInput")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.notes') }}
      span.PassengerBookingStepConfirm__row-value.PassengerBookingStepConfirm__row-value--multi {{ notesInput }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.distance') }}
      span.PassengerBookingStepConfirm__row-value {{ distanceKm }} km
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.durationLabel') }}
      span.PassengerBookingStepConfirm__row-value {{ $t('booking.confirm.durationVal', { min: durationMinutes }) }}
    //- Phase 1D：偏好標籤加價行（只在 > 0 時顯示）
    template(v-if="tagSurcharge > 0")
      .PassengerBookingStepConfirm__divider
      .PassengerBookingStepConfirm__row
        span.PassengerBookingStepConfirm__row-label {{ $t('booking.preferences.surchargeRow') }}
        span.PassengerBookingStepConfirm__row-value +NT${{ tagSurcharge }}

    template(v-if="appliedDiscount || tagSurcharge > 0")
      .PassengerBookingStepConfirm__divider
      .PassengerBookingStepConfirm__row(v-if="appliedDiscount")
        span.PassengerBookingStepConfirm__row-label {{ $t('booking.discount.discountRow') }}
        span.PassengerBookingStepConfirm__row-value −NT${{ appliedDiscount.amount }}
      .PassengerBookingStepConfirm__row
        span.PassengerBookingStepConfirm__row-label {{ $t('booking.discount.finalTotal') }}
        span.PassengerBookingStepConfirm__row-value NT${{ fareAfterDiscount }}

  PassengerFareBreakdownCard(
    :fare-total="fareResult ? fareAfterDiscount : null"
  )
  .PassengerBookingStepConfirm__cash-note {{ $t('booking.confirm.cashNote') }}

  .PassengerBookingStepConfirm__notice
    NuxtIcon(name="mdi:information-outline")
    span {{ $t('booking.confirm.notice') }}

  .PassengerBookingStepConfirm__actions
    UiButton(type="secondary" :disabled="isLoading" @click="$emit('back')") {{ $t('booking.confirm.back') }}
    UiButton(type="primary" :loading="isLoading" :disabled="!canSubmit" @click="ClickSubmit") {{ $t('booking.confirm.submit') }}
</template>

<style lang="scss" scoped>
.PassengerBookingStepConfirm {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__section-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--da-amber);
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

  &__title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    color: var(--da-dark);
    letter-spacing: 0.02em;
    margin-top: -8px;
  }

  // ── P20 聯絡資訊區 ───────────────────────────────────────────────────────
  &__contact {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-glass-border);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    backdrop-filter: blur(12px);
  }

  &__contact-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--da-amber);
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__field-label {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    color: var(--da-dark);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__field-required {
    color: #ef4444;
    font-weight: 700;
  }

  &__field-optional {
    color: var(--da-gray-light);
    font-size: 12px;
  }

  &__field-error {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: #ef4444;
    margin-top: 2px;
  }

  &__discount-row {
    display: flex;
    gap: 8px;

    .el-input { flex: 1; }
  }

  // Phase 1D：偏好標籤摺疊
  &__pref-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 100px;
    border: 1px solid var(--da-amber);
    background: transparent;
    color: var(--da-amber);
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    align-self: flex-start;

    &:hover { background: var(--da-amber-pale); }
    &.is-open { background: var(--da-amber-pale); }
  }

  &__pref-toggle-icon {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 16px;
    line-height: 1;
  }

  &__pref-toggle-count {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    background: var(--da-amber);
    color: #fff;
    padding: 1px 8px;
    border-radius: 100px;
  }

  &__pref-hint {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: var(--da-gray);
    line-height: 1.6;
  }

  &__pref-detail {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 11px;
    color: var(--da-gray);
    background: var(--da-amber-pale);
    border: 1px dashed var(--da-amber);
    border-radius: 8px;
    padding: 8px 12px;
    line-height: 1.5;
  }

  &__discount-applied {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  &__discount-ok {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    color: #16a34a;
    font-weight: 600;
  }

  &__discount-clear {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: var(--da-gray);
    background: none;
    border: none;
    text-decoration: underline;
    cursor: pointer;
  }

  :deep(.el-input.is-error .el-input__wrapper) {
    box-shadow: 0 0 0 1px #ef4444 inset;
  }

  &__card {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-glass-border);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    backdrop-filter: blur(12px);
  }

  &__row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-family: 'Barlow', 'Noto Sans TC', sans-serif;
    font-size: 14px;
  }

  &__row-label {
    color: var(--da-gray);
    flex-shrink: 0;
    min-width: 72px;
  }

  &__row-value {
    color: var(--da-dark);
    font-weight: 500;
    text-align: right;
  }

  &__row-value--multi {
    white-space: pre-wrap;
    word-break: break-word;
  }

  &__divider {
    height: 1px;
    background: var(--da-gray-pale);
  }

  &__cash-note {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: var(--da-gray);
    letter-spacing: 0.03em;
    margin-top: -8px;
    padding-left: 4px;
  }

  &__notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 12px;
    color: var(--da-gray);
    font-family: 'Noto Sans TC', sans-serif;
    line-height: 1.6;

    .nuxt-icon { flex-shrink: 0; margin-top: 1px; color: var(--da-gray-light); }
  }

  &__actions {
    display: flex;
    gap: 12px;
  }
}
</style>
