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
import { localizedTagName } from '~shared/tagTaxonomy';

interface Props {
  draft: Partial<CreateOrderParams>;
  /** Fare V2：step 3 估價結果（含明細）；尚未估出則為 null */
  fareResult: MapsRouteRes | null;
  isLoading: boolean;
  flightInfo?: FlightInfo | null;
  contactPhone: string;
  /** Booking v2 批次 1：聯絡人姓名（必填） */
  contactName: string;
  /** Booking v2 批次 1：乘車人姓名（同聯絡人時與 contactName 同步） */
  passengerName: string;
  /** Booking v2 批次 1：同聯絡人 checkbox 狀態 */
  sameAsContact: boolean;
  notes: string;
  /** step 3 估出的折扣前車資（折扣預覽用）；尚未估出為 0 */
  fareTotal: number;
  /** Phase 1D：active vehicle tags（呼叫端載入；已 filter vehicleType group） */
  availableTags?: TagDto[];
  /** Phase 1D：當前勾選的偏好 tag id 陣列（Booking v2 起在 Step 3 編輯、Step 4 只讀） */
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
  (
    e: 'update:contactPhone' | 'update:contactName' | 'update:passengerName' | 'update:notes' | 'update:discountCode',
    val: string,
  ): void;
  (e: 'update:sameAsContact', val: boolean): void;
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

// ── 聯絡 / 備註 / 乘車人欄位 ────────────────────────────────────────────────
const PHONE_REGEX = /^09\d{8}$/;
const NOTES_MAX = 200;
const NAME_MAX = 40;

const phoneInput = ref(props.contactPhone ?? '');
const notesInput = ref(props.notes ?? '');
const contactNameInput = ref(props.contactName ?? '');
const passengerNameInput = ref(props.passengerName ?? '');
const sameAsContactInput = ref(props.sameAsContact);

watch(() => props.contactPhone, (v) => {
  if (v !== phoneInput.value) phoneInput.value = v ?? '';
});
watch(() => props.notes, (v) => {
  if (v !== notesInput.value) notesInput.value = v ?? '';
});
watch(() => props.contactName, (v) => {
  if (v !== contactNameInput.value) contactNameInput.value = v ?? '';
});
watch(() => props.passengerName, (v) => {
  if (v !== passengerNameInput.value) passengerNameInput.value = v ?? '';
});
watch(() => props.sameAsContact, (v) => {
  if (v !== sameAsContactInput.value) sameAsContactInput.value = v;
});

const phoneTouched = ref(false);
const contactNameTouched = ref(false);

const phoneValid = computed(() => PHONE_REGEX.test(phoneInput.value));
const phoneErrorMsg = computed(() => {
  if (!phoneTouched.value) return '';
  if (!phoneInput.value) return t('booking.form.contactPhoneRequired');
  if (!phoneValid.value) return t('booking.form.contactPhoneError');
  return '';
});

const contactNameValid = computed(() => contactNameInput.value.trim().length > 0);
const contactNameErrorMsg = computed(() => {
  if (!contactNameTouched.value) return '';
  if (!contactNameValid.value) return t('booking.form.contactNameRequired');
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

const OnContactNameInput = (val: string) => {
  const trimmed = val.slice(0, NAME_MAX);
  contactNameInput.value = trimmed;
  emit('update:contactName', trimmed);
  // 同聯絡人勾選時、即時同步至乘車人欄位
  if (sameAsContactInput.value) {
    passengerNameInput.value = trimmed;
    emit('update:passengerName', trimmed);
  }
};

const OnContactNameBlur = () => {
  contactNameTouched.value = true;
};

const OnPassengerNameInput = (val: string) => {
  const trimmed = val.slice(0, NAME_MAX);
  passengerNameInput.value = trimmed;
  emit('update:passengerName', trimmed);
};

const OnToggleSameAsContact = () => {
  const next = !sameAsContactInput.value;
  sameAsContactInput.value = next;
  emit('update:sameAsContact', next);
  if (next) {
    // 重新勾選：立即同步乘車人 = 聯絡人
    passengerNameInput.value = contactNameInput.value;
    emit('update:passengerName', contactNameInput.value);
  }
  // 取消勾選：保留現有 passengerName，不清空
};

// 訂單摘要顯示用：sameAsContact 勾選時、若 passengerName 為空則 fallback contactName
const summaryPassengerName = computed(() => {
  if (sameAsContactInput.value) return contactNameInput.value;
  return passengerNameInput.value || contactNameInput.value;
});

const canSubmit = computed(() => phoneValid.value && contactNameValid.value && !props.isLoading);

// ── 折扣碼 ───────────────────────────────────────────────────────────────────
const LANG_KEY: Record<string, 'zh_tw' | 'en' | 'ja'> = { zh: 'zh_tw', en: 'en', ja: 'ja' };

const discountInput = ref('');
const discountApplying = ref(false);
const appliedDiscount = ref<{ code: string; amount: number } | null>(null);
const discountError = ref('');

// Phase 1D：偏好標籤 tagSurcharge 計算（Booking v2 起在 Step 3 編輯、Step 4 只負責摘要 + 算總價）
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

const lang = computed<'zh_tw' | 'en' | 'ja'>(() =>
  ({ zh: 'zh_tw', en: 'en', ja: 'ja' } as const)[locale.value as 'zh' | 'en' | 'ja'] ?? 'zh_tw',
);

const selectedTagNames = computed(() => {
  const ids = props.selectedTagIds ?? [];
  if (ids.length === 0) return [];
  return ids
    .map((id) => (props.availableTags ?? []).find((t) => t.id === id))
    .filter((t): t is TagDto => Boolean(t))
    .map((t) => localizedTagName(t, lang.value));
});

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
  contactNameTouched.value = true;
  if (!phoneValid.value || !contactNameValid.value) return;
  emit('submit');
};
</script>

<template lang="pug">
.PassengerBookingStepConfirm
  .PassengerBookingStepConfirm__section-label CONFIRM ORDER
  h2.PassengerBookingStepConfirm__title {{ $t('booking.confirm.title') }}

  //- Booking v2：聯絡 / 乘車資訊（聯絡人 + 乘車人 + 電話 + 備註）
  .PassengerBookingStepConfirm__contact
    .PassengerBookingStepConfirm__contact-label {{ $t('booking.form.contactSection') }}

    .PassengerBookingStepConfirm__field
      label.PassengerBookingStepConfirm__field-label
        | {{ $t('booking.form.contactName') }}
        span.PassengerBookingStepConfirm__field-required *
      ElInput(
        :model-value="contactNameInput"
        maxlength="40"
        :placeholder="$t('booking.form.contactNamePlaceholder')"
        :class="{ 'is-error': contactNameErrorMsg }"
        @update:model-value="OnContactNameInput"
        @blur="OnContactNameBlur"
      )
      .PassengerBookingStepConfirm__field-error(v-if="contactNameErrorMsg") {{ contactNameErrorMsg }}

    .PassengerBookingStepConfirm__field
      label.PassengerBookingStepConfirm__field-label
        | {{ $t('booking.form.passengerName') }}
        span.PassengerBookingStepConfirm__field-required *
      .PassengerBookingStepConfirm__passenger-row
        ElInput(
          :model-value="sameAsContactInput ? contactNameInput : passengerNameInput"
          maxlength="40"
          :placeholder="$t('booking.form.passengerNamePlaceholder')"
          :disabled="sameAsContactInput"
          @update:model-value="OnPassengerNameInput"
        )
        button.PassengerBookingStepConfirm__same-toggle(
          type="button"
          :class="{ 'is-on': sameAsContactInput }"
          @click="OnToggleSameAsContact"
        )
          span.PassengerBookingStepConfirm__same-toggle-box
            NuxtIcon(v-if="sameAsContactInput" name="mdi:check")
          span.PassengerBookingStepConfirm__same-toggle-label {{ $t('booking.form.sameAsContact') }}

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

  //- 訂單摘要
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
    //- Booking v2 批次 2：人數摘要拆「大人 X / 兒童 Y」（child=0 fallback 顯示總人數）
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.passengers') }}
      span.PassengerBookingStepConfirm__row-value(v-if="(draft.childCount ?? 0) > 0")
        | {{ $t('booking.confirm.adultUnit', { n: draft.adultCount ?? 0 }) }}
        | ／
        | {{ $t('booking.confirm.childUnit', { n: draft.childCount ?? 0 }) }}
      span.PassengerBookingStepConfirm__row-value(v-else)
        | {{ $t('booking.confirm.passengerUnit', { n: draft.adultCount ?? draft.passengerCount ?? 0 }) }}
    .PassengerBookingStepConfirm__row(v-if="luggageDetails.length")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.luggage') }}
      span.PassengerBookingStepConfirm__row-value.PassengerBookingStepConfirm__row-value--multi
        | {{ luggageDetails.join('、') }}
        | （{{ totalSU }} SU）
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.vehicle') }}
      span.PassengerBookingStepConfirm__row-value {{ vehicleLabel }}
    //- Booking v2：期望特徵 chip 摘要（移自 Step 3）
    .PassengerBookingStepConfirm__row(v-if="selectedTagNames.length")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.preferences.summary') }}
      .PassengerBookingStepConfirm__tag-chips
        span.PassengerBookingStepConfirm__tag-chip(v-for="name in selectedTagNames" :key="name") {{ name }}
    .PassengerBookingStepConfirm__divider
    //- Booking v2：聯絡人 / 乘車人 / 電話 / 備註摘要
    .PassengerBookingStepConfirm__row(v-if="contactNameInput")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.contactName') }}
      span.PassengerBookingStepConfirm__row-value {{ contactNameInput }}
    .PassengerBookingStepConfirm__row(v-if="summaryPassengerName")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.passengerName') }}
      span.PassengerBookingStepConfirm__row-value {{ summaryPassengerName }}
    .PassengerBookingStepConfirm__row(v-if="phoneInput")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.contactPhone') }}
      span.PassengerBookingStepConfirm__row-value {{ phoneInput }}
    .PassengerBookingStepConfirm__row(v-if="notesInput")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.notes') }}
      span.PassengerBookingStepConfirm__row-value.PassengerBookingStepConfirm__row-value--multi {{ notesInput }}

  //- Booking v2：總價只顯一行「應付車資 NT$ X」（不再拆距離 / 時間 / 折扣 / tagSurcharge）
  .PassengerBookingStepConfirm__final
    span.PassengerBookingStepConfirm__final-label {{ $t('booking.confirm.finalFare') }}
    span.PassengerBookingStepConfirm__final-value NT$ {{ fareAfterDiscount }}

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

  // ── 聯絡資訊區 ───────────────────────────────────────────────────────────
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

  // ── Booking v2：乘車人欄位 + 同聯絡人 checkbox ──────────────────────────
  &__passenger-row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;

    .el-input { flex: 1; min-width: 180px; }
  }

  &__same-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 100px;
    border: 1px solid var(--da-gray-pale);
    background: transparent;
    cursor: pointer;
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: var(--da-gray);
    transition: all 0.15s;

    &:hover { border-color: var(--da-amber); color: var(--da-amber); }

    &.is-on {
      background: var(--da-amber-pale);
      border-color: var(--da-amber);
      color: var(--da-amber);
      font-weight: 700;
    }
  }

  &__same-toggle-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1.5px solid currentColor;
    font-size: 12px;

    .nuxt-icon { font-size: 12px; }
  }

  &__same-toggle-label { line-height: 1; }

  &__discount-row {
    display: flex;
    gap: 8px;

    .el-input { flex: 1; }
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

  &__tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }

  &__tag-chip {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 100px;
    background: var(--da-amber-pale);
    border: 1px solid var(--da-amber);
    color: var(--da-amber);
  }

  &__divider {
    height: 1px;
    background: var(--da-gray-pale);
  }

  // ── Booking v2：單行總價 ────────────────────────────────────────────────
  &__final {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 22px;
    background: var(--da-dark);
    border-radius: 16px;
  }

  &__final-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--da-gray-light);
  }

  &__final-value {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 32px;
    color: var(--da-amber-light);
    letter-spacing: 0.04em;
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
