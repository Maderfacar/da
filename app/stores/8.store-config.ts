// P23：Fleet 計價設定（車型 / 行李類型 / 加值服務）— 從 Firestore 載入
//
// 任何乘客/admin/driver 端要顯示車型 label / 加值服務金額 / 行李 SU 上限的地方，
// 都從這個 store 拿，不再寫死於 shared/pricing.ts。
//
// 載入時機：app 啟動時由 `plugins/init-config.client.ts` 觸發 Init() 一次；
// admin 在 settings 編輯後手動呼叫 Reload() 刷新。

import type { FleetVehicle, FleetLuggageType, FleetExtra, I18nLabel } from '~shared/pricing';

type Locale = 'zh' | 'en' | 'ja';

export const StoreConfig = defineStore('StoreConfig', () => {
  const vehicles = ref<FleetVehicle[]>([]);
  const luggageTypes = ref<FleetLuggageType[]>([]);
  const extras = ref<FleetExtra[]>([]);

  const isLoaded = ref(false);
  const isLoading = ref(false);

  const Init = async () => {
    if (isLoaded.value || isLoading.value) return;
    isLoading.value = true;
    try {
      const res = await $api.GetFleetConfig();
      if (res.status.code === $enum.apiStatus.success || res.status.code === 0) {
        const data = res.data as GetFleetConfigRes;
        vehicles.value = (data.vehicles ?? []) as FleetVehicle[];
        luggageTypes.value = (data.luggageTypes ?? []) as FleetLuggageType[];
        extras.value = (data.extras ?? []) as FleetExtra[];
        isLoaded.value = true;
      }
    } finally {
      isLoading.value = false;
    }
  };

  const Reload = async () => {
    isLoaded.value = false;
    await Init();
  };

  // ── Getters ──────────────────────────────────────────────────────────────
  const GetVehicle = (id: string): FleetVehicle | undefined =>
    vehicles.value.find((v) => v.id === id);

  const GetLuggageType = (id: string): FleetLuggageType | undefined =>
    luggageTypes.value.find((t) => t.id === id);

  const GetExtra = (id: string): FleetExtra | undefined =>
    extras.value.find((e) => e.id === id);

  /** 只回 enabled 車型，依 sortOrder 排序（後端已 orderBy；前端二次保險） */
  const EnabledVehicles = computed(() =>
    [...vehicles.value].filter((v) => v.enabled).sort((a, b) => a.sortOrder - b.sortOrder),
  );

  /** 只回 enabled 加值服務 */
  const EnabledExtras = computed(() =>
    [...extras.value].filter((e) => e.enabled).sort((a, b) => a.sortOrder - b.sortOrder),
  );

  /** 取 i18n label，先當前語系，缺則 fallback 至中文 */
  const LabelOf = (label: I18nLabel | undefined, locale: Locale): string => {
    if (!label) return '';
    return label[locale] || label.zh || '';
  };

  return {
    vehicles,
    luggageTypes,
    extras,
    isLoaded,
    isLoading,
    Init,
    Reload,
    GetVehicle,
    GetLuggageType,
    GetExtra,
    EnabledVehicles,
    EnabledExtras,
    LabelOf,
  };
});
