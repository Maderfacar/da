<script setup lang="ts">
// Phase 1B：共用 chip picker — 依 group 的 multiplicity 渲染單選 / 多選
//
// - group multiplicity='single' → 單選互斥（再點同 chip 視為「取消」）
// - group multiplicity='multi'  → toggle 多選
//
// 與 driver / admin 兩端都會共用；不依賴特定 store。
import { TAG_GROUPS, type TagGroup, localizedTagName } from '~shared/tagTaxonomy';
import type { TagDto } from '@/protocol/fetch-api/api/tag';

interface Props {
  group: TagGroup;
  tags: TagDto[];          // 該 group 內 active tags（呼叫端已過濾）
  modelValue: string[];     // 目前選到的 tag id（可能 0、1 或多）
  disabled?: boolean;
  /** 顯示語系；不傳預設 zh_tw（driver 端規格 #14） */
  lang?: 'zh_tw' | 'en' | 'ja';
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  lang: 'zh_tw',
});

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const meta = computed(() => TAG_GROUPS[props.group]);

const sortedTags = computed(() =>
  [...props.tags].sort((a, b) => a.sortOrder - b.sortOrder),
);

const groupLabel = computed(() => meta.value.label[props.lang] || meta.value.label.zh_tw);

const IsSelected = (id: string): boolean => props.modelValue.includes(id);

const ClickChip = (id: string) => {
  if (props.disabled) return;
  const cur = props.modelValue;
  if (meta.value.multiplicity === 'single') {
    // 再點 selected chip 視為「取消選擇」（清空）
    if (cur.length === 1 && cur[0] === id) {
      emit('update:modelValue', []);
    } else {
      emit('update:modelValue', [id]);
    }
    return;
  }
  // multi：toggle
  if (cur.includes(id)) {
    emit('update:modelValue', cur.filter((x) => x !== id));
  } else {
    emit('update:modelValue', [...cur, id]);
  }
};
</script>

<template lang="pug">
.TagGroupPicker(:class="{ 'is-disabled': disabled }")
  .TagGroupPicker__head
    .TagGroupPicker__title {{ groupLabel }}
    .TagGroupPicker__hint
      template(v-if="meta.multiplicity === 'single'") 單選
      template(v-else) 可複選
  .TagGroupPicker__chips(v-if="sortedTags.length")
    button.TagGroupPicker__chip(
      v-for="tag in sortedTags"
      :key="tag.id"
      type="button"
      :class="{ 'is-selected': IsSelected(tag.id) }"
      :disabled="disabled"
      @click="ClickChip(tag.id)"
    ) {{ localizedTagName(tag, lang) }}
  .TagGroupPicker__empty(v-else) 暫無可選標籤
</template>

<style lang="scss" scoped>
.TagGroupPicker {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &.is-disabled { opacity: 0.6; pointer-events: none; }
}

.TagGroupPicker__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.TagGroupPicker__title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.TagGroupPicker__hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.4);
}

.TagGroupPicker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.TagGroupPicker__chip {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: rgba(212, 134, 10, 0.5);
    color: #fff;
  }

  &.is-selected {
    border-color: rgba(212, 134, 10, 0.7);
    background: rgba(212, 134, 10, 0.18);
    color: #f5c518;
  }

  &:disabled { cursor: not-allowed; }
}

.TagGroupPicker__empty {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}
</style>
