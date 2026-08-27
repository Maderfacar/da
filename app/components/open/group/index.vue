<script setup lang="ts">
// OpenGroup 開啟的模組
//
// ⚠ 這個容器掛在 app.vue，是 NuxtLayout 的**兄弟**不是子孫 ——
//    所以它拿不到 layout 根節點上的 [data-da-theme]。後果有兩個，都是靜默的：
//      ① 季節主題換色到不了乘客端的彈窗（彈窗維持預設色票）
//      ② 深色模式到不了乘客端的彈窗（深色作用域是 .dark [data-da-theme]）
//    修法是讓容器自己判斷「現在這一頁屬於哪一端」，是乘客端就補上該屬性。
//    admin / driver 端刻意不補：那兩端有自己的深色處理，也不吃季節主題。
const storeOpen = StoreOpen();
const route = useRoute();

/** 乘客端的兩個 layout。全站 42 頁都有明確宣告 layout，所以這個判斷是可靠的
 *  —— 用 route.meta.layout 而不是路徑前綴，才不會被 /en /ja 的語系前綴影響。 */
const PASSENGER_LAYOUTS = new Set(['front-desk', 'marketing']);
const isPassengerSurface = computed(
  () => PASSENGER_LAYOUTS.has(String(route.meta.layout ?? '')),
);
</script>

<template lang="pug">
#OpenGroup(
  v-if="storeOpen.openList.length > 0"
  :data-da-theme="isPassengerSurface ? '' : undefined"
)
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
