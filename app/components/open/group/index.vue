<script setup lang="ts">
// OpenGroup 開啟的模組（不用動）
const storeOpen = StoreOpen();
</script>

<template lang="pug">
#OpenGroup(v-if="storeOpen.openList.length > 0")
  component(
    v-for="(openItem, index) of storeOpen.openList"
    :is="openItem.componentName"
    :key="openItem.uuid"
    :params="openItem?.params || {}"
    :level="index"
    :resolve="openItem.resolve"
    @on-close="storeOpen.OnClose(openItem.uuid)"
  )
</template>

<style lang="scss" scoped>
// 佈局 ----
#OpenGroup {
  @include fixed("fill");
}
</style>
