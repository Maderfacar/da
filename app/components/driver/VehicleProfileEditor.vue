<script setup lang="ts">
// Phase 1B：driver 車輛 Profile 編輯器
//
// - 上方「司機能力」section：driverSkill TagGroupPicker，change 立即 PatchDriverTags
// - 下方「車輛 Profile」section：
//   - status badge（unverified / draft / pending_review / rejected / verified）
//   - 5 個 vehicle-scope group picker（單/多選 chip）+ photo grid（最多 8）
//   - 按鈕：依 status 顯示 送審 / 捨棄 / 撤回 / 重新編輯
//
// 規格：driver 端文字維持繁中（議題 #14）。
import { TAG_GROUPS_ORDERED, type TagGroup, localizedTagName } from '~shared/tagTaxonomy';
import { MAX_PHOTOS } from '~shared/vehicleProfile';
import { computeSU } from '~shared/luggageSU';
import type { TagDto } from '@/protocol/fetch-api/api/tag';
import type { VehicleProfileDto, VehicleProfilePendingDto } from '@/protocol/fetch-api/api/admin';
import type { VehicleCapacityDto, PatchVehicleCapacityBody, SeatConfig } from '@/protocol/fetch-api/api/driver';

interface Props {
  driverTags: string[];
  vehicleProfile: VehicleProfileDto | null;
  pending: VehicleProfilePendingDto | null;
  vehicleCapacity: VehicleCapacityDto | null;
}
const props = defineProps<Props>();
const emit = defineEmits<{ refresh: [] }>();

// ── tag 載入 ────────────────────────────────────────────
const allTags = ref<TagDto[]>([]);
const loadingTags = ref(false);

const ApiLoadTags = async () => {
  loadingTags.value = true;
  try {
    const res = await $api.GetActiveTags();
    if (res.status?.code === $enum.apiStatus.success && res.data?.tags) {
      allTags.value = res.data.tags;
    } else {
      allTags.value = [];
    }
  } finally {
    loadingTags.value = false;
  }
};

const tagsByGroup = (group: TagGroup): TagDto[] =>
  allTags.value.filter((t) => t.group === group);

// driver-scope groups（只 driverSkill；過濾自 TAG_GROUPS_ORDERED）
const driverGroups = TAG_GROUPS_ORDERED
  .filter(([, m]) => m.scope === 'driver')
  .map(([g]) => g);

const vehicleGroups = TAG_GROUPS_ORDERED
  .filter(([, m]) => m.scope === 'vehicle')
  .map(([g]) => g);

// ── driver-scope tags：立即生效 ────────────────────────
// 把 driver.tags 拆成各 group 的 modelValue
const driverTagsByGroup = computed(() => {
  const map = new Map<TagGroup, string[]>();
  for (const g of driverGroups) {
    const idsInGroup = tagsByGroup(g).map((t) => t.id);
    map.set(g, props.driverTags.filter((id) => idsInGroup.includes(id)));
  }
  return map;
});

const savingDriverTags = ref(false);

const ApiUpdateDriverTags = async (group: TagGroup, next: string[]) => {
  // 重組整個 driver.tags：先濾掉該 group 的舊 id，再 concat new
  const idsInGroup = tagsByGroup(group).map((t) => t.id);
  const keep = props.driverTags.filter((id) => !idsInGroup.includes(id));
  const merged = [...keep, ...next];

  savingDriverTags.value = true;
  try {
    const res = await $api.PatchDriverTags({ tags: merged });
    if (res.status?.code === $enum.apiStatus.success) {
      ElMessage({ message: '已更新司機能力標籤', type: 'success' });
      emit('refresh');
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '更新失敗', type: 'error' });
    }
  } finally {
    savingDriverTags.value = false;
  }
};

// ── vehicle-scope：local 編輯狀態（autosave 進 pending）─────
// 起始值：pending 優先，否則 current，否則空
const localTags = ref<string[]>([]);
const localPhotos = ref<string[]>([]);
const savingPending = ref(false);
const uploadingPhoto = ref(false);

const _resetLocal = () => {
  const base = props.pending ?? props.vehicleProfile ?? null;
  localTags.value = base?.tags ? [...base.tags] : [];
  localPhotos.value = base?.photos ? [...base.photos] : [];
};

watch(() => [props.pending, props.vehicleProfile], _resetLocal, { immediate: true });

const localTagsByGroup = computed(() => {
  const map = new Map<TagGroup, string[]>();
  for (const g of vehicleGroups) {
    const idsInGroup = tagsByGroup(g).map((t) => t.id);
    map.set(g, localTags.value.filter((id) => idsInGroup.includes(id)));
  }
  return map;
});

// 是否目前無法編輯（status='pending_review'）
const isLocked = computed(() => props.pending?.status === 'pending_review');

const ApiSavePending = async (overrides?: { tags?: string[]; photos?: string[] }) => {
  if (isLocked.value) return;
  savingPending.value = true;
  try {
    const body: { tags?: string[]; photos?: string[] } = {};
    if (overrides?.tags !== undefined) body.tags = overrides.tags;
    else body.tags = localTags.value;
    if (overrides?.photos !== undefined) body.photos = overrides.photos;
    else body.photos = localPhotos.value;
    const res = await $api.PatchVehicleProfile(body);
    if (res.status?.code === $enum.apiStatus.success) {
      emit('refresh');
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '儲存失敗', type: 'error' });
    }
  } finally {
    savingPending.value = false;
  }
};

const HandleVehicleTagChange = (group: TagGroup, next: string[]) => {
  if (isLocked.value) return;
  const idsInGroup = tagsByGroup(group).map((t) => t.id);
  const keep = localTags.value.filter((id) => !idsInGroup.includes(id));
  const merged = [...keep, ...next];
  localTags.value = merged;
  void ApiSavePending({ tags: merged });
};

// ── photo upload ───────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null);

const ClickPickPhoto = () => {
  if (isLocked.value) return;
  if (localPhotos.value.length >= MAX_PHOTOS) {
    ElMessage({ message: `最多 ${MAX_PHOTOS} 張`, type: 'warning' });
    return;
  }
  fileInput.value?.click();
};

const ChangePhoto = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (target) target.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    ElMessage({ message: '檔案超過 5MB', type: 'warning' });
    return;
  }
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
    ElMessage({ message: '僅支援 jpg / png / webp', type: 'warning' });
    return;
  }
  uploadingPhoto.value = true;
  try {
    const upRes = await $api.UploadVehiclePhoto(file);
    if (upRes.status.code !== 200 || !upRes.data?.url) {
      ElMessage({ message: upRes.status.message.zh_tw ?? '上傳失敗', type: 'error' });
      return;
    }
    const nextPhotos = [...localPhotos.value, upRes.data.url];
    localPhotos.value = nextPhotos;
    await ApiSavePending({ photos: nextPhotos });
  } finally {
    uploadingPhoto.value = false;
  }
};

const ClickRemovePhoto = async (idx: number) => {
  if (isLocked.value) return;
  const ok = await UseAsk('確定移除這張照片？');
  if (!ok) return;
  const nextPhotos = localPhotos.value.filter((_, i) => i !== idx);
  localPhotos.value = nextPhotos;
  await ApiSavePending({ photos: nextPhotos });
};

// ── 送審 / 捨棄 / 撤回 / 重新編輯 ──────────────────────
const submitting = ref(false);

const ClickSubmit = async () => {
  const ok = await UseAsk('確定送出本次變更給 admin 審核？');
  if (!ok) return;
  submitting.value = true;
  try {
    const res = await $api.SubmitVehicleProfile();
    if (res.status?.code === $enum.apiStatus.success) {
      ElMessage({ message: '已送審，請等待 admin 審核', type: 'success' });
      emit('refresh');
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '送審失敗', type: 'error' });
    }
  } finally {
    submitting.value = false;
  }
};

const ClickDiscard = async () => {
  const ok = await UseAsk('確定捨棄所有未送審變更？');
  if (!ok) return;
  const res = await $api.DiscardVehicleProfile();
  if (res.status?.code === $enum.apiStatus.success) {
    ElMessage({ message: '已捨棄草稿', type: 'success' });
    emit('refresh');
  } else {
    ElMessage({ message: res.status?.message?.zh_tw ?? '操作失敗', type: 'error' });
  }
};

const ClickWithdraw = async () => {
  const ok = await UseAsk('撤回送審後 admin 將不再審核此次提交。確定撤回？');
  if (!ok) return;
  const res = await $api.DiscardVehicleProfile();
  if (res.status?.code === $enum.apiStatus.success) {
    ElMessage({ message: '已撤回送審', type: 'success' });
    emit('refresh');
  } else {
    ElMessage({ message: res.status?.message?.zh_tw ?? '操作失敗', type: 'error' });
  }
};

const ClickReedit = async () => {
  // 複製 current → pending（status='draft'）
  if (!props.vehicleProfile) return;
  const res = await $api.PatchVehicleProfile({
    photos: props.vehicleProfile.photos,
    tags: props.vehicleProfile.tags,
  });
  if (res.status?.code === $enum.apiStatus.success) {
    ElMessage({ message: '已開啟新草稿，可以開始編輯', type: 'success' });
    emit('refresh');
  } else {
    ElMessage({ message: res.status?.message?.zh_tw ?? '操作失敗', type: 'error' });
  }
};

// ── status 文案 ────────────────────────────────────────
const status = computed(() => props.pending?.status ?? null);

const statusLabel = computed(() => {
  if (status.value === 'pending_review') return '審核中';
  if (status.value === 'draft') return '草稿（未送審）';
  if (status.value === 'rejected') return '審核退回';
  if (props.vehicleProfile && !props.pending) return '已驗證';
  return '尚未提交審核';
});

const statusVariant = computed(() => {
  if (status.value === 'pending_review') return 'pending';
  if (status.value === 'rejected') return 'rejected';
  if (status.value === 'draft') return 'draft';
  if (props.vehicleProfile && !props.pending) return 'verified';
  return 'none';
});

// IsPdf helper for thumbnails (vehicle photos 預期不會是 pdf；保險用)
const IsImage = (url: string) =>
  /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url) || !/\.pdf(\?|$)/i.test(url);

const tagDtoMap = computed(() => {
  const m = new Map<string, TagDto>();
  for (const t of allTags.value) m.set(t.id, t);
  return m;
});

const TagName = (id: string) => {
  const t = tagDtoMap.value.get(id);
  return t ? localizedTagName(t, 'zh_tw') : id;
};

onMounted(ApiLoadTags);

// ── 車輛載運容量（立即生效）────────────────────────────────
const localLiters = ref<number | null>(null);
const localSeatConfigs = reactive<SeatConfig[]>([]);
const hasSeatConfigs = ref(false);
const savingCapacity = ref(false);

const previewSU = computed(() => {
  if (localLiters.value === null || localLiters.value <= 0) return null;
  return computeSU(localLiters.value);
});

watch(() => props.vehicleCapacity, (cap) => {
  localLiters.value = cap?.trunkVolumeLiters ?? null;
  localSeatConfigs.splice(0, localSeatConfigs.length, ...(cap?.seatConfigs?.map(c => ({ ...c })) ?? []));
  hasSeatConfigs.value = !!cap?.seatConfigs?.length;
}, { immediate: true });

const ApiSaveVehicleCapacity = async () => {
  if (localLiters.value === null || localLiters.value <= 0) {
    ElMessage({ message: '請輸入有效的行李廂容積（公升）', type: 'warning' });
    return;
  }
  savingCapacity.value = true;
  try {
    const body: PatchVehicleCapacityBody = { trunkVolumeLiters: localLiters.value };
    if (hasSeatConfigs.value && localSeatConfigs.length) {
      body.seatConfigs = [...localSeatConfigs];
    }
    const res = await $api.PatchVehicleCapacity(body);
    if (res.status?.code === $enum.apiStatus.success) {
      ElMessage({ message: `已儲存，載運容量 ${res.data.derivedLuggageSU} SU`, type: 'success' });
      emit('refresh');
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '儲存失敗', type: 'error' });
    }
  } finally {
    savingCapacity.value = false;
  }
};

const AddSeatConfig = () => {
  if (localSeatConfigs.length >= 3) return;
  localSeatConfigs.push({ label: '', passengerCapacity: 4, luggageSU: 2 });
};

const RemoveSeatConfig = (idx: number) => {
  localSeatConfigs.splice(idx, 1);
};

defineExpose({ reloadTags: ApiLoadTags });
</script>

<template lang="pug">
.VehicleProfileEditor
  //- 司機能力（driver-scope）—— 立即生效
  .VehicleProfileEditor__block
    .VehicleProfileEditor__block-head
      .VehicleProfileEditor__block-title 司機能力標籤
      .VehicleProfileEditor__block-sub 變更立即生效，不需審核
    template(v-if="loadingTags")
      .VehicleProfileEditor__loading 載入標籤中…
    template(v-else)
      .VehicleProfileEditor__group(v-for="g in driverGroups" :key="g")
        DriverTagGroupPicker(
          :group="g"
          :tags="tagsByGroup(g)"
          :model-value="driverTagsByGroup.get(g) ?? []"
          :disabled="savingDriverTags"
          @update:model-value="(v: string[]) => ApiUpdateDriverTags(g, v)"
        )

  //- 車輛 Profile（vehicle-scope）—— 送審制
  .VehicleProfileEditor__block
    .VehicleProfileEditor__block-head
      .VehicleProfileEditor__block-title 車輛資料
      .VehicleProfileEditor__block-sub 標籤與照片變更需 admin 審核後生效
      .VehicleProfileEditor__badge(:class="`is-${statusVariant}`") {{ statusLabel }}

    .VehicleProfileEditor__reject(v-if="status === 'rejected' && pending?.rejectReason")
      .VehicleProfileEditor__reject-title 退回原因
      .VehicleProfileEditor__reject-body {{ pending.rejectReason }}

    template(v-if="loadingTags")
      .VehicleProfileEditor__loading 載入標籤中…
    template(v-else)
      .VehicleProfileEditor__group(v-for="g in vehicleGroups" :key="g")
        DriverTagGroupPicker(
          :group="g"
          :tags="tagsByGroup(g)"
          :model-value="localTagsByGroup.get(g) ?? []"
          :disabled="isLocked || savingPending"
          @update:model-value="(v: string[]) => HandleVehicleTagChange(g, v)"
        )

    //- photo grid
    .VehicleProfileEditor__photos
      .VehicleProfileEditor__photos-head
        .VehicleProfileEditor__photos-title 車輛照片
        .VehicleProfileEditor__photos-hint 最多 {{ MAX_PHOTOS }} 張，每張 ≤ 5 MB（jpg / png / webp）
      .VehicleProfileEditor__photo-grid
        .VehicleProfileEditor__photo(
          v-for="(url, idx) in localPhotos"
          :key="url + '-' + idx"
        )
          img.VehicleProfileEditor__photo-img(
            v-if="IsImage(url)"
            :src="url"
            alt="vehicle"
          )
          .VehicleProfileEditor__photo-fallback(v-else) 圖片
          button.VehicleProfileEditor__photo-remove(
            v-if="!isLocked"
            type="button"
            @click="ClickRemovePhoto(idx)"
          ) ×
        button.VehicleProfileEditor__photo-add(
          v-if="!isLocked && localPhotos.length < MAX_PHOTOS"
          type="button"
          :disabled="uploadingPhoto"
          @click="ClickPickPhoto"
        ) {{ uploadingPhoto ? '上傳中…' : '+ 新增照片' }}
        input.VehicleProfileEditor__photo-input(
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          @change="ChangePhoto"
        )

    //- 動作列
    .VehicleProfileEditor__actions
      //- pending_review：撤回
      template(v-if="status === 'pending_review'")
        .VehicleProfileEditor__hint-line 草稿審核中，無法編輯
        button.VehicleProfileEditor__btn.is-secondary(@click="ClickWithdraw") 撤回送審
      //- draft / rejected：送審 + 捨棄
      template(v-else-if="status === 'draft' || status === 'rejected'")
        button.VehicleProfileEditor__btn.is-primary(
          :disabled="submitting"
          @click="ClickSubmit"
        ) {{ submitting ? '送審中…' : '送審' }}
        button.VehicleProfileEditor__btn.is-secondary(@click="ClickDiscard") 捨棄變更
      //- verified（無 pending）：重新編輯
      template(v-else-if="vehicleProfile && !pending")
        .VehicleProfileEditor__current-summary
          template(v-if="vehicleProfile.tags.length")
            span.VehicleProfileEditor__tag-chip(
              v-for="t in vehicleProfile.tags"
              :key="t"
            ) {{ TagName(t) }}
          template(v-else)
            .VehicleProfileEditor__empty 目前無已驗證的標籤
        button.VehicleProfileEditor__btn.is-secondary(@click="ClickReedit") 重新編輯
      //- 完全沒資料：提示開始
      template(v-else)
        .VehicleProfileEditor__hint-line 選擇標籤或新增照片後，點「送審」交給 admin 審核
        button.VehicleProfileEditor__btn.is-primary(
          :disabled="submitting"
          @click="ClickSubmit"
        ) {{ submitting ? '送審中…' : '送審' }}

  //- 車輛載運容量（立即生效）
  .VehicleProfileEditor__block
    .VehicleProfileEditor__block-head
      .VehicleProfileEditor__block-title 車輛載運容量
      .VehicleProfileEditor__block-sub 設定後立即生效，乘客可依此安排行李
    .VehicleProfileEditor__capacity
      .VehicleProfileEditor__capacity-row
        label.VehicleProfileEditor__capacity-label 行李廂容積（公升）
        el-input-number.VehicleProfileEditor__capacity-input(
          v-model="localLiters"
          :min="1"
          :max="2000"
          :step="10"
          :precision="0"
          inputmode="numeric"
          placeholder="例：250"
        )
        .VehicleProfileEditor__capacity-su(v-if="previewSU !== null")
          span.VehicleProfileEditor__capacity-su-val {{ previewSU }}
          span.VehicleProfileEditor__capacity-su-label  SU
      .VehicleProfileEditor__capacity-hint 1 SU ≈ 48L（20" 登機箱）；系統扣除 20% 死角空間後換算
    .VehicleProfileEditor__seat-toggle
      el-switch(
        v-model="hasSeatConfigs"
        active-text="宣告彈性座椅配置"
      )
    template(v-if="hasSeatConfigs")
      .VehicleProfileEditor__seat-list
        .VehicleProfileEditor__seat-item(v-for="(cfg, idx) in localSeatConfigs" :key="idx")
          el-input.VehicleProfileEditor__seat-label(
            v-model="localSeatConfigs[idx].label"
            placeholder="模式名稱，例：折座模式"
            maxlength="20"
          )
          el-input-number.VehicleProfileEditor__seat-pax(
            v-model="localSeatConfigs[idx].passengerCapacity"
            :min="1"
            :max="9"
            :precision="0"
            controls-position="right"
            inputmode="numeric"
          )
          span.VehicleProfileEditor__seat-sep 人
          el-input-number.VehicleProfileEditor__seat-su(
            v-model="localSeatConfigs[idx].luggageSU"
            :min="1"
            :max="30"
            :precision="0"
            controls-position="right"
            inputmode="numeric"
          )
          span.VehicleProfileEditor__seat-sep SU
          button.VehicleProfileEditor__seat-remove(type="button" @click="RemoveSeatConfig(idx)") ×
        button.VehicleProfileEditor__seat-add(
          v-if="localSeatConfigs.length < 3"
          type="button"
          @click="AddSeatConfig"
        ) + 新增模式
    .VehicleProfileEditor__capacity-actions
      button.VehicleProfileEditor__btn.is-primary(
        :disabled="savingCapacity || previewSU === null"
        @click="ApiSaveVehicleCapacity"
      ) {{ savingCapacity ? '儲存中…' : '儲存容量設定' }}
      .VehicleProfileEditor__capacity-current(v-if="vehicleCapacity")
        | 目前：{{ vehicleCapacity.trunkVolumeLiters }}L → {{ vehicleCapacity.derivedLuggageSU }} SU
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$muted: rgba(255, 255, 255, 0.4);
$danger: #f87171;

.VehicleProfileEditor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.VehicleProfileEditor__block {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.VehicleProfileEditor__block-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.VehicleProfileEditor__block-title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.VehicleProfileEditor__block-sub {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
  flex: 1;
}

.VehicleProfileEditor__badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 3px 10px;
  border-radius: 100px;

  &.is-pending  { background: rgba(255, 200, 0, 0.12);  border: 1px solid rgba(255, 200, 0, 0.4);  color: #f5c518; }
  &.is-rejected { background: rgba(248, 113, 113, 0.12); border: 1px solid rgba($danger, 0.4); color: $danger; }
  &.is-draft    { background: rgba($amber, 0.12);       border: 1px solid rgba($amber, 0.35);  color: $amber; }
  &.is-verified { background: rgba(80, 200, 120, 0.12); border: 1px solid rgba(80, 200, 120, 0.4); color: #50c878; }
  &.is-none     { background: rgba(255, 255, 255, 0.05); border: 1px solid $border; color: $muted; }
}

.VehicleProfileEditor__group {
  margin-top: 4px;
}

.VehicleProfileEditor__loading {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: $muted;
  padding: 12px 0;
}

.VehicleProfileEditor__reject {
  background: rgba($danger, 0.08);
  border: 1px solid rgba($danger, 0.3);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: $danger;
  }
  &-body {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.85);
    line-height: 1.5;
  }
}

.VehicleProfileEditor__photos {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed $border;
  padding-top: 12px;
  margin-top: 4px;
}

.VehicleProfileEditor__photos-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.VehicleProfileEditor__photos-title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.VehicleProfileEditor__photos-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 10px;
  color: $muted;
}

.VehicleProfileEditor__photo-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

@media (max-width: 479.98px) {
  .VehicleProfileEditor__photo-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.VehicleProfileEditor__photo {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid $border;
}

.VehicleProfileEditor__photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.VehicleProfileEditor__photo-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: $muted;
}

.VehicleProfileEditor__photo-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba($danger, 0.4);
  background: rgba(0, 0, 0, 0.6);
  color: $danger;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;

  &:hover { background: rgba($danger, 0.2); }
}

.VehicleProfileEditor__photo-add {
  aspect-ratio: 4 / 3;
  border: 1.5px dashed rgba($amber, 0.45);
  background: rgba($amber, 0.06);
  color: $amber;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 10px;
  transition: background 0.15s;

  &:hover:not(:disabled) { background: rgba($amber, 0.14); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.VehicleProfileEditor__photo-input { display: none; }

.VehicleProfileEditor__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}

.VehicleProfileEditor__hint-line {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: $muted;
  flex: 1 1 100%;
}

.VehicleProfileEditor__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 8px 18px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid;
  transition: background 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.18);
    color: $amber;
    &:hover:not(:disabled) { background: rgba($amber, 0.28); }
  }
  &.is-secondary {
    border-color: $border;
    background: $surface;
    color: rgba(255, 255, 255, 0.7);
    &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
  }
}

.VehicleProfileEditor__current-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.VehicleProfileEditor__tag-chip {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 100px;
  background: rgba(80, 200, 120, 0.12);
  border: 1px solid rgba(80, 200, 120, 0.3);
  color: #50c878;
}

.VehicleProfileEditor__empty {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
}

.VehicleProfileEditor__capacity {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.VehicleProfileEditor__capacity-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.VehicleProfileEditor__capacity-label {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  min-width: 120px;
}

.VehicleProfileEditor__capacity-input {
  width: 130px;
}

.VehicleProfileEditor__capacity-su {
  display: flex;
  align-items: baseline;
  gap: 2px;
  padding: 4px 12px;
  background: rgba(80, 200, 120, 0.1);
  border: 1px solid rgba(80, 200, 120, 0.3);
  border-radius: 8px;
}

.VehicleProfileEditor__capacity-su-val {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #50c878;
}

.VehicleProfileEditor__capacity-su-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: rgba(80, 200, 120, 0.8);
}

.VehicleProfileEditor__capacity-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 10px;
  color: $muted;
}

.VehicleProfileEditor__seat-toggle {
  padding-top: 4px;
}

.VehicleProfileEditor__seat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.VehicleProfileEditor__seat-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.VehicleProfileEditor__seat-label {
  flex: 1;
  min-width: 120px;
}

.VehicleProfileEditor__seat-pax,
.VehicleProfileEditor__seat-su {
  width: 100px;
}

.VehicleProfileEditor__seat-sep {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: $muted;
}

.VehicleProfileEditor__seat-remove {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid rgba($danger, 0.4);
  background: transparent;
  color: $danger;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;

  &:hover { background: rgba($danger, 0.15); }
}

.VehicleProfileEditor__seat-add {
  align-self: flex-start;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 5px 14px;
  border: 1.5px dashed rgba($amber, 0.4);
  background: rgba($amber, 0.05);
  color: $amber;
  cursor: pointer;
  border-radius: 8px;
  margin-top: 2px;

  &:hover { background: rgba($amber, 0.12); }
}

.VehicleProfileEditor__capacity-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px dashed $border;
}

.VehicleProfileEditor__capacity-current {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: $muted;
}
</style>
