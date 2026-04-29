<script setup lang="ts">
import type { GooglePlace, PlaceSuggestion } from '~/protocol/fetch-api/api/maps';

interface Props {
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  theme?: 'light' | 'dark';
}

const props = withDefaults(defineProps<Props>(), {
  label: undefined,
  placeholder: '',
  disabled: false,
  theme: 'light',
});

const { t } = useI18n();
const effectivePlaceholder = computed(() => props.placeholder || t('ui.googlePlace.placeholder'));

const emit = defineEmits<{
  (e: 'update:modelValue', place: GooglePlace | null): void;
  (e: 'focus' | 'blur'): void;
}>();

const model = defineModel<GooglePlace | null>({ default: null });

// 輸入框顯示文字：地點名稱 (完整地址)
const inputText = ref('');
const suggestions = ref<PlaceSuggestion[]>([]);
const showDropdown = ref(false);
const loading = ref(false);
const errorMsg = ref('');

// sessiontoken 用於 Places API 計費最佳化，每次對話週期重用同一組
const sessionToken = ref(_newSessionToken());

function _newSessionToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// 初始化時同步顯示值
watch(
  model,
  (place) => {
    if (!place) { inputText.value = ''; return; }
    inputText.value = `${place.displayName} (${place.address})`;
  },
  { immediate: true }
);

// 防抖計時器
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function OnInput() {
  errorMsg.value = '';
  if (debounceTimer) clearTimeout(debounceTimer);

  const val = inputText.value.trim();
  if (val.length < 2) {
    suggestions.value = [];
    showDropdown.value = false;
    return;
  }

  debounceTimer = setTimeout(() => ApiGetSuggestions(val), 350);
}

function OnBlur() {
  setTimeout(() => { showDropdown.value = false; }, 200);
  emit('blur');
}

function OnFocus() {
  if (suggestions.value.length) showDropdown.value = true;
  emit('focus');
}

function ClickClear() {
  inputText.value = '';
  suggestions.value = [];
  showDropdown.value = false;
  errorMsg.value = '';
  model.value = null;
  emit('update:modelValue', null);
  sessionToken.value = _newSessionToken();
}

async function ClickSuggestion(item: PlaceSuggestion) {
  showDropdown.value = false;
  loading.value = true;
  errorMsg.value = '';

  const res = await $api.GetMapsPlaceDetails({
    placeId: item.placeId,
    sessiontoken: sessionToken.value,
  });

  loading.value = false;

  if (res.status.code !== 200) {
    errorMsg.value = res.status.message.zh_tw;
    // 清除 sessionToken，下次重新計費
    sessionToken.value = _newSessionToken();
    return;
  }

  const place = res.data as GooglePlace;
  // onSelect：輸入框顯示「地點名稱 (完整地址)」
  inputText.value = `${place.displayName} (${place.address})`;
  model.value = place;
  emit('update:modelValue', place);
  // 完成一次對話週期，重置 sessionToken
  sessionToken.value = _newSessionToken();
}

// 允許外部（MapRoutePreview Drop Pin）直接設定地點
function SetPlace(place: GooglePlace) {
  inputText.value = `${place.displayName} (${place.address})`;
  model.value = place;
  emit('update:modelValue', place);
  suggestions.value = [];
  showDropdown.value = false;
}

async function ApiGetSuggestions(input: string) {
  loading.value = true;
  const res = await $api.GetMapsAutocomplete({ input, sessiontoken: sessionToken.value });
  loading.value = false;

  if (res.status.code !== 200) {
    suggestions.value = [];
    showDropdown.value = false;
    return;
  }

  suggestions.value = (res.data as { suggestions: PlaceSuggestion[] }).suggestions ?? [];
  showDropdown.value = suggestions.value.length > 0;
}

defineExpose({ SetPlace });
</script>

<template lang="pug">
.UiGooglePlaceInput(:class="[`is-${theme}`, { 'is-disabled': disabled }]")
  label.UiGooglePlaceInput__label(v-if="label") {{ label }}
  .UiGooglePlaceInput__wrap
    input.UiGooglePlaceInput__field(
      v-model="inputText"
      :placeholder="effectivePlaceholder"
      :disabled="disabled"
      maxlength="200"
      autocomplete="off"
      @input="OnInput"
      @focus="OnFocus"
      @blur="OnBlur"
    )
    .UiGooglePlaceInput__suffix
      .UiGooglePlaceInput__spinner(v-if="loading")
      button.UiGooglePlaceInput__clear(v-else-if="inputText" type="button" @click="ClickClear") ×

    //- 建議下拉選單
    transition(name="dropdown")
      ul.UiGooglePlaceInput__dropdown(v-if="showDropdown && suggestions.length")
        li.UiGooglePlaceInput__dropdown__item(
          v-for="item in suggestions"
          :key="item.placeId"
          @mousedown.prevent="ClickSuggestion(item)"
        )
          .UiGooglePlaceInput__dropdown__name {{ item.displayName }}
          .UiGooglePlaceInput__dropdown__addr {{ item.address }}

  p.UiGooglePlaceInput__error(v-if="errorMsg") {{ errorMsg }}
</template>

<style lang="scss" scoped>
.UiGooglePlaceInput {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.UiGooglePlaceInput__label {
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-gray);
}

.UiGooglePlaceInput__wrap {
  position: relative;
}

.UiGooglePlaceInput__field {
  width: 100%;
  min-height: 44px;
  padding: 12px 40px 12px 16px;
  border-radius: 12px;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
  -webkit-appearance: none;

  &::placeholder { color: var(--da-gray-light); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

// ── Light ──────────────────────────────────────────────────
.UiGooglePlaceInput.is-light .UiGooglePlaceInput__field {
  background: rgba(255, 255, 255, 0.85);
  border: 1.5px solid var(--da-gray-pale);
  color: var(--da-dark);

  &:focus { border-color: var(--da-amber); background: #fff; }
}

// ── Dark ───────────────────────────────────────────────────
.UiGooglePlaceInput.is-dark .UiGooglePlaceInput__label {
  color: rgba(255, 255, 255, 0.5);
}

.UiGooglePlaceInput.is-dark .UiGooglePlaceInput__field {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--da-cream);

  &::placeholder { color: rgba(255, 255, 255, 0.25); }
  &:focus { border-color: var(--da-amber); background: rgba(255, 255, 255, 0.1); }
}

// ── suffix（loading spinner / clear btn）──────────────────
.UiGooglePlaceInput__suffix {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
}

.UiGooglePlaceInput__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--da-gray-pale);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.UiGooglePlaceInput__clear {
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: var(--da-gray);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover { color: var(--da-dark); }
}

// ── 下拉選單 ───────────────────────────────────────────────
.UiGooglePlaceInput__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1.5px solid var(--da-gray-pale);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  list-style: none;
  padding: 6px 0;
  margin: 0;
  z-index: 100;
  overflow: hidden;
}

.UiGooglePlaceInput__dropdown__item {
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: var(--da-cream); }
}

.UiGooglePlaceInput__dropdown__name {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--da-dark);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.UiGooglePlaceInput__dropdown__addr {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: var(--da-gray);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

// ── 錯誤訊息 ───────────────────────────────────────────────
.UiGooglePlaceInput__error {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: var(--err);
  line-height: 1.4;
}

// ── 下拉動畫 ───────────────────────────────────────────────
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
