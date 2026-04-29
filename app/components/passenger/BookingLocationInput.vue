<script setup lang="ts">
interface Props {
  modelValue: GooglePlace | null;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
}

const { t } = useI18n();

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  label: '',
  disabled: false,
});

const effectivePlaceholder = computed(() => props.placeholder || t('ui.bookingLocation.placeholder'));

const emit = defineEmits<{
  (e: 'update:modelValue', val: GooglePlace | null): void;
}>();

const inputText = ref(props.modelValue?.address ?? '');
const suggestions = ref<PlacePrediction[]>([]);
const showDropdown = ref(false);
const isLoading = ref(false);
const sessiontoken = ref(crypto.randomUUID());

watch(() => props.modelValue, (val) => {
  inputText.value = val?.displayName ?? val?.address ?? '';
});

const debounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);

const OnInput = (val: string) => {
  inputText.value = val;
  emit('update:modelValue', null);
  if (debounceTimer.value) clearTimeout(debounceTimer.value);
  if (!val || val.length < 2) {
    suggestions.value = [];
    showDropdown.value = false;
    return;
  }
  debounceTimer.value = setTimeout(() => ApiSearch(val), 350);
};

const _isOk = (code: number) => code === $enum.apiStatus.success || code === 0;

const ApiSearch = async (input: string) => {
  isLoading.value = true;
  const res = await $api.GetAutocomplete({ input, sessiontoken: sessiontoken.value });
  isLoading.value = false;
  if (!_isOk(res.status.code)) return;
  suggestions.value = res.data as PlacePrediction[];
  showDropdown.value = suggestions.value.length > 0;
};

const ClickSelect = async (prediction: PlacePrediction) => {
  showDropdown.value = false;
  inputText.value = prediction.mainText; // 暫時顯示名稱，等 geocode 回來再更新
  isLoading.value = true;
  const res = await $api.GetGeocode({ placeId: prediction.placeId, sessiontoken: sessiontoken.value });
  isLoading.value = false;
  sessiontoken.value = crypto.randomUUID();
  if (!_isOk(res.status.code)) return;
  const geo = res.data as GeocodeRes;
  // 顯示格式：地點名稱 (完整地址)
  const displayName = `${prediction.mainText} (${geo.address})`;
  inputText.value = displayName;
  const place: GooglePlace = {
    address: geo.address,       // 傳給 API 的是乾淨的格式化地址
    lat: geo.lat,
    lng: geo.lng,
    placeId: geo.placeId,
    displayName,                // 顯示用（確認頁同步顯示）
  };
  emit('update:modelValue', place);
};

const ClickClear = () => {
  inputText.value = '';
  suggestions.value = [];
  showDropdown.value = false;
  emit('update:modelValue', null);
};

const OnBlur = () => {
  setTimeout(() => { showDropdown.value = false; }, 180);
};
</script>

<template lang="pug">
.PassengerBookingLocationInput
  .PassengerBookingLocationInput__label(v-if="label") {{ label }}
  .PassengerBookingLocationInput__field
    ElInput(
      :model-value="inputText"
      :placeholder="effectivePlaceholder"
      :disabled="disabled"
      maxlength="100"
      clearable
      @input="OnInput"
      @blur="OnBlur"
      @clear="ClickClear"
    )
      template(#suffix)
        NuxtIcon(v-if="isLoading" name="mdi:loading" class="spin-icon")
        NuxtIcon(v-else-if="modelValue" name="mdi:check-circle" class="check-icon")

    Transition(name="dropdown")
      .PassengerBookingLocationInput__dropdown(v-if="showDropdown")
        .PassengerBookingLocationInput__item(
          v-for="item in suggestions"
          :key="item.placeId"
          @mousedown.prevent="ClickSelect(item)"
        )
          NuxtIcon.PassengerBookingLocationInput__item-icon(name="mdi:map-marker-outline")
          .PassengerBookingLocationInput__item-text
            span.main {{ item.mainText }}
            span.secondary {{ item.secondaryText }}
</template>

<style lang="scss" scoped>
.PassengerBookingLocationInput {
  position: relative;

  &__label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--da-amber);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;

    &::before {
      content: '';
      width: 18px;
      height: 1.5px;
      background: var(--da-amber);
      flex-shrink: 0;
    }
  }

  &__field {
    position: relative;
  }

  &__dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--da-off-white);
    border: 1px solid var(--da-glass-border);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 50;
    overflow: hidden;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: var(--da-amber-pale);
    }

    &:not(:last-child) {
      border-bottom: 1px solid var(--da-gray-pale);
    }
  }

  &__item-icon {
    color: var(--da-amber);
    font-size: 18px;
    flex-shrink: 0;
  }

  &__item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;

    .main {
      font-family: 'Barlow', 'Noto Sans TC', sans-serif;
      font-size: 14px;
      color: var(--da-dark);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .secondary {
      font-size: 12px;
      color: var(--da-gray);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
}

.spin-icon {
  animation: spin 0.8s linear infinite;
  color: var(--da-amber);
}

.check-icon {
  color: #22c55e;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
