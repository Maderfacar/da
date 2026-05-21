<script setup lang="ts">
// Phase 1D：乘客 booking 偏好標籤 chip picker
//
// - 只接 active + scope=vehicle 的 tag（呼叫端已 filter）
// - 依 group 分區渲染；single multiplicity 互斥（再點同 chip 視為取消）
// - 顯示加價金額（surchargeAmount > 0 時 +NT$ N）
// - cream theme，響應式
import { TAG_GROUPS, TAG_GROUPS_ORDERED, type TagGroup, localizedTagName } from '~shared/tagTaxonomy';
import type { TagDto } from '@/protocol/fetch-api/api/tag';

interface Props {
  /** vehicle-scope 的 active tags（呼叫端 filter） */
  tags: TagDto[];
  /** 目前選中的 tag id 陣列 */
  modelValue: string[];
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const { locale } = useI18n();

const _normalizeLang = (l: string): 'zh_tw' | 'en' | 'ja' => {
  if (l === 'en') return 'en';
  if (l === 'ja') return 'ja';
  return 'zh_tw';
};

const lang = computed(() => _normalizeLang(String(locale.value)));

// 依 TAG_GROUPS_ORDERED 把 tags 分群，只保留 scope=vehicle 的 group
const groupedTags = computed(() =>
  TAG_GROUPS_ORDERED
    .filter(([, meta]) => meta.scope === 'vehicle')
    .map(([key, meta]) => ({
      key,
      meta,
      tags: props.tags
        .filter((t) => t.group === key && t.status === 'active')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((g) => g.tags.length > 0),
);

const IsSelected = (id: string) => props.modelValue.includes(id);

const GroupLabel = (g: TagGroup) =>
  TAG_GROUPS[g].label[lang.value] || TAG_GROUPS[g].label.zh_tw;

const TagLabel = (t: TagDto) => localizedTagName(t, lang.value);

const ClickToggleChip = (tag: TagDto, group: TagGroup) => {
  if (props.disabled) return;
  const meta = TAG_GROUPS[group];
  const cur = props.modelValue;

  if (meta.multiplicity === 'single') {
    // 點選同一群其他 chip → 取消舊、選新
    // 點當前選中 chip → 取消（清空該群）
    const otherIdsInGroup = props.tags
      .filter((t) => t.group === group && t.id !== tag.id)
      .map((t) => t.id);
    const isCurrentlySelected = cur.includes(tag.id);
    const cleaned = cur.filter((id) => !otherIdsInGroup.includes(id));
    if (isCurrentlySelected) {
      emit('update:modelValue', cleaned.filter((id) => id !== tag.id));
    } else {
      emit('update:modelValue', [...cleaned.filter((id) => id !== tag.id), tag.id]);
    }
    return;
  }

  // multi：toggle
  if (cur.includes(tag.id)) {
    emit('update:modelValue', cur.filter((id) => id !== tag.id));
  } else {
    emit('update:modelValue', [...cur, tag.id]);
  }
};
</script>

<template lang="pug">
.PassengerTagPreferencePicker(v-if="groupedTags.length")
  .PassengerTagPreferencePicker__group(v-for="group in groupedTags" :key="group.key")
    .PassengerTagPreferencePicker__group-header
      span.PassengerTagPreferencePicker__group-name {{ GroupLabel(group.key) }}
      span.PassengerTagPreferencePicker__group-meta
        | {{ group.meta.multiplicity === 'single' ? $t('booking.preferences.singleHint') : $t('booking.preferences.multiHint') }}
    .PassengerTagPreferencePicker__chips
      button.PassengerTagPreferencePicker__chip(
        v-for="tag in group.tags"
        :key="tag.id"
        type="button"
        :class="{ 'is-selected': IsSelected(tag.id) }"
        :disabled="disabled"
        @click="ClickToggleChip(tag, group.key)"
      )
        span.PassengerTagPreferencePicker__chip-name {{ TagLabel(tag) }}
        span.PassengerTagPreferencePicker__chip-surcharge(v-if="tag.surchargeAmount > 0")
          | +NT$ {{ tag.surchargeAmount }}

.PassengerTagPreferencePicker__empty(v-else)
  | {{ $t('booking.preferences.noTagsAvailable') }}
</template>

<style lang="scss" scoped>
.PassengerTagPreferencePicker {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.PassengerTagPreferencePicker__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PassengerTagPreferencePicker__group-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.PassengerTagPreferencePicker__group-name {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: var(--da-dark);
}

.PassengerTagPreferencePicker__group-meta {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--da-gray-light);
}

.PassengerTagPreferencePicker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PassengerTagPreferencePicker__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid var(--da-gray-pale);
  background: var(--da-off-white);
  color: var(--da-dark);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--da-amber);
    background: var(--da-amber-pale);
  }

  &.is-selected {
    border-color: var(--da-amber);
    background: var(--da-amber-pale);
    color: var(--da-amber);
    font-weight: 700;
  }

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.PassengerTagPreferencePicker__chip-surcharge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: var(--da-amber);
  letter-spacing: 0.03em;
}

.PassengerTagPreferencePicker__chip.is-selected .PassengerTagPreferencePicker__chip-surcharge {
  color: var(--da-amber);
}

.PassengerTagPreferencePicker__empty {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: var(--da-gray);
  text-align: center;
  padding: 14px 0;
}
</style>
