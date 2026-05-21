<script setup lang="ts">
// Phase 1C：依 group 分區的 chip 群組展示元件（純展示，無互動）
//
// 共用於 vehicleProfile.tags（vehicle scope）與 driverSkillTags（driver scope）
import { TAG_GROUPS, type TagGroup } from '~shared/tagTaxonomy';
import type { VehiclePublicTagDto, GetVehiclePublicLang } from '@/protocol/fetch-api/api/vehicle';

interface Props {
  tags: VehiclePublicTagDto[];
  lang: GetVehiclePublicLang;
}
const props = defineProps<Props>();

const groupsInOrder = computed(() => {
  const map = new Map<TagGroup, VehiclePublicTagDto[]>();
  for (const t of props.tags) {
    const arr = map.get(t.group) ?? [];
    arr.push(t);
    map.set(t.group, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (TAG_GROUPS[a]?.sortOrder ?? 0) - (TAG_GROUPS[b]?.sortOrder ?? 0));
});

const GroupLabel = (g: TagGroup): string => {
  const meta = TAG_GROUPS[g];
  if (!meta) return g;
  return meta.label[props.lang] || meta.label.zh_tw;
};
</script>

<template lang="pug">
.VehicleTagChipGroup
  .VehicleTagChipGroup__group(
    v-for="[group, items] in groupsInOrder"
    :key="group"
  )
    .VehicleTagChipGroup__group-label {{ GroupLabel(group) }}
    .VehicleTagChipGroup__chips
      span.VehicleTagChipGroup__chip(
        v-for="t in items"
        :key="t.id"
      ) {{ t.name }}
</template>

<style lang="scss" scoped>
.VehicleTagChipGroup {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.VehicleTagChipGroup__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.VehicleTagChipGroup__group-label {
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-gray);
}

.VehicleTagChipGroup__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.VehicleTagChipGroup__chip {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 100px;
  background: var(--da-amber-pale);
  border: 1px solid var(--da-glass-border);
  color: var(--da-dark);
}
</style>
