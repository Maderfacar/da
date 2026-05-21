<script setup lang="ts">
// Phase 1C：車輛照片 gallery（ElImage + preview-src-list 全螢幕大圖）
//
// 響應式：mobile 2 cols / tablet 3 cols / desktop 4 cols
interface Props {
  photos: string[];
}
const props = defineProps<Props>();
</script>

<template lang="pug">
.VehiclePhotoGallery(v-if="photos.length")
  ElImage.VehiclePhotoGallery__item(
    v-for="(url, idx) in photos"
    :key="`${idx}-${url}`"
    :src="url"
    :preview-src-list="photos"
    :initial-index="idx"
    fit="cover"
    loading="lazy"
    preview-teleported
    :zoom-rate="1.2"
    :max-scale="4"
    :min-scale="0.5"
  )
.VehiclePhotoGallery__empty(v-else)
  span 暫無照片
</template>

<style lang="scss" scoped>
.VehiclePhotoGallery {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

@media (min-width: 768px) {
  .VehiclePhotoGallery { grid-template-columns: repeat(3, 1fr); }
}

@media (min-width: 1024px) {
  .VehiclePhotoGallery { grid-template-columns: repeat(4, 1fr); }
}

.VehiclePhotoGallery__item {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  overflow: hidden;
  background: var(--da-gray-pale);
  cursor: zoom-in;
  box-shadow: 0 2px 8px rgba(26, 24, 20, 0.06);
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(26, 24, 20, 0.12);
  }
}

.VehiclePhotoGallery__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: var(--da-gray);
  background: var(--da-amber-pale);
  border-radius: 12px;
}
</style>
