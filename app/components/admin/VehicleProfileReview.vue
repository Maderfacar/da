<script setup lang="ts">
// Phase 1B：admin 端 — 司機車輛 Profile 審核（左 current / 右 pending diff + approve/reject）
//
// 本元件不負責 admin 守衛；server endpoint 已檢 hasPermission(canManageDrivers)。
import { TAG_GROUPS_ORDERED, type TagGroup, localizedTagName } from '~shared/tagTaxonomy';
import type {
  VehicleProfileDto,
  VehicleProfilePendingDto,
} from '@/protocol/fetch-api/api/admin';
import type { TagDto } from '@/protocol/fetch-api/api/tag';

interface Props {
  uid: string;
  current: VehicleProfileDto | null;
  pending: VehicleProfilePendingDto | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  tagIndex: Map<string, TagDto>;
}
const props = defineProps<Props>();
const emit = defineEmits<{ refresh: [] }>();

const vehicleGroups = TAG_GROUPS_ORDERED
  .filter(([, m]) => m.scope === 'vehicle')
  .map(([g]) => g);

const TagName = (id: string): string => {
  const t = props.tagIndex.get(id);
  return t ? localizedTagName(t, 'zh_tw') : id;
};

const groupOfTag = (id: string): TagGroup | null => {
  return props.tagIndex.get(id)?.group ?? null;
};

const TagsForGroup = (tags: string[] | undefined, group: TagGroup): string[] => {
  if (!tags) return [];
  return tags.filter((id) => groupOfTag(id) === group);
};

const FormatTime = (iso: string | null): string =>
  iso ? $dayjs(iso).format('YYYY/MM/DD HH:mm') : '—';

const IsImage = (url: string) =>
  /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url) || !/\.pdf(\?|$)/i.test(url);

// ── approve / reject ────────────────────────────────────
const submitting = ref(false);
const showReject = ref(false);
const rejectReason = ref('');

const ClickApprove = async () => {
  const ok = await UseAsk('確定核准？此標籤組與照片將取代目前 verified 內容。');
  if (!ok) return;
  submitting.value = true;
  try {
    const res = await $api.PostVehicleProfileReview(props.uid, { decision: 'approve' });
    if (res.status?.code === $enum.apiStatus.success) {
      ElMessage({ message: '已核准，已通知司機', type: 'success' });
      emit('refresh');
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '操作失敗', type: 'error' });
    }
  } finally {
    submitting.value = false;
  }
};

const ClickShowReject = () => {
  rejectReason.value = '';
  showReject.value = true;
};

const ClickCancelReject = () => {
  showReject.value = false;
  rejectReason.value = '';
};

const ClickConfirmReject = async () => {
  const r = rejectReason.value.trim();
  if (!r) {
    ElMessage({ message: '請填寫退回原因', type: 'warning' });
    return;
  }
  submitting.value = true;
  try {
    const res = await $api.PostVehicleProfileReview(props.uid, { decision: 'reject', reason: r });
    if (res.status?.code === $enum.apiStatus.success) {
      ElMessage({ message: '已退回，已通知司機', type: 'warning' });
      showReject.value = false;
      rejectReason.value = '';
      emit('refresh');
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '操作失敗', type: 'error' });
    }
  } finally {
    submitting.value = false;
  }
};

const canReview = computed(() => props.pending?.status === 'pending_review');
</script>

<template lang="pug">
.VehicleProfileReview
  .VehicleProfileReview__head
    .VehicleProfileReview__title 車輛 Profile 審核
    .VehicleProfileReview__verified-meta(v-if="verifiedAt")
      span 上次驗證：{{ FormatTime(verifiedAt) }}
      span(v-if="verifiedBy")  · by {{ verifiedBy.slice(0, 12) }}

  .VehicleProfileReview__cols
    //- LEFT：current
    .VehicleProfileReview__col
      .VehicleProfileReview__col-label CURRENT（已驗證）
      template(v-if="current")
        .VehicleProfileReview__photos
          template(v-for="(url, idx) in current.photos" :key="`c-${idx}`")
            img.VehicleProfileReview__photo(
              v-if="IsImage(url)"
              :src="url"
              alt="vehicle"
            )
            .VehicleProfileReview__photo.is-fallback(v-else) 圖片
          .VehicleProfileReview__photos-empty(v-if="!current.photos.length") 無照片
        .VehicleProfileReview__group(v-for="g in vehicleGroups" :key="`cg-${g}`")
          .VehicleProfileReview__group-label {{ g }}
          .VehicleProfileReview__chips(v-if="TagsForGroup(current.tags, g).length")
            span.VehicleProfileReview__chip(
              v-for="id in TagsForGroup(current.tags, g)"
              :key="`c-${id}`"
            ) {{ TagName(id) }}
          .VehicleProfileReview__empty(v-else) —
      template(v-else)
        .VehicleProfileReview__empty 尚未驗證

    //- RIGHT：pending
    .VehicleProfileReview__col
      .VehicleProfileReview__col-label
        template(v-if="pending?.status === 'pending_review'") PENDING（待審核）
        template(v-else-if="pending?.status === 'rejected'") REJECTED（已退回）
        template(v-else-if="pending?.status === 'draft'") DRAFT（草稿）
        template(v-else) NO PENDING
      template(v-if="pending")
        .VehicleProfileReview__pending-meta
          .VehicleProfileReview__pending-meta-line(v-if="pending.submittedAt")
            span 送審時間：{{ FormatTime(pending.submittedAt) }}
          .VehicleProfileReview__pending-meta-line(
            v-if="pending.status === 'rejected' && pending.rejectReason"
            style="color: #f87171"
          ) 退回原因：{{ pending.rejectReason }}

        .VehicleProfileReview__photos
          template(v-for="(url, idx) in pending.photos" :key="`p-${idx}`")
            img.VehicleProfileReview__photo(
              v-if="IsImage(url)"
              :src="url"
              alt="vehicle"
            )
            .VehicleProfileReview__photo.is-fallback(v-else) 圖片
          .VehicleProfileReview__photos-empty(v-if="!pending.photos.length") 無照片
        .VehicleProfileReview__group(v-for="g in vehicleGroups" :key="`pg-${g}`")
          .VehicleProfileReview__group-label {{ g }}
          .VehicleProfileReview__chips(v-if="TagsForGroup(pending.tags, g).length")
            span.VehicleProfileReview__chip.is-pending(
              v-for="id in TagsForGroup(pending.tags, g)"
              :key="`p-${id}`"
            ) {{ TagName(id) }}
          .VehicleProfileReview__empty(v-else) —
      template(v-else)
        .VehicleProfileReview__empty —

  //- actions
  .VehicleProfileReview__actions(v-if="canReview")
    template(v-if="!showReject")
      ElButton(
        type="success"
        :loading="submitting"
        @click="ClickApprove"
      ) 核准（替換 current）
      ElButton(
        type="danger"
        plain
        :disabled="submitting"
        @click="ClickShowReject"
      ) 退回
    template(v-else)
      .VehicleProfileReview__reject-form
        ElInput(
          v-model="rejectReason"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="退回原因（會發給司機）"
        )
        .VehicleProfileReview__reject-buttons
          ElButton(
            type="danger"
            :loading="submitting"
            @click="ClickConfirmReject"
          ) 確認退回
          ElButton(
            :disabled="submitting"
            @click="ClickCancelReject"
          ) 取消
</template>

<style lang="scss" scoped>
.VehicleProfileReview {
  background: #fafbfc;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.VehicleProfileReview__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.VehicleProfileReview__title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.VehicleProfileReview__verified-meta {
  font-size: 11px;
  color: #909399;
  display: flex;
  gap: 4px;
}

.VehicleProfileReview__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 767.98px) {
  .VehicleProfileReview__cols {
    grid-template-columns: 1fr;
  }
}

.VehicleProfileReview__col {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.VehicleProfileReview__col-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #909399;
}

.VehicleProfileReview__pending-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: #606266;
}

.VehicleProfileReview__photos {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

@media (max-width: 479.98px) {
  .VehicleProfileReview__photos {
    grid-template-columns: repeat(3, 1fr);
  }
}

.VehicleProfileReview__photo {
  aspect-ratio: 4 / 3;
  width: 100%;
  object-fit: cover;
  border-radius: 6px;
  background: #f0f2f5;

  &.is-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: #909399;
  }
}

.VehicleProfileReview__photos-empty {
  font-size: 11px;
  color: #909399;
  grid-column: 1 / -1;
}

.VehicleProfileReview__group {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.VehicleProfileReview__group-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #909399;
  min-width: 70px;
}

.VehicleProfileReview__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.VehicleProfileReview__chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 100px;
  border: 1px solid #e4e7ed;
  background: #f0f9eb;
  color: #67c23a;

  &.is-pending {
    background: #fdf6ec;
    border-color: #faecd8;
    color: #e6a23c;
  }
}

.VehicleProfileReview__empty {
  font-size: 11px;
  color: #c0c4cc;
  flex: 1;
}

.VehicleProfileReview__actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.VehicleProfileReview__reject-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.VehicleProfileReview__reject-buttons {
  display: flex;
  gap: 8px;
}
</style>
