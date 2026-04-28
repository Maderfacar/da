<script setup lang="ts">
/**
 * SplitFlapBoard — 機場告示牌字串列
 * 接收 value 字串，拆為字元陣列，每個字元由 SplitFlapChar 處理。
 * charDelay 控制字元間的 stagger 效果（序列拍打感）。
 */
const props = withDefaults(defineProps<{
  value: string
  charDelay?: number  // ms，相鄰字元的動畫起始延遲，預設 60
  cycles?: number     // 每字元隨機翻滾幾次，預設 8
}>(), {
  charDelay: 60,
  cycles: 8,
})

const chars = computed(() => props.value.split(''))
</script>

<template lang="pug">
.SplitFlapBoard
  SplitFlapChar(
    v-for="(ch, i) in chars"
    :key="i"
    :char="ch"
    :delay="i * charDelay"
    :cycles="cycles"
  )
</template>

<style lang="scss" scoped>
.SplitFlapBoard {
  display:     inline-flex;
  align-items: center;
  gap:         3px;
}
</style>
