<script setup lang="ts">
import { ORDER_TYPES } from '~shared/pricing';
import type { AdminOrderLuggageItem, CreateAdminOrderBody } from '@/protocol/fetch-api/api/admin';

interface Props {
  modelValue: boolean;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'created'): void;
}>();

const storeConfig = StoreConfig();

const VEHICLE_OPTIONS = computed(() =>
  storeConfig.EnabledVehicles.map((c) => ({ value: c.id, label: c.label.zh })),
);

const PHONE_REGEX = /^09\d{8}$/;

interface CreateForm {
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  /** Booking v2 批次 2：admin 建單拆大人 / 兒童 */
  adultCount: number;
  childCount: number;
  luggageItems: AdminOrderLuggageItem[];
  estimatedFare: number;
  extraServices: string[];
  passengerName: string;
  contactPhone: string;
  flightNumber: string;
  terminal: string;
  notes: string;
  /** 建單後是否立即派發給全部 active driver（同等 admin 後續手動按「📤 發出需求單」） */
  autoDispatch: boolean;
}

const _emptyForm = (): CreateForm => ({
  orderType: 'airport-pickup',
  pickupDateTime: '',
  pickupLocation: null,
  dropoffLocation: null,
  stopovers: [],
  vehicleType: VEHICLE_OPTIONS.value[0]?.value ?? '',
  passengerCount: 1,
  adultCount: 1,
  childCount: 0,
  luggageItems: [],
  estimatedFare: 0,
  extraServices: [],
  passengerName: '',
  contactPhone: '',
  flightNumber: '',
  terminal: '',
  notes: '',
  // 預設勾選：絕大多數 admin 建單情境都是「建完馬上要 driver 看到」
  autoDispatch: true,
});

const form = reactive<CreateForm>(_emptyForm());
const saving = ref(false);

// 開啟時重設表單（車型預設帶第一個啟用車型）
watch(() => props.modelValue, (open) => {
  if (open) Object.assign(form, _emptyForm());
});

const ClickClose = () => {
  if (saving.value) return;
  emit('update:modelValue', false);
};

// 停靠站
const ClickAddStopover = () => {
  form.stopovers.push({ address: '', lat: 0, lng: 0 } as GooglePlace);
};
const ClickRemoveStopover = (idx: number) => {
  form.stopovers.splice(idx, 1);
};

// 額外服務 toggle
const ClickToggleExtra = (id: string) => {
  const i = form.extraServices.indexOf(id);
  if (i >= 0) form.extraServices.splice(i, 1);
  else form.extraServices.push(id);
};

// 行李 stepper
const LuggageCount = (typeId: string): number =>
  form.luggageItems.find((i) => i.typeId === typeId)?.count ?? 0;

const SetLuggage = (typeId: string, rawValue: number | string) => {
  const count = Math.max(0, Math.min(20, Number(rawValue) || 0));
  const idx = form.luggageItems.findIndex((i) => i.typeId === typeId);
  if (count === 0) {
    if (idx >= 0) form.luggageItems.splice(idx, 1);
  } else if (idx >= 0) {
    form.luggageItems[idx].count = count;
  } else {
    form.luggageItems.push({ typeId, count });
  }
};

const _validate = (): string => {
  if (!form.pickupDateTime) return '請選擇用車時間';
  if (!form.pickupLocation?.address) return '請選擇上車點';
  if (!form.dropoffLocation?.address) return '請選擇下車點';
  if (form.stopovers.some((s) => !s.address)) return '請選擇所有停靠站地點';
  if (!form.vehicleType) return '請選擇車型';
  if (form.adultCount < 1) return '大人至少 1 人';
  if (form.childCount < 0) return '兒童不可為負';
  // Booking v2 批次 2：總人數 = adult + child（送出前同步）
  form.passengerCount = form.adultCount + form.childCount;
  if (form.estimatedFare < 0) return '車資不可為負';
  if (!form.passengerName.trim()) return '請填寫乘客姓名';
  if (!PHONE_REGEX.test(form.contactPhone)) return '聯絡電話格式錯誤（09 開頭 10 碼）';
  return '';
};

const ApiCreate = async () => {
  const err = _validate();
  if (err) {
    ElMessage({ message: err, type: 'warning' });
    return;
  }
  saving.value = true;
  try {
    const payload: CreateAdminOrderBody = {
      orderType: form.orderType,
      pickupDateTime: $dayjs(form.pickupDateTime).toISOString(),
      pickupLocation: form.pickupLocation!,
      dropoffLocation: form.dropoffLocation!,
      stopovers: form.stopovers,
      passengerCount: form.passengerCount,
      adultCount: form.adultCount,
      childCount: form.childCount,
      luggageItems: form.luggageItems,
      vehicleType: form.vehicleType,
      extraServices: form.extraServices,
      estimatedFare: form.estimatedFare,
      passengerName: form.passengerName.trim(),
      contactPhone: form.contactPhone,
      flightNumber: form.flightNumber || null,
      terminal: form.terminal || null,
      notes: form.notes || null,
      autoDispatch: form.autoDispatch,
    };
    const res = await $api.CreateAdminOrder(payload);
    if (res.status.code === 200) {
      const dispatchedNow = (res.data as { dispatched?: boolean } | undefined)?.dispatched === true;
      ElMessage({
        message: dispatchedNow ? '訂單已建立 + 需求單已發出' : '訂單已建立',
        type: 'success',
      });
      emit('created');
      emit('update:modelValue', false);
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '建立失敗', type: 'error' });
    }
  } finally {
    saving.value = false;
  }
};
</script>

<template lang="pug">
Transition(name="fade")
  .AdminOrdersCreateModal(v-if="modelValue" @click.self="ClickClose")
    .AdminOrdersCreateModal__panel
      //- Header
      .AdminOrdersCreateModal__head
        .AdminOrdersCreateModal__title 新增訂單
        button.AdminOrdersCreateModal__close(@click="ClickClose") ×
      .AdminOrdersCreateModal__hint 模擬一筆無 LINE 帳號的乘客訂單；建立後可於訂單列表編輯。

      //- Body
      .AdminOrdersCreateModal__body
        //- 行程類型
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__label 行程類型
          select.AdminOrdersCreateModal__input(v-model="form.orderType")
            option(v-for="t in ORDER_TYPES" :key="t.value" :value="t.value") {{ t.label }}

        //- 用車時間
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__label 用車日期 / 時間
          input.AdminOrdersCreateModal__input(type="datetime-local" lang="en-GB" v-model="form.pickupDateTime")

        //- 上車點
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__label 上車點
          PassengerBookingLocationInput(v-model="form.pickupLocation" placeholder="搜尋上車地點")

        //- 停靠站
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__label 停靠站
          .AdminOrdersCreateModal__stopover-list
            .AdminOrdersCreateModal__stopover-item(v-for="(_s, i) in form.stopovers" :key="i")
              .AdminOrdersCreateModal__stopover-num 停靠 {{ i + 1 }}
              PassengerBookingLocationInput(v-model="form.stopovers[i]" placeholder="搜尋停靠地點")
              button.AdminOrdersCreateModal__stopover-remove(type="button" @click="ClickRemoveStopover(i)") ×
          button.AdminOrdersCreateModal__stopover-add(type="button" @click="ClickAddStopover") + 新增停靠站

        //- 下車點
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__label 下車點
          PassengerBookingLocationInput(v-model="form.dropoffLocation" placeholder="搜尋下車地點")

        //- 車型 / 人數
        .AdminOrdersCreateModal__grid
          .AdminOrdersCreateModal__field
            label.AdminOrdersCreateModal__label 車型
            select.AdminOrdersCreateModal__input(v-model="form.vehicleType")
              option(v-if="!VEHICLE_OPTIONS.length" value="" disabled) 無可用車型
              option(v-for="opt in VEHICLE_OPTIONS" :key="opt.value" :value="opt.value") {{ opt.label }}
          //- Booking v2 批次 2：拆大人 / 兒童
          .AdminOrdersCreateModal__field
            label.AdminOrdersCreateModal__label 大人
            input.AdminOrdersCreateModal__input(
              type="number" v-model.number="form.adultCount"
              inputmode="numeric" min="1" max="20"
            )

        .AdminOrdersCreateModal__grid
          .AdminOrdersCreateModal__field
            label.AdminOrdersCreateModal__label 兒童
            input.AdminOrdersCreateModal__input(
              type="number" v-model.number="form.childCount"
              inputmode="numeric" min="0" max="20"
            )

        //- 行李
        .AdminOrdersCreateModal__field(v-if="storeConfig.luggageTypes.length")
          label.AdminOrdersCreateModal__label 行李（SU 計算）
          .AdminOrdersCreateModal__luggage
            .AdminOrdersCreateModal__luggage-row(v-for="lt in storeConfig.luggageTypes" :key="lt.id")
              span.AdminOrdersCreateModal__luggage-name {{ lt.label.zh }}（{{ lt.su }} SU）
              input.AdminOrdersCreateModal__input(
                type="number" min="0" max="20" inputmode="numeric"
                :value="LuggageCount(lt.id)"
                @input="(e) => SetLuggage(lt.id, (e.target as HTMLInputElement).value)"
              )

        //- 額外服務
        .AdminOrdersCreateModal__field(v-if="storeConfig.EnabledExtras.length")
          label.AdminOrdersCreateModal__label 額外服務
          .AdminOrdersCreateModal__extras
            button.AdminOrdersCreateModal__extra-btn(
              v-for="s in storeConfig.EnabledExtras"
              :key="s.id"
              type="button"
              :class="{ 'is-active': form.extraServices.includes(s.id) }"
              @click="ClickToggleExtra(s.id)"
            ) {{ s.label.zh }}

        //- 乘客姓名 / 聯絡電話
        .AdminOrdersCreateModal__grid
          .AdminOrdersCreateModal__field
            label.AdminOrdersCreateModal__label 乘客姓名
            input.AdminOrdersCreateModal__input(
              v-model="form.passengerName" maxlength="40" placeholder="乘客姓名"
            )
          .AdminOrdersCreateModal__field
            label.AdminOrdersCreateModal__label 聯絡電話
            input.AdminOrdersCreateModal__input(
              v-model="form.contactPhone" maxlength="10" inputmode="numeric" placeholder="09xxxxxxxx"
            )

        //- 車資
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__label 車資 (NT$)
          input.AdminOrdersCreateModal__input(
            type="number" v-model.number="form.estimatedFare"
            inputmode="numeric" min="0"
          )

        //- 航班 / 航廈
        .AdminOrdersCreateModal__grid
          .AdminOrdersCreateModal__field
            label.AdminOrdersCreateModal__label 航班編號（選填）
            input.AdminOrdersCreateModal__input(v-model="form.flightNumber" maxlength="20" placeholder="如 BR189")
          .AdminOrdersCreateModal__field
            label.AdminOrdersCreateModal__label 航廈（選填）
            input.AdminOrdersCreateModal__input(v-model="form.terminal" maxlength="10" placeholder="如 T1")

        //- 備註
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__label 備註（選填）
          textarea.AdminOrdersCreateModal__textarea(
            v-model="form.notes" rows="3" maxlength="200"
            placeholder="特殊需求或備忘（200 字內）"
          )

        //- 立即派發開關
        .AdminOrdersCreateModal__field
          label.AdminOrdersCreateModal__autodispatch
            input(type="checkbox" v-model="form.autoDispatch")
            span.AdminOrdersCreateModal__autodispatch-text
              | 建立後立即發出需求單（LINE 推播給全部已認證司機）
            span.AdminOrdersCreateModal__autodispatch-hint
              | 若取消勾選，訂單會建為「待派發」狀態，需再到訂單詳情點「📤 發出需求單」

      //- Footer
      .AdminOrdersCreateModal__foot
        button.AdminOrdersCreateModal__action.is-secondary(@click="ClickClose" :disabled="saving") 取消
        button.AdminOrdersCreateModal__action.is-primary(@click="ApiCreate" :disabled="saving")
          | {{ saving ? '建立中...' : (form.autoDispatch ? '建立並發單' : '建立訂單') }}
</template>

<style lang="scss" scoped>
$surface: rgba(255, 255, 255, 0.04);
$surface-2: rgba(255, 255, 255, 0.08);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$amber-light: #f7b96a;
$muted: rgba(255, 255, 255, 0.35);

.AdminOrdersCreateModal {
  position: fixed;
  inset: 0;
  z-index: 1050;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.AdminOrdersCreateModal__panel {
  width: 100%;
  max-width: 640px;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  overflow: hidden;
}

.AdminOrdersCreateModal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid $border;
}

.AdminOrdersCreateModal__title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 24px;
  letter-spacing: 0.05em;
  color: #fff;
}

.AdminOrdersCreateModal__close {
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
}

.AdminOrdersCreateModal__hint {
  padding: 10px 20px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
  line-height: 1.5;
}

.AdminOrdersCreateModal__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.AdminOrdersCreateModal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.AdminOrdersCreateModal__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 479.98px) {
  .AdminOrdersCreateModal__grid { grid-template-columns: 1fr; }
}

.AdminOrdersCreateModal__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: $muted;
}

.AdminOrdersCreateModal__input,
.AdminOrdersCreateModal__textarea {
  width: 100%;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  outline: none;
  resize: none;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &::placeholder { color: rgba(255, 255, 255, 0.2); }
  &:focus { border-color: rgba($amber, 0.4); }
}

.AdminOrdersCreateModal__input[type="datetime-local"] {
  color-scheme: dark;
}

.AdminOrdersCreateModal__input option {
  background: #161b22;
  color: #fff;
}

.AdminOrdersCreateModal__stopover-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.AdminOrdersCreateModal__stopover-item {
  display: grid;
  grid-template-columns: 60px 1fr 32px;
  align-items: center;
  gap: 8px;
}

.AdminOrdersCreateModal__stopover-num {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #64c8ff;
  background: rgba(100, 200, 255, 0.1);
  border: 1px solid rgba(100, 200, 255, 0.25);
  padding: 4px 8px;
  border-radius: 6px;
  text-align: center;
}

.AdminOrdersCreateModal__stopover-remove {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 80, 80, 0.25);
  background: rgba(255, 80, 80, 0.08);
  color: rgba(255, 100, 100, 0.85);
  border-radius: 8px;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba(255, 80, 80, 0.18); }
}

.AdminOrdersCreateModal__stopover-add {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px dashed rgba(100, 200, 255, 0.3);
  background: rgba(100, 200, 255, 0.04);
  color: #64c8ff;
  cursor: pointer;
  margin-top: 6px;
  transition: background 0.15s;

  &:hover { background: rgba(100, 200, 255, 0.1); }
}

.AdminOrdersCreateModal__luggage {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.AdminOrdersCreateModal__luggage-row {
  display: grid;
  grid-template-columns: 1fr 90px;
  align-items: center;
  gap: 10px;
}

.AdminOrdersCreateModal__luggage-name {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
}

.AdminOrdersCreateModal__extras {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.AdminOrdersCreateModal__extra-btn {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.12);
    color: $amber-light;
  }
}

.AdminOrdersCreateModal__autodispatch {
  display: grid;
  grid-template-columns: 18px 1fr;
  column-gap: 8px;
  row-gap: 2px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(212, 134, 10, 0.06);
  border: 1px solid rgba(212, 134, 10, 0.2);
  cursor: pointer;
  align-items: center;

  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: $amber;
    cursor: pointer;
    grid-row: span 2;
  }
}

.AdminOrdersCreateModal__autodispatch-text {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: $amber-light;
}

.AdminOrdersCreateModal__autodispatch-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
  line-height: 1.5;
}

.AdminOrdersCreateModal__foot {
  padding: 14px 20px;
  border-top: 1px solid $border;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.2);
}

.AdminOrdersCreateModal__action {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: $amber;
    color: #fff;
    &:hover:not(:disabled) { background: darken(#d4860a, 6%); }
  }

  &.is-secondary {
    background: $surface;
    color: rgba(255, 255, 255, 0.7);
    border-color: $border;
    &:hover:not(:disabled) { background: $surface-2; }
  }
}

.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
