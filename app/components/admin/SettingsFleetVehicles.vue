<script setup lang="ts">
// P23 Stage 5：admin/settings 車型 CRUD 區塊
// 從 StoreConfig() 撈 vehicles 列表，提供新增/編輯/刪除/啟用切換。
// 編輯 / 新增彈窗含三語 label（zh/en/ja）與 4 個數值欄位（capacity / luggageSU / baseFare / perKmRate）。
//
// Charter Fare V1 W3：彈窗底部加「包車套餐」摺疊區，每車型 3 個 plan card（4h / 8h / 10h），
// 含「從其他車型複製」快捷；儲存時自動過濾全停用 → null（清除欄位）。

import type { CharterPlanKey } from '~shared/pricing';

type DialogMode = 'create' | 'edit';

const CHARTER_PLAN_KEYS: ReadonlyArray<CharterPlanKey> = ['4h', '8h', '10h'];
const CHARTER_PLAN_KEY_TO_HOURS: Readonly<Record<CharterPlanKey, number>> = {
  '4h': 4,
  '8h': 8,
  '10h': 10,
};

interface PlanFormState {
  enabled: boolean;
  basePrice: number;
  includedKm: number;
  extraKmRate: number;
  overtimeRatePer30min: number;
}

type CharterPlansForm = Record<CharterPlanKey, PlanFormState>;

interface VehicleFormState {
  id: string;
  labelZh: string;
  labelEn: string;
  labelJa: string;
  // Booking v2：tagline 三語（情境文案；三語都空 → 不送）
  taglineZh: string;
  taglineEn: string;
  taglineJa: string;
  // airport-calibration wave：luggageDescription 三語（取代 SU 容量數字；三語都空 → 不送）
  luggageDescZh: string;
  luggageDescEn: string;
  luggageDescJa: string;
  // 車卡圖庫（exterior 為卡片主圖；其餘 lightbox 顯示）
  imageExterior: string;
  imageInterior: string;
  imageTrunk: string;
  capacity: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  charterPlans: CharterPlansForm;
  charterCopySourceId: string;
  showCharter: boolean;
}

const storeConfig = StoreConfig();

const dialog = reactive<{ open: boolean; mode: DialogMode; original: FleetVehicleDto | null; saving: boolean; error: string }>({
  open: false,
  mode: 'create',
  original: null,
  saving: false,
  error: '',
});

const form = reactive<VehicleFormState>(_emptyForm());
const togglingId = ref('');
const deletingId = ref('');
const reloading = ref(false);

const ClickReload = async () => {
  if (reloading.value) return;
  reloading.value = true;
  try {
    await storeConfig.Reload();
    ElMessage({ message: '已重新整理車型列表', type: 'success' });
  } finally {
    reloading.value = false;
  }
};

function _emptyPlanForm(): PlanFormState {
  return {
    enabled: false,
    basePrice: 0,
    includedKm: 0,
    extraKmRate: 0,
    overtimeRatePer30min: 0,
  };
}

function _emptyCharterPlans(): CharterPlansForm {
  return {
    '4h': _emptyPlanForm(),
    '8h': _emptyPlanForm(),
    '10h': _emptyPlanForm(),
  };
}

function _emptyForm(): VehicleFormState {
  return {
    id: '',
    labelZh: '',
    labelEn: '',
    labelJa: '',
    taglineZh: '',
    taglineEn: '',
    taglineJa: '',
    luggageDescZh: '',
    luggageDescEn: '',
    luggageDescJa: '',
    imageExterior: '',
    imageInterior: '',
    imageTrunk: '',
    capacity: 4,
    baseFare: 300,
    perKmRate: 25,
    icon: 'mdi:car',
    sortOrder: 99,
    enabled: true,
    charterPlans: _emptyCharterPlans(),
    charterCopySourceId: '',
    showCharter: false,
  };
}

/**
 * 由 FleetVehicle.charterPlans 物件還原 form 用的 CharterPlansForm。
 * 缺 key → 空 plan（disabled）；多餘 key → 忽略。
 */
function _planFromVehicle(plans: FleetVehicleDto['charterPlans']): CharterPlansForm {
  const out = _emptyCharterPlans();
  if (!plans) return out;
  for (const k of CHARTER_PLAN_KEYS) {
    const p = plans[k];
    if (!p) continue;
    out[k] = {
      enabled: !!p.enabled,
      basePrice: Number(p.basePrice) || 0,
      includedKm: Number(p.includedKm) || 0,
      extraKmRate: Number(p.extraKmRate) || 0,
      overtimeRatePer30min: Number(p.overtimeRatePer30min) || 0,
    };
  }
  return out;
}

/**
 * 把 form charterPlans 收成 payload；全部 plan 都 disabled → 回 null（後端清除欄位）。
 */
function _planToPayload(plans: CharterPlansForm): CreateVehiclePayload['charterPlans'] {
  const map: Partial<Record<CharterPlanKey, CharterPlanDto>> = {};
  let enabledCount = 0;
  for (const k of CHARTER_PLAN_KEYS) {
    const p = plans[k];
    map[k] = {
      key: k,
      durationHours: CHARTER_PLAN_KEY_TO_HOURS[k],
      basePrice: p.basePrice,
      includedKm: p.includedKm,
      extraKmRate: p.extraKmRate,
      overtimeRatePer30min: p.overtimeRatePer30min,
      enabled: p.enabled,
    };
    if (p.enabled) enabledCount++;
  }
  return enabledCount === 0 ? null : map;
}

const ClickOpenCreate = () => {
  Object.assign(form, _emptyForm());
  // 預設 sortOrder 接在最後一筆 +1
  const maxOrder = storeConfig.vehicles.reduce((m, v) => Math.max(m, v.sortOrder), 0);
  form.sortOrder = maxOrder + 1;
  dialog.mode = 'create';
  dialog.original = null;
  dialog.error = '';
  dialog.open = true;
};

const ClickOpenEdit = (v: FleetVehicleDto) => {
  form.id = v.id;
  form.labelZh = v.label.zh;
  form.labelEn = v.label.en;
  form.labelJa = v.label.ja;
  form.taglineZh = v.tagline?.zh ?? '';
  form.taglineEn = v.tagline?.en ?? '';
  form.taglineJa = v.tagline?.ja ?? '';
  form.luggageDescZh = v.luggageDescription?.zh ?? '';
  form.luggageDescEn = v.luggageDescription?.en ?? '';
  form.luggageDescJa = v.luggageDescription?.ja ?? '';
  form.imageExterior = v.images?.exterior ?? '';
  form.imageInterior = v.images?.interior ?? '';
  form.imageTrunk = v.images?.trunk ?? '';
  form.capacity = v.capacity;
  form.baseFare = v.baseFare;
  form.perKmRate = v.perKmRate;
  form.icon = v.icon;
  form.sortOrder = v.sortOrder;
  form.enabled = v.enabled;
  form.charterPlans = _planFromVehicle(v.charterPlans);
  form.charterCopySourceId = '';
  form.showCharter = !!v.charterPlans && Object.keys(v.charterPlans).length > 0;
  dialog.mode = 'edit';
  dialog.original = v;
  dialog.error = '';
  dialog.open = true;
};

// 從其他車型複製 charterPlans（pull-style，使用者要在來源 select 選好再按按鈕）
const ClickCopyCharterPlans = () => {
  const src = storeConfig.vehicles.find((v) => v.id === form.charterCopySourceId);
  if (!src || !src.charterPlans) {
    ElMessage({ message: '所選來源車型尚未設定包車套餐', type: 'warning' });
    return;
  }
  form.charterPlans = _planFromVehicle(src.charterPlans);
  ElMessage({ message: `已從「${src.label.zh}」複製套餐`, type: 'success' });
};

const ClickClose = () => {
  if (dialog.saving) return;
  dialog.open = false;
};

const _validate = (): string => {
  if (dialog.mode === 'create') {
    if (!form.id.trim()) return 'ID 必填';
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(form.id.trim())) return 'ID 必須小寫字母 / 數字 / 連字號開頭，最長 50 字';
    if (storeConfig.vehicles.some((v) => v.id === form.id.trim())) return 'ID 已存在';
  }
  if (!form.labelZh.trim() || !form.labelEn.trim() || !form.labelJa.trim()) return '三語 label 都必填';
  if (!Number.isInteger(form.capacity) || form.capacity < 1) return 'capacity 必須是正整數';
  if (!(form.baseFare >= 0)) return 'baseFare 必須 ≥ 0';
  if (!(form.perKmRate >= 0)) return 'perKmRate 必須 ≥ 0';
  if (!form.icon.trim()) return 'icon 必填（例：mdi:car）';
  if (!Number.isInteger(form.sortOrder)) return 'sortOrder 必須整數';
  // 包車套餐欄位驗證：僅 enabled=true 的 plan 強制 4 數值欄位 > 0（admin 沒填會被乘客扣 0 元）
  for (const k of CHARTER_PLAN_KEYS) {
    const p = form.charterPlans[k];
    if (!Number.isFinite(p.basePrice) || p.basePrice < 0) return `包車 ${k} basePrice 必須 ≥ 0`;
    if (!Number.isFinite(p.includedKm) || p.includedKm < 0) return `包車 ${k} includedKm 必須 ≥ 0`;
    if (!Number.isFinite(p.extraKmRate) || p.extraKmRate < 0) return `包車 ${k} extraKmRate 必須 ≥ 0`;
    if (!Number.isFinite(p.overtimeRatePer30min) || p.overtimeRatePer30min < 0) return `包車 ${k} OT 段價必須 ≥ 0`;
    if (p.enabled && p.basePrice <= 0) return `包車 ${k} 已啟用但 basePrice 為 0；請填寫或停用`;
  }
  return '';
};

const ClickSave = async () => {
  const err = _validate();
  if (err) {
    dialog.error = err;
    return;
  }
  dialog.error = '';
  dialog.saving = true;
  try {
    const taglineZh = form.taglineZh.trim();
    const taglineEn = form.taglineEn.trim();
    const taglineJa = form.taglineJa.trim();
    // 三語都空 → 送 null（後端 validation 視為清除）；任一有值 → 送三語物件
    const taglinePayload: { zh: string; en: string; ja: string } | null =
      (taglineZh || taglineEn || taglineJa)
        ? { zh: taglineZh, en: taglineEn, ja: taglineJa }
        : null;
    const luggageDescZh = form.luggageDescZh.trim();
    const luggageDescEn = form.luggageDescEn.trim();
    const luggageDescJa = form.luggageDescJa.trim();
    const luggageDescriptionPayload: { zh: string; en: string; ja: string } | null =
      (luggageDescZh || luggageDescEn || luggageDescJa)
        ? { zh: luggageDescZh, en: luggageDescEn, ja: luggageDescJa }
        : null;
    const imgExt = form.imageExterior.trim();
    const imgInt = form.imageInterior.trim();
    const imgTrk = form.imageTrunk.trim();
    const imagesPayload: { exterior?: string; interior?: string; trunk?: string } | null =
      (imgExt || imgInt || imgTrk)
        ? {
            ...(imgExt ? { exterior: imgExt } : {}),
            ...(imgInt ? { interior: imgInt } : {}),
            ...(imgTrk ? { trunk: imgTrk } : {}),
          }
        : null;
    const payload: CreateVehiclePayload = {
      label: { zh: form.labelZh.trim(), en: form.labelEn.trim(), ja: form.labelJa.trim() },
      capacity: form.capacity,
      baseFare: form.baseFare,
      perKmRate: form.perKmRate,
      icon: form.icon.trim(),
      sortOrder: form.sortOrder,
      enabled: form.enabled,
      tagline: taglinePayload,
      luggageDescription: luggageDescriptionPayload,
      images: imagesPayload,
      charterPlans: _planToPayload(form.charterPlans),
    };
    const res = dialog.mode === 'create'
      ? await $api.CreateFleetVehicle({ ...payload, id: form.id.trim() })
      : await $api.UpdateFleetVehicle(form.id, payload);
    if (res.status?.code !== 200) {
      dialog.error = res.status?.message?.zh_tw ?? '儲存失敗';
      return;
    }
    await storeConfig.Reload();
    dialog.open = false;
    ElMessage({ message: dialog.mode === 'create' ? '已新增車型' : '已更新車型', type: 'success' });
  } finally {
    dialog.saving = false;
  }
};

const ClickToggleEnabled = async (v: FleetVehicleDto) => {
  togglingId.value = v.id;
  try {
    const res = await $api.UpdateFleetVehicle(v.id, {
      label: v.label,
      capacity: v.capacity,
      baseFare: v.baseFare,
      perKmRate: v.perKmRate,
      icon: v.icon,
      sortOrder: v.sortOrder,
      enabled: !v.enabled,
      // Booking v2：保留既有 tagline，避免被 PUT 全量覆寫清掉
      tagline: v.tagline ?? null,
      // airport-calibration wave：保留既有 luggageDescription / images
      luggageDescription: v.luggageDescription ?? null,
      images: v.images ?? null,
      // Charter Fare V1：保留既有 charterPlans，避免快速切啟用後 plans 被清掉
      charterPlans: v.charterPlans ?? null,
    });
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '切換失敗', type: 'error' });
      return;
    }
    await storeConfig.Reload();
  } finally {
    togglingId.value = '';
  }
};

const ClickDelete = async (v: FleetVehicleDto) => {
  const $ask = UseAsk();
  const ok = await $ask.Any(
    `確定刪除車型「${v.label.zh}」？\n（既有訂單仍會保留 vehicleType 字串快照，但乘客 fleet 頁將不再顯示此選項）`,
    '刪除車型',
    '取消',
    '確定刪除',
    'warning',
  );
  if (!ok) return;
  deletingId.value = v.id;
  try {
    const res = await $api.DeleteFleetVehicle(v.id);
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '刪除失敗', type: 'error' });
      return;
    }
    await storeConfig.Reload();
    ElMessage({ message: '已刪除', type: 'warning' });
  } finally {
    deletingId.value = '';
  }
};
</script>

<template lang="pug">
.SettingsFleetVehicles
  .SettingsFleetVehicles__head
    .SettingsFleetVehicles__head-left
      span.SettingsFleetVehicles__count {{ storeConfig.vehicles.length }} 種
    .SettingsFleetVehicles__head-actions
      button.SettingsFleetVehicles__reload-btn(
        :disabled="reloading"
        @click="ClickReload"
        title="從 Firestore 重新讀取最新車型列表（避免 stale tab 編輯到舊 docId）"
      ) {{ reloading ? '同步中…' : '↻ 重新整理' }}
      button.SettingsFleetVehicles__add-btn(@click="ClickOpenCreate") + 新增車型

  //- 列表
  .SettingsFleetVehicles__empty(v-if="storeConfig.vehicles.length === 0") 尚無車型，按上方「新增車型」開始設定

  .SettingsFleetVehicles__list(v-else)
    .SettingsFleetVehicles__row(v-for="v in storeConfig.vehicles" :key="v.id" :class="{ 'is-disabled': !v.enabled }")
      .SettingsFleetVehicles__row-main
        .SettingsFleetVehicles__row-name
          span.SettingsFleetVehicles__row-zh {{ v.label.zh }}
          span.SettingsFleetVehicles__row-id {{ '#' + v.id }}
          span.SettingsFleetVehicles__row-disabled-tag(v-if="!v.enabled") 已停用
        .SettingsFleetVehicles__row-meta
          span 載客 {{ v.capacity }} 人
          span ·
          span 起跳 NT$ {{ v.baseFare }}
          span ·
          span {{ v.perKmRate }}/km
          template(v-if="v.luggageDescription?.zh")
            span ·
            span {{ v.luggageDescription.zh }}
      .SettingsFleetVehicles__row-actions
        button.SettingsFleetVehicles__btn.is-toggle(
          :disabled="togglingId === v.id"
          @click="ClickToggleEnabled(v)"
        ) {{ v.enabled ? '停用' : '啟用' }}
        button.SettingsFleetVehicles__btn.is-edit(@click="ClickOpenEdit(v)") 編輯
        button.SettingsFleetVehicles__btn.is-delete(
          :disabled="deletingId === v.id"
          @click="ClickDelete(v)"
        ) 刪除

  //- 編輯 / 新增彈窗
  .SettingsFleetVehicles__mask(v-if="dialog.open" @click.self="ClickClose")
    .SettingsFleetVehicles__modal
      .SettingsFleetVehicles__modal-title
        | {{ dialog.mode === 'create' ? '新增車型' : `編輯車型「${form.labelZh || form.id}」` }}

      .SettingsFleetVehicles__modal-body
        //- ID（僅新增時可填）
        .SettingsFleetVehicles__field(v-if="dialog.mode === 'create'")
          label.SettingsFleetVehicles__label ID（doc id，小寫字母/數字/連字號）
          input.SettingsFleetVehicles__input(
            v-model="form.id"
            placeholder="例：sedan / suv / van"
            maxlength="50"
          )

        //- 三語 label
        .SettingsFleetVehicles__field-grid
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 中文名稱
            input.SettingsFleetVehicles__input(v-model="form.labelZh" maxlength="20" placeholder="例：轎車")
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 英文名稱
            input.SettingsFleetVehicles__input(v-model="form.labelEn" maxlength="30" placeholder="例：Sedan")
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 日文名稱
            input.SettingsFleetVehicles__input(v-model="form.labelJa" maxlength="30" placeholder="例：セダン")

        //- Booking v2：tagline 三語（情境文案；選填 — 三語都空 → 後端視為清除）
        .SettingsFleetVehicles__field-grid
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 情境文案（中）
            input.SettingsFleetVehicles__input(v-model="form.taglineZh" maxlength="40" placeholder="例：一般通勤 / 機場接送")
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 情境文案（英）
            input.SettingsFleetVehicles__input(v-model="form.taglineEn" maxlength="60" placeholder="例：Daily commute / Airport")
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 情境文案（日）
            input.SettingsFleetVehicles__input(v-model="form.taglineJa" maxlength="60" placeholder="例：通勤 / 空港送迎")

        //- 車卡圖庫（exterior 為卡片主圖；空字串 → 不送）
        .SettingsFleetVehicles__field-grid
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 外觀照 URL
            input.SettingsFleetVehicles__input(
              v-model="form.imageExterior"
              type="url"
              maxlength="2048"
              placeholder="https://... 卡片主圖"
            )
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 內裝照 URL
            input.SettingsFleetVehicles__input(
              v-model="form.imageInterior"
              type="url"
              maxlength="2048"
              placeholder="https://... lightbox"
            )
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 後車廂照 URL
            input.SettingsFleetVehicles__input(
              v-model="form.imageTrunk"
              type="url"
              maxlength="2048"
              placeholder="https://... lightbox"
            )

        //- 行李容量描述（取代 SU 數字；三語都空 → 不送）
        .SettingsFleetVehicles__field-grid
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 行李容量描述（中）
            input.SettingsFleetVehicles__input(
              v-model="form.luggageDescZh"
              maxlength="80"
              placeholder="例：4 人座 / 2 大 2 小行李 / 適合一般機場接送"
            )
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 行李容量描述（英）
            input.SettingsFleetVehicles__input(
              v-model="form.luggageDescEn"
              maxlength="120"
              placeholder="例：4 seats / 2 large + 2 small luggage / standard airport transfer"
            )
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 行李容量描述（日）
            input.SettingsFleetVehicles__input(
              v-model="form.luggageDescJa"
              maxlength="120"
              placeholder="例：4 人乗り / 大型 2 個＋小型 2 個 / 一般空港送迎"
            )

        //- 數值欄位
        .SettingsFleetVehicles__field-grid
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 載客上限（人）
            input.SettingsFleetVehicles__input(
              v-model.number="form.capacity"
              type="number"
              min="1"
              inputmode="numeric"
            )
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 起跳費 (NT$)
            input.SettingsFleetVehicles__input(
              v-model.number="form.baseFare"
              type="number"
              min="0"
              inputmode="numeric"
            )
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 每公里 (NT$/km)
            input.SettingsFleetVehicles__input(
              v-model.number="form.perKmRate"
              type="number"
              min="0"
              inputmode="numeric"
            )

        //- icon + sortOrder + enabled
        .SettingsFleetVehicles__field-grid
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label icon（mdi 字串）
            input.SettingsFleetVehicles__input(
              v-model="form.icon"
              maxlength="60"
              placeholder="例：mdi:car / mdi:van-passenger"
            )
          .SettingsFleetVehicles__field
            label.SettingsFleetVehicles__label 排序（小→大）
            input.SettingsFleetVehicles__input(
              v-model.number="form.sortOrder"
              type="number"
              inputmode="numeric"
            )
          .SettingsFleetVehicles__field.is-toggle-row
            label.SettingsFleetVehicles__label 啟用
            button.SettingsFleetVehicles__switch(
              :class="{ 'is-on': form.enabled }"
              @click="form.enabled = !form.enabled"
              type="button"
            )
              span.SettingsFleetVehicles__switch-thumb

        //- Charter Fare V1：包車套餐（3 個 plan card，可摺疊）
        .SettingsFleetVehicles__charter
          button.SettingsFleetVehicles__charter-toggle(
            type="button"
            :class="{ 'is-open': form.showCharter }"
            @click="form.showCharter = !form.showCharter"
          )
            span.SettingsFleetVehicles__charter-toggle-label 包車套餐（charter fare v1）
            span.SettingsFleetVehicles__charter-toggle-hint {{ form.showCharter ? '收起' : '展開' }}
          template(v-if="form.showCharter")
            .SettingsFleetVehicles__charter-hint
              | 三檔可獨立啟用；至少 1 個 enabled 才會套包車計費，全停用 → charter 訂單 fallback fare-v2。
            .SettingsFleetVehicles__charter-copy
              span.SettingsFleetVehicles__charter-copy-label 從其他車型複製
              ElSelect(
                v-model="form.charterCopySourceId"
                placeholder="選擇來源車型"
                clearable
                value-on-clear=""
                style="flex:1;min-width:160px"
              )
                ElOption(
                  v-for="src in storeConfig.vehicles.filter((vv) => vv.id !== form.id && vv.charterPlans)"
                  :key="src.id"
                  :label="src.label.zh"
                  :value="src.id"
                )
              button.SettingsFleetVehicles__btn.is-toggle(
                type="button"
                :disabled="!form.charterCopySourceId"
                @click="ClickCopyCharterPlans"
              ) 複製套餐
            .SettingsFleetVehicles__plan-grid
              .SettingsFleetVehicles__plan(
                v-for="k in CHARTER_PLAN_KEYS"
                :key="k"
                :class="{ 'is-on': form.charterPlans[k].enabled }"
              )
                .SettingsFleetVehicles__plan-head
                  span.SettingsFleetVehicles__plan-title {{ k }}（{{ CHARTER_PLAN_KEY_TO_HOURS[k] }} 小時）
                  button.SettingsFleetVehicles__switch.is-small(
                    type="button"
                    :class="{ 'is-on': form.charterPlans[k].enabled }"
                    @click="form.charterPlans[k].enabled = !form.charterPlans[k].enabled"
                  )
                    span.SettingsFleetVehicles__switch-thumb
                .SettingsFleetVehicles__plan-field
                  label.SettingsFleetVehicles__label basePrice (NT$)
                  input.SettingsFleetVehicles__input(
                    v-model.number="form.charterPlans[k].basePrice"
                    type="number"
                    min="0"
                    inputmode="numeric"
                  )
                .SettingsFleetVehicles__plan-field
                  label.SettingsFleetVehicles__label includedKm
                  input.SettingsFleetVehicles__input(
                    v-model.number="form.charterPlans[k].includedKm"
                    type="number"
                    min="0"
                    inputmode="numeric"
                  )
                .SettingsFleetVehicles__plan-field
                  label.SettingsFleetVehicles__label extraKm (NT$/km)
                  input.SettingsFleetVehicles__input(
                    v-model.number="form.charterPlans[k].extraKmRate"
                    type="number"
                    min="0"
                    inputmode="numeric"
                  )
                .SettingsFleetVehicles__plan-field
                  label.SettingsFleetVehicles__label OT 30min (NT$)
                  input.SettingsFleetVehicles__input(
                    v-model.number="form.charterPlans[k].overtimeRatePer30min"
                    type="number"
                    min="0"
                    inputmode="numeric"
                  )

        .SettingsFleetVehicles__error(v-if="dialog.error") ⚠️ {{ dialog.error }}

      .SettingsFleetVehicles__modal-foot
        button.SettingsFleetVehicles__action.is-secondary(
          :disabled="dialog.saving"
          @click="ClickClose"
        ) 取消
        button.SettingsFleetVehicles__action.is-primary(
          :disabled="dialog.saving"
          @click="ClickSave"
        ) {{ dialog.saving ? '儲存中...' : '儲存' }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.4);
$border: rgba(255, 255, 255, 0.08);
$surface: rgba(255, 255, 255, 0.04);
$surface-2: rgba(255, 255, 255, 0.08);

.SettingsFleetVehicles {
  display: flex;
  flex-direction: column;
}

.SettingsFleetVehicles__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid $border;
}

.SettingsFleetVehicles__count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $muted;
}

.SettingsFleetVehicles__head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.SettingsFleetVehicles__reload-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #fff; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.SettingsFleetVehicles__add-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba($amber, 0.12);
  border: 1px solid rgba($amber, 0.4);
  color: $amber;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba($amber, 0.22); }
}

.SettingsFleetVehicles__empty {
  padding: 24px 16px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  text-align: center;
}

.SettingsFleetVehicles__list {
  display: flex;
  flex-direction: column;
}

.SettingsFleetVehicles__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s;

  &:last-child { border-bottom: none; }
  &:hover { background: rgba(255, 255, 255, 0.02); }
  &.is-disabled { opacity: 0.5; }
}

.SettingsFleetVehicles__row-main {
  flex: 1;
  min-width: 0;
}

.SettingsFleetVehicles__row-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.SettingsFleetVehicles__row-zh {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.SettingsFleetVehicles__row-id {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: $muted;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid $border;
  border-radius: 100px;
  padding: 1px 8px;
}

.SettingsFleetVehicles__row-disabled-tag {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 100, 100, 0.85);
  background: rgba(255, 80, 80, 0.1);
  border: 1px solid rgba(255, 80, 80, 0.3);
  border-radius: 100px;
  padding: 1px 8px;
}

.SettingsFleetVehicles__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.SettingsFleetVehicles__row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.SettingsFleetVehicles__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-toggle {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.7);
    &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #fff; }
  }

  &.is-edit {
    background: rgba($amber, 0.1);
    border-color: rgba($amber, 0.35);
    color: $amber;
    &:hover:not(:disabled) { background: rgba($amber, 0.2); }
  }

  &.is-delete {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.35);
    color: #f87171;
    &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
  }
}

// ── Modal ────────────────────────────────────────────────
.SettingsFleetVehicles__mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.SettingsFleetVehicles__modal {
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.SettingsFleetVehicles__modal-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.06em;
  color: #fff;
  padding: 20px 22px 14px;
  border-bottom: 1px solid $border;
}

.SettingsFleetVehicles__modal-body {
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.SettingsFleetVehicles__field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

@media (max-width: 599.98px) {
  .SettingsFleetVehicles__field-grid { grid-template-columns: 1fr 1fr; }
}

.SettingsFleetVehicles__field {
  display: flex;
  flex-direction: column;
  gap: 5px;

  &.is-toggle-row {
    align-items: flex-start;
    justify-content: flex-start;
  }
}

.SettingsFleetVehicles__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: $muted;
}

.SettingsFleetVehicles__input {
  width: 100%;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &::placeholder { color: rgba(255, 255, 255, 0.2); }
  &:focus { border-color: rgba($amber, 0.4); }
}

.SettingsFleetVehicles__switch {
  width: 44px;
  height: 24px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  padding: 2px;
  cursor: pointer;
  transition: background 0.18s;
  position: relative;

  &.is-on {
    background: rgba($amber, 0.7);
    border-color: rgba($amber, 0.9);

    .SettingsFleetVehicles__switch-thumb { transform: translateX(20px); }
  }
}

.SettingsFleetVehicles__switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.18s;
}

.SettingsFleetVehicles__switch.is-small {
  width: 38px;
  height: 22px;

  .SettingsFleetVehicles__switch-thumb {
    width: 16px;
    height: 16px;
  }

  &.is-on .SettingsFleetVehicles__switch-thumb {
    transform: translateX(16px);
  }
}

// ── Charter Fare V1：包車套餐 section ─────────────────────────────────────
.SettingsFleetVehicles__charter {
  border-top: 1px dashed $border;
  padding-top: 14px;
  margin-top: 2px;
}

.SettingsFleetVehicles__charter-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.06); }
  &.is-open {
    background: rgba($amber, 0.08);
    border-color: rgba($amber, 0.35);
  }
}

.SettingsFleetVehicles__charter-toggle-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.SettingsFleetVehicles__charter-toggle-hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.SettingsFleetVehicles__charter-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  padding: 10px 2px 6px;
  line-height: 1.5;
}

.SettingsFleetVehicles__charter-copy {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px 10px;
  flex-wrap: wrap;
}

.SettingsFleetVehicles__charter-copy-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: $muted;
}

.SettingsFleetVehicles__plan-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 699.98px) {
  .SettingsFleetVehicles__plan-grid { grid-template-columns: 1fr; }
}

.SettingsFleetVehicles__plan {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.02);
  transition: border-color 0.15s, background 0.15s;

  &.is-on {
    border-color: rgba($amber, 0.45);
    background: rgba($amber, 0.06);
  }
}

.SettingsFleetVehicles__plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.SettingsFleetVehicles__plan-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.85);
}

.SettingsFleetVehicles__plan-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.SettingsFleetVehicles__error {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 200, 0, 0.85);
  background: rgba(255, 200, 0, 0.08);
  border: 1px solid rgba(255, 200, 0, 0.25);
  border-radius: 8px;
  padding: 8px 12px;
}

.SettingsFleetVehicles__modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
  border-top: 1px solid $border;
}

.SettingsFleetVehicles__action {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: $amber;
    color: #fff;
    &:hover:not(:disabled) { background: darken($amber, 6%); }
  }

  &.is-secondary {
    background: $surface;
    color: rgba(255, 255, 255, 0.7);
    border-color: $border;
    &:hover:not(:disabled) { background: $surface-2; }
  }
}
</style>
