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
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--da-gray-pale);
  cursor: zoom-in;
  box-shadow: var(--shadow-soft);
  transition: transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);

  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-soft);
  }
}

.VehiclePhotoGallery__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  font-family: var(--ff-ui);
  font-size: 13px;
  color: var(--da-gray);
  background: var(--da-amber-pale);
  border-radius: var(--r-md);
}
</style>
