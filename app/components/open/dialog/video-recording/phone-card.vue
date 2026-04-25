<script setup lang="ts">
// OpenDialogVideoRecordingPhoneCard 手機卡片

</script>

<template lang="pug">
.OpenDialogVideoRecordingPhoneCard
  .content-area 
    .show-area
      slot
  .img-area
    ElImage(src="/img/phone.png" fit="cover")
    
</template>

<style lang="scss" scoped>
// 佈局 ----
.OpenDialogVideoRecordingPhoneCard {
  width: 100%;
  position: relative;
  .img-area {
    pointer-events: none;
    z-index: 100;
  }
  .content-area {
    @include absolute('tl', 0, 0);
    @include wh;
    z-index: 0;
    padding: 8% 5%;
  }
  .show-area {
    @include wh;
    background-color: rgba(154, 154, 154, 0.604);
    border-radius: 10% / 4%;
    overflow: hidden;
  }
}

// 組件 ----
</style>
