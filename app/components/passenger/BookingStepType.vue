<script setup lang="ts">
import { ORDER_TYPES } from '~shared/pricing';
import type { OrderType } from '~shared/pricing';
import type { FlightInfo } from '@@/api/flight.get';

const { t } = useI18n();

interface Props {
  orderType: OrderType | undefined;
  pickupDateTime: string;
  flightNo: string;
  flightInfo: FlightInfo | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:orderType', val: OrderType): void;
  (e: 'update:pickupDateTime' | 'update:flightNo', val: string): void;
  (e: 'update:flightInfo', val: FlightInfo | null): void;
  (e: 'next'): void;
}>();

const selectedType = ref<OrderType | undefined>(props.orderType);
const dateTime = ref(props.pickupDateTime ?? '');
const flightNoInput = ref(props.flightNo ?? '');

// ── 日期 / 時間 拆兩個下拉（時間以 10 分鐘為單位）─────────────────────────────
// dateTime 為單一事實來源（ISO YYYY-MM-DDTHH:mm:ss）；pickupDate / pickupTime 為 picker 雙向綁定值
const pickupDate = ref(dateTime.value ? $dayjs(dateTime.value).format('YYYY-MM-DD') : '');
const pickupTime = ref(dateTime.value ? $dayjs(dateTime.value).format('HH:mm') : '');

// 任一變動 → 兩者都有值才組合回 ISO；缺一邊 dateTime 清空（讓 canNext 守住下一步）
const _SyncDateTime = () => {
  if (pickupDate.value && pickupTime.value) {
    dateTime.value = `${pickupDate.value}T${pickupTime.value}:00`;
  } else {
    dateTime.value = '';
  }
};
watch(pickupDate, _SyncDateTime);
watch(pickupTime, _SyncDateTime);

// 是否需要航班資訊
const needsFlight = computed(() =>
  selectedType.value === 'airport-pickup' || selectedType.value === 'airport-dropoff',
);

// ── 航班查詢 ──────────────────────────────────────────────────────────────────
const flightLoading = ref(false);
const flightError = ref('');
const localFlightInfo = ref<FlightInfo | null>(props.flightInfo);
/** 是否為「查無航班」錯誤（用來決定是否顯示手動輸入連結；其他類型錯誤不顯示） */
const isFlightNotFound = ref(false);

// ── 手動 fallback（spec 2026-05-12 manual-fallback-ui）─────────────────────────
const manualFallbackOpen = ref(false);
const manualTerminal = ref<'1' | '2' | ''>('');
const manualTime = ref('');
const manualSubmitting = ref(false);
const manualError = ref('');

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 送機 3h 前置驗證（manual 與 API lookup 共用） */
const _validateDropoffTime = (info: FlightInfo): boolean => {
  if (selectedType.value !== 'airport-dropoff' || !dateTime.value) return true;
  const minDeparture = $dayjs(dateTime.value).add(3, 'hour');
  return !$dayjs(info.estimatedTime).isBefore(minDeparture);
};

const _LookupFlight = async (no: string) => {
  const cleaned = no.toUpperCase().replace(/\s/g, '');
  if (cleaned.length < 3) {
    localFlightInfo.value = null;
    flightError.value = '';
    isFlightNotFound.value = false;
    emit('update:flightInfo', null);
    return;
  }
  flightLoading.value = true;
  flightError.value = '';
  isFlightNotFound.value = false;
  try {
    // 必須先選用車時間（Aviation Edge 依 date 查不同排程；
    // 沒帶 date 用今天 fallback 對「未來訂車」情境會誤導）
    if (!dateTime.value) {
      flightLoading.value = false;
      flightError.value = t('booking.type.error.needDateTime');
      emit('update:flightInfo', null);
      return;
    }
    // direction 依 orderType 推：airport-pickup → arrival、airport-dropoff → departure
    const direction = selectedType.value === 'airport-dropoff' ? 'departure' : 'arrival';
    const date = $dayjs(dateTime.value).format('YYYY-MM-DD');
    const res = await $fetch<{ ok: boolean; data?: FlightInfo; message?: string }>(
      `/api/flight?flightNo=${cleaned}&direction=${direction}&date=${date}`,
    );
    if (res.ok && res.data) {
      // 保留原始 flight 資料，方便 watch dateTime 變更時重新驗證
      localFlightInfo.value = res.data;
      // 送機：預計起飛時間必須 >= 用車時間 + 3 小時
      if (!_validateDropoffTime(res.data)) {
        flightError.value = t('booking.type.error.tooSoon', { flight: cleaned });
        emit('update:flightInfo', null); // parent 不能拿 invalid flight 進下一步
        return;
      }
      emit('update:flightInfo', res.data);
    } else {
      localFlightInfo.value = null;
      flightError.value = t('booking.type.error.notFound', { flight: cleaned });
      isFlightNotFound.value = true;
      emit('update:flightInfo', null);
    }
  } catch (err: unknown) {
    localFlightInfo.value = null;
    // 404 (查無此航班) 與 其他錯誤 (網路 / 5xx) 文案分開
    const statusCode = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { statusCode?: number; status?: number })?.status;
    if (statusCode === 404) {
      flightError.value = t('booking.type.error.notFound', { flight: cleaned });
      isFlightNotFound.value = true;
    } else {
      flightError.value = t('booking.type.error.queryFail');
    }
    emit('update:flightInfo', null);
  } finally {
    flightLoading.value = false;
  }
};

// ── 手動 fallback flow ────────────────────────────────────────────────────────
/** 進入手動模式 → 展開 form、預填若干欄位 */
const ClickOpenManual = () => {
  manualFallbackOpen.value = true;
  manualError.value = '';
  // 預填用車時間的 HH:mm（user 可調），但保留空白讓 user 主動確認也合理；先預填便利
  if (dateTime.value && !manualTime.value) {
    manualTime.value = $dayjs(dateTime.value).format('HH:mm');
  }
};

const ClickCancelManual = () => {
  manualFallbackOpen.value = false;
  manualError.value = '';
};

/** 重置手動欄位（切換航班 / 行程類型 / 日期時呼叫） */
const _ResetManualState = () => {
  manualFallbackOpen.value = false;
  manualTerminal.value = '';
  manualTime.value = '';
  manualError.value = '';
  manualSubmitting.value = false;
};

const canSubmitManual = computed(() => {
  if (!flightNoInput.value.trim() || !dateTime.value) return false;
  if (manualTerminal.value !== '1' && manualTerminal.value !== '2') return false;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(manualTime.value)) return false;
  return true;
});

const ClickSubmitManual = async () => {
  if (!canSubmitManual.value || manualSubmitting.value) return;
  manualSubmitting.value = true;
  manualError.value = '';
  try {
    const cleaned = flightNoInput.value.toUpperCase().replace(/\s/g, '');
    const direction = selectedType.value === 'airport-dropoff' ? 'departure' : 'arrival';
    const date = $dayjs(dateTime.value).format('YYYY-MM-DD');

    // 必須帶 Bearer ID token（manual endpoint require-auth）
    const authStore = StoreAuth();
    const idToken = await authStore.GetFreshIdToken();

    const res = await $fetch<{ ok: boolean; data?: FlightInfo; message?: string }>(
      '/api/flight/manual',
      {
        method: 'POST',
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
        body: {
          flightNo: cleaned,
          direction,
          date,
          terminal: manualTerminal.value,
          scheduledTime: manualTime.value,
        },
      },
    );

    if (!res.ok || !res.data) {
      manualError.value = t('booking.type.manual.error.submitFail');
      return;
    }

    // 送機 3h 前置驗證（manual 時間也得守同樣規則）
    if (!_validateDropoffTime(res.data)) {
      manualError.value = t('booking.type.error.tooSoon', { flight: cleaned });
      return;
    }

    // 成功：set flightInfo、收起手動 form、清 flightError、isNotFound
    localFlightInfo.value = res.data;
    emit('update:flightInfo', res.data);
    flightError.value = '';
    isFlightNotFound.value = false;
    manualFallbackOpen.value = false;
  } catch (_err) {
    manualError.value = t('booking.type.manual.error.submitFail');
  } finally {
    manualSubmitting.value = false;
  }
};

watch(flightNoInput, (val) => {
  emit('update:flightNo', val);
  if (_debounceTimer) clearTimeout(_debounceTimer);
  // 換航班 → 重置手動 fallback 狀態（避免舊 form 殘留）
  _ResetManualState();
  isFlightNotFound.value = false;
  if (!val.trim()) {
    localFlightInfo.value = null;
    flightError.value = '';
    emit('update:flightInfo', null);
    return;
  }
  _debounceTimer = setTimeout(() => _LookupFlight(val), 600);
});

// 切換行程類型時清除航班資訊
watch(selectedType, (val) => {
  if (val) emit('update:orderType', val);
  _ResetManualState();
  isFlightNotFound.value = false;
  if (val !== 'airport-pickup' && val !== 'airport-dropoff') {
    flightNoInput.value = '';
    localFlightInfo.value = null;
    flightError.value = '';
    emit('update:flightNo', '');
    emit('update:flightInfo', null);
  }
});

watch(dateTime, (val, oldVal) => {
  emit('update:pickupDateTime', val);
  // 日期變更（YYYY-MM-DD 不同）→ 重新 lookup（API 依 date 查不同排程）
  const newDate = val ? $dayjs(val).format('YYYY-MM-DD') : '';
  const oldDate = oldVal ? $dayjs(oldVal).format('YYYY-MM-DD') : '';
  if (newDate && newDate !== oldDate) {
    // 日期換掉 → 手動 fallback 內容失效（manualSchedules 用 date 當 key）
    _ResetManualState();
    if (flightNoInput.value.trim()) {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => _LookupFlight(flightNoInput.value), 300);
      return; // re-lookup 時 API 結果回來會自己驗證 tooSoon
    }
  }
  // 同日只動小時/分鐘 → 重新驗證已查到的送機航班 3h 前置
  if (selectedType.value === 'airport-dropoff' && localFlightInfo.value && val) {
    if (!_validateDropoffTime(localFlightInfo.value)) {
      flightError.value = t('booking.type.error.tooSoon', { flight: localFlightInfo.value.flightNo });
      emit('update:flightInfo', null);
    } else {
      flightError.value = '';
      emit('update:flightInfo', localFlightInfo.value);
    }
  }
});

// ── 航班狀態標籤 ─────────────────────────────────────────────────────────────
const STATUS_CLS: Record<string, string> = {
  scheduled: 'is-ok',
  active:    'is-ok',
  landed:    'is-ok',
  delayed:   'is-warn',
  cancelled: 'is-error',
};

const statusBadge = computed(() => {
  if (!localFlightInfo.value) return null;
  const s = localFlightInfo.value.status;
  return {
    label: t(`booking.type.flightStatus.${s}`, t('booking.type.flightStatus.unknown')),
    cls:   STATUS_CLS[s] ?? '',
  };
});

const formatTime = (iso: string) =>
  $dayjs(iso).format('HH:mm');

// 時間 label 依 direction 切換：接機 → 預計抵達時間、送機 → 預計起飛時間
const timeLabel = computed(() => {
  if (!localFlightInfo.value) return '';
  return localFlightInfo.value.direction === 'arrival'
    ? t('booking.type.arrivalTime')
    : t('booking.type.departureTime');
});

// 航廈屬於 TPE 那端：接機 → 目的地是 TPE、送機 → 出發地是 TPE
const originTerminal = computed(() =>
  localFlightInfo.value?.direction === 'departure' ? localFlightInfo.value.terminal : '',
);
const destinationTerminal = computed(() =>
  localFlightInfo.value?.direction === 'arrival' ? localFlightInfo.value.terminal : '',
);

const disabledDate = (d: Date) => $dayjs(d).isBefore($dayjs().startOf('day'));

const isPastDateTime = computed(() =>
  !!dateTime.value && $dayjs(dateTime.value).isBefore($dayjs()),
);

const canNext = computed(() => {
  if (!selectedType.value || !dateTime.value) return false;
  if (isPastDateTime.value) return false;
  // 接機：航班必填 → 必須有 flightInfo
  if (selectedType.value === 'airport-pickup' && !localFlightInfo.value) return false;
  // 送機：航班選填 — 沒填 flightNo 直接通過（user 在 step 2 自選下車點）；
  //                   有填則必須驗證成功（避免帶半截 invalid flight 進下一步）
  if (
    selectedType.value === 'airport-dropoff'
    && flightNoInput.value.trim()
    && !localFlightInfo.value
  ) return false;
  return true;
});

const ClickNext = () => {
  if (!canNext.value) return;
  emit('next');
};
</script>

<template lang="pug">
.PassengerBookingStepType
  //- 用車日期與時間（拆兩個下拉，時間以 10 分鐘為單位）
  .PassengerBookingStepType__section-label DATE &amp; TIME
  h2.PassengerBookingStepType__title {{ $t('booking.type.dateTimeTitle') }}

  .PassengerBookingStepType__datetime
    ElDatePicker.PassengerBookingStepType__picker(
      v-model="pickupDate"
      type="date"
      :placeholder="$t('booking.type.dateTimePlaceholder')"
      format="YYYY/MM/DD"
      value-format="YYYY-MM-DD"
      :disabled-date="disabledDate"
      :clearable="false"
      style="flex: 1; min-width: 0"
    )
    ElTimeSelect.PassengerBookingStepType__picker(
      v-model="pickupTime"
      :placeholder="$t('booking.type.manual.timePlaceholder')"
      start="00:00"
      end="23:50"
      step="00:10"
      :clearable="false"
      style="flex: 1; min-width: 0"
    )
  p.PassengerBookingStepType__time-error(v-if="isPastDateTime") {{ $t('booking.type.dateTimeError') }}

  .PassengerBookingStepType__section-label.mt ORDER TYPE
  h2.PassengerBookingStepType__title {{ $t('booking.type.title') }}

  .PassengerBookingStepType__grid
    .PassengerBookingStepType__card(
      v-for="t in ORDER_TYPES"
      :key="t.value"
      :class="{ 'is-active': selectedType === t.value }"
      @click="selectedType = t.value"
    )
      NuxtIcon.PassengerBookingStepType__card-icon(:name="t.icon")
      span.PassengerBookingStepType__card-en {{ t.labelEn }}
      span.PassengerBookingStepType__card-zh {{ t.label }}

  //- 航班號碼輸入（接機 / 送機）
  Transition(name="flight-slide")
    .PassengerBookingStepType__flight(v-if="needsFlight")
      .PassengerBookingStepType__section-label.mt FLIGHT INFO
      h2.PassengerBookingStepType__title {{ $t('booking.type.flightTitle') }}

      .PassengerBookingStepType__flight-input-wrap
        input.PassengerBookingStepType__flight-input(
          v-model="flightNoInput"
          :placeholder="$t('booking.type.flightPlaceholder')"
          maxlength="8"
          autocomplete="off"
          autocapitalize="characters"
        )
        .PassengerBookingStepType__flight-spinner(v-if="flightLoading")

      p.PassengerBookingStepType__flight-error(v-if="flightError")
        | {{ flightError }}
        a.PassengerBookingStepType__manual-link(
          v-if="isFlightNotFound && !manualFallbackOpen"
          @click="ClickOpenManual"
        ) {{ $t('booking.type.manual.linkText') }}

      //- 手動 fallback 表單（spec 2026-05-12 manual-fallback-ui）
      Transition(name="manual-slide")
        .PassengerBookingStepType__manual(v-if="manualFallbackOpen")
          .PassengerBookingStepType__manual-head
            span.PassengerBookingStepType__manual-title {{ $t('booking.type.manual.title') }}
            button.PassengerBookingStepType__manual-close(
              type="button"
              @click="ClickCancelManual"
              :aria-label="$t('booking.type.manual.cancel')"
            )
              NuxtIcon(name="mdi:close")
          p.PassengerBookingStepType__manual-hint {{ $t('booking.type.manual.notice') }}

          .PassengerBookingStepType__manual-row
            label.PassengerBookingStepType__manual-label {{ $t('booking.type.manual.terminalLabel') }}
            .PassengerBookingStepType__manual-terminals
              button.PassengerBookingStepType__manual-terminal(
                type="button"
                :class="{ 'is-active': manualTerminal === '1' }"
                @click="manualTerminal = '1'"
              ) T1
              button.PassengerBookingStepType__manual-terminal(
                type="button"
                :class="{ 'is-active': manualTerminal === '2' }"
                @click="manualTerminal = '2'"
              ) T2

          .PassengerBookingStepType__manual-row
            label.PassengerBookingStepType__manual-label {{ $t('booking.type.manual.timeLabel') }}
            input.PassengerBookingStepType__manual-input(
              v-model="manualTime"
              type="time"
              step="60"
              inputmode="numeric"
              :placeholder="$t('booking.type.manual.timePlaceholder')"
            )

          p.PassengerBookingStepType__manual-error(v-if="manualError") {{ manualError }}

          .PassengerBookingStepType__manual-buttons
            UiButton(
              type="secondary"
              style="flex: 1"
              @click="ClickCancelManual"
            ) {{ $t('booking.type.manual.cancel') }}
            UiButton(
              type="primary"
              style="flex: 1"
              :disabled="!canSubmitManual || manualSubmitting"
              :loading="manualSubmitting"
              @click="ClickSubmitManual"
            ) {{ $t('booking.type.manual.submit') }}

      //- 航班資訊卡片
      Transition(name="card-pop")
        .PassengerBookingStepType__flight-card(v-if="localFlightInfo")
          .PassengerBookingStepType__flight-card-head
            .PassengerBookingStepType__flight-no {{ localFlightInfo.flightNo }}
            .PassengerBookingStepType__flight-airline {{ localFlightInfo.airline.name }}
            .PassengerBookingStepType__flight-badge(:class="statusBadge?.cls") {{ statusBadge?.label }}

          .PassengerBookingStepType__flight-card-body
            .PassengerBookingStepType__flight-row
              span.PassengerBookingStepType__flight-label {{ $t('booking.type.origin') }}
              span.PassengerBookingStepType__flight-val
                | {{ localFlightInfo.origin.cityName }}（{{ localFlightInfo.origin.iataCode }}）
                template(v-if="originTerminal")  · T{{ originTerminal }}
            .PassengerBookingStepType__flight-row
              span.PassengerBookingStepType__flight-label {{ $t('booking.type.destination') }}
              span.PassengerBookingStepType__flight-val
                | {{ localFlightInfo.destination.cityName }}（{{ localFlightInfo.destination.iataCode }}）
                template(v-if="destinationTerminal")  · T{{ destinationTerminal }}
            .PassengerBookingStepType__flight-row
              span.PassengerBookingStepType__flight-label {{ timeLabel }}
              span.PassengerBookingStepType__flight-val {{ formatTime(localFlightInfo.estimatedTime) }}

  UiButton(
    type="primary"
    :disabled="!canNext"
    @click="ClickNext"
    style="margin-top: 28px; width: 100%"
  ) {{ $t('booking.nav.next') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PassengerBookingStepType {
  &__section-label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--da-amber);
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;

    &::before { content: ''; width: 24px; height: 1.5px; background: var(--da-amber); }
    &.mt { margin-top: 28px; }
  }

  &__title {
    font-family: $font-display;
    font-size: 28px;
    color: var(--da-dark);
    margin-bottom: 20px;
    letter-spacing: 0.02em;
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  &__datetime {
    display: flex;
    gap: 10px;
    width: 100%;
  }

  &__card {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 16px;
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s, transform 0.15s;
    user-select: none;

    &:active { transform: scale(0.97); }
    &.is-active { border-color: var(--da-amber); background: var(--da-amber-pale); }
  }

  &__card-icon { font-size: 32px; color: var(--da-amber); }

  &__card-en {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--da-gray);
  }

  &__card-zh {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--da-dark);
  }

  // ── 航班區塊 ──────────────────────────────────────────────────
  &__flight { overflow: hidden; }

  &__flight-input-wrap {
    position: relative;
    margin-bottom: 8px;
  }

  &__flight-input {
    font-family: $font-condensed;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    width: 100%;
    padding: 12px 44px 12px 16px;
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 12px;
    background: var(--da-glass-bg);
    color: var(--da-dark);
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;

    &::placeholder { color: var(--da-gray); font-weight: 400; letter-spacing: 0.05em; }
    &:focus { border-color: var(--da-amber); }
  }

  &__flight-spinner {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    border: 2px solid rgba(212, 134, 10, 0.2);
    border-top-color: var(--da-amber);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  &__time-error {
    font-family: $font-body;
    font-size: 12px;
    color: #e74c3c;
    margin: 6px 0 0;
  }

  &__flight-error {
    font-family: $font-body;
    font-size: 12px;
    color: #e74c3c;
    margin: 0 0 8px;
  }

  // ── 手動 fallback ────────────────────────────────────────────
  &__manual-link {
    display: inline-block;
    margin-left: 8px;
    font-family: $font-condensed;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--da-amber);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;

    &:hover { color: var(--da-amber-dark, #b56a08); }
  }

  &__manual {
    margin-top: 8px;
    margin-bottom: 12px;
    background: var(--da-glass-bg);
    border: 1.5px dashed var(--da-amber);
    border-radius: 16px;
    padding: 16px 14px 14px;
    overflow: hidden;
  }

  &__manual-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  &__manual-title {
    font-family: $font-display;
    font-size: 18px;
    letter-spacing: 0.04em;
    color: var(--da-dark);
  }

  &__manual-close {
    background: transparent;
    border: 0;
    padding: 4px;
    font-size: 18px;
    color: var(--da-gray);
    cursor: pointer;
    line-height: 1;

    &:hover { color: var(--da-dark); }
  }

  &__manual-hint {
    font-family: $font-body;
    font-size: 11px;
    color: var(--da-gray);
    margin: 0 0 12px;
    line-height: 1.5;
  }

  &__manual-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  &__manual-label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--da-gray);
    width: 64px;
    flex-shrink: 0;
  }

  &__manual-terminals {
    display: flex;
    gap: 8px;
    flex: 1;
  }

  &__manual-terminal {
    flex: 1;
    padding: 8px 0;
    font-family: $font-condensed;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.1em;
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 10px;
    color: var(--da-gray);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
    user-select: none;

    &:active { transform: scale(0.97); }
    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
      color: var(--da-amber);
    }
  }

  &__manual-input {
    flex: 1;
    padding: 8px 12px;
    font-family: $font-condensed;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.08em;
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 10px;
    background: var(--da-glass-bg);
    color: var(--da-dark);
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;

    &:focus { border-color: var(--da-amber); }
  }

  &__manual-error {
    font-family: $font-body;
    font-size: 12px;
    color: #e74c3c;
    margin: 4px 0 8px;
  }

  &__manual-buttons {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }

  // ── 航班資訊卡片 ──────────────────────────────────────────────
  &__flight-card {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-amber);
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  &__flight-card-head {
    background: var(--da-amber-pale);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__flight-no {
    font-family: $font-display;
    font-size: 22px;
    color: var(--da-dark);
    letter-spacing: 0.05em;
  }

  &__flight-airline {
    font-family: $font-condensed;
    font-size: 12px;
    font-weight: 700;
    color: var(--da-gray);
    flex: 1;
  }

  &__flight-badge {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 3px 10px;
    border-radius: 100px;

    &.is-ok    { background: rgba(39, 174, 96, 0.12); color: #27ae60; border: 1px solid rgba(39, 174, 96, 0.3); }
    &.is-warn  { background: rgba(230, 126, 34, 0.12); color: #e67e22; border: 1px solid rgba(230, 126, 34, 0.3); }
    &.is-error { background: rgba(231, 76, 60, 0.12);  color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3); }
  }

  &__flight-card-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }

  &__flight-row { display: flex; justify-content: space-between; align-items: center; }

  &__flight-label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--da-gray);
  }

  &__flight-val {
    font-family: $font-body;
    font-size: 14px;
    font-weight: 700;
    color: var(--da-dark);
  }
}

// ── Transitions ──────────────────────────────────────────────
.flight-slide-enter-active,
.flight-slide-leave-active { transition: all 0.3s ease; }
.flight-slide-enter-from,
.flight-slide-leave-to { opacity: 0; transform: translateY(-12px); }

.card-pop-enter-active  { transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
.card-pop-leave-active  { transition: all 0.2s ease; }
.card-pop-enter-from    { opacity: 0; transform: scale(0.92) translateY(8px); }
.card-pop-leave-to      { opacity: 0; transform: scale(0.96); }

.manual-slide-enter-active,
.manual-slide-leave-active { transition: all 0.25s ease; }
.manual-slide-enter-from,
.manual-slide-leave-to { opacity: 0; transform: translateY(-8px); max-height: 0; padding: 0 14px; }

@keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
</style>
