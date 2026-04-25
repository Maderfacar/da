<script setup lang="ts">
// OpenDialogDemo 彈窗測試
// -- 引入 --------------------------------------------------------------------------------------------
const $mitt = UseMitt();

// -- 資料 --------------------------------------------------------------------------------------------
type Props  = {
  params: DialogDemoParams
  resolve:(value: string | PromiseLike<string>) => void
  level: number
}
const props = defineProps<Props>();

// -- 接收事件 -----------------------------------------------------------------------------------------
const ClickOpenDemo = $lodash.debounce(async () => {
  const openParams: DialogDemoParams = {
    demo: 'test123'
  };
  await $open.DialogDemo(openParams);
  // console.log('dialog');
}, 400, { leading: true, trailing: false });

// -- 發送事件 -----------------------------------------------------------------------------------------
type Emit = {'on-close': []}
const emit = defineEmits<Emit>();

const EmitClose = () => {
  props.resolve(props.params.demo);
  emit('on-close');
};

const MittRefresh = () => {
  $mitt.EmitRefresh(false, { abc: 'test456' });
};

</script>

<template lang="pug">
.OpenDialogDemo
  .mask-area(v-motion-fade)
  .content-area(v-motion-roll-bottom)
    p OpenDialogDemo
    NuxtIcon(
      name="material-symbols:close-rounded"
      class="close-btn"
      @click="EmitClose"
    )
    .row-item
      button(@click="ClickOpenDemo") Open Demo
      button(@click="MittRefresh") Call Refresh
</template>

<style lang="scss" scoped>
// 佈局 ----
.OpenDialogDemo {
  @include fixed("fill");
  @include center;
  .mask-area {
    @include absolute("fill");
    background-color: rgb(0 0 0 / 60%);
  }
  .content-area {
    @include wh(400px, 200px);
    position: relative;
    background-color: #fff;
    z-index: 1;
  }
  // TODO
}

// 組件 ----
.close-btn {
  @include btn-click;
  @include absolute("tr", 10px, 10px);
  @include fs(30px);
}
.row-item {
  @include row(10px);
}
</style>
