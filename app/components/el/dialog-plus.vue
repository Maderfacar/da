<script setup lang="ts">
// ElDialogPlus 彈窗基底
// -- 引入 --------------------------------------------------------------------------------------------
const $ask = UseAsk();
const storeTool = StoreTool();

// -- 資料 --------------------------------------------------------------------------------------------
const visible = defineModel({
  type: Boolean,
  default: false
});

type Props = {
  width?: string // 正常寬度
  title?: string // 標題
  type?: 'edit' | 'info' //  編輯 一般模式
  isChange?: boolean // 是否被改過
  hiddenHeader?: boolean // 隱藏 header
  hiddenFooter?: boolean // 隱藏 footer
  isRemovePadding?: boolean // 是否移除 padding
  isbodyFull?: boolean // body 填滿
}

const props = withDefaults(defineProps<Props>(), {
  width: '400px',
  title: '',
  type: 'info',
  isChange: false,
  hiddenHeader: false,
  hiddenFooter: false,
  isRemovePadding: false,
  isbodyFull: false
});

// -- 接收事件 -----------------------------------------------------------------------------------------
const OnHandleClose = async () => {
  if (!props.isChange) {
    visible.value = false;
    return;
  }
  if (await $ask.ChangeClose()) {
    visible.value = false;
  }
};

// -- 函式 --------------------------------------------------------------------------------------------

// -- 生命週期 -----------------------------------------------------------------------------------------

// -- 發送事件 -----------------------------------------------------------------------------------------
type Emit = { 'on-close': [] }
const emit = defineEmits<Emit>();

/* 關閉銷毀 */
const EmitClose = () => {
  emit('on-close');
};
</script>

<template lang="pug">
.ElDialogPlus
  ElDialog(
    v-model="visible"
    v-bind="$attrs"
    :title="props.title"
    :type="props.type"
    :width="storeTool.isMobile ? '95%':props.width"
    :before-close="OnHandleClose"
    :destroy-on-close="true"
    draggable
    :class="{'g-hidden-dialog-header': props.hiddenHeader}"  
    @closed="EmitClose"
  )
    template(#default)
      div(
        v-scroll-more="{lisent: '.el-dialog__body', show: '.el-dialog__body'}"
        :class="{'dialog-content-area': !props.isRemovePadding, 'is-body-full':props.isbodyFull}"
      )
        slot
    template(v-if="!props.hiddenFooter" #footer)
      slot(name="footer" :AskClose="OnHandleClose")
</template>

<style lang="scss" scoped>
// 佈局 ----
.ElDialogPlus {
  :deep(.el-overlay-dialog) {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  :deep(.el-dialog) {
    max-height: 95vh;
    @supports (max-height: 95dvh) {
      max-height: 95dvh;
    }
    display: grid;
    grid-template-rows: auto 1fr auto;
    overflow: hidden;
    margin: 0 !important;
    padding: 0 !important;
    position: relative;
    .el-dialog__close {
      transform: scale(1.5);
    }
  
    .el-dialog.is-fullscreen {
      width: 95% !important;
      height: unset !important;
    }
  
    .el-dialog__header {
      border-bottom: 1px solid #eee;
      text-align: center;
      padding: 10px 20px !important;
      font-weight: 700;
      z-index: 1;
    } 
  
    .el-dialog__body {
      position: relative;
      overflow: auto;
      z-index: 0;
    }
  
    .el-dialog__footer {
      min-height: 54px;
      border-top: 1px solid #eee;
      padding: 10px 20px !important;
      z-index: 1;
    }

    &[type="info"] {
      .el-dialog__header {
        background-color: #fff;
      }
      .el-dialog__header .el-dialog__title {
        color: var(--primary) !important;
      }
      .el-dialog__header .el-dialog__headerbtn i {
        color: var(--primary) !important;
      }
    }
    &[type="edit"] {
      .el-dialog__header {
        background-color: var(--primary);
      }
      .el-dialog__header .el-dialog__title {
        color: #fff !important;
      }
      .el-dialog__header .el-dialog__headerbtn i {
        color: #fff !important;
      }
    }
  }
}

// 組件 ----
.dialog-content-area {
  @include rwd-pc {
    padding: 20px 40px;
  }
  @include rwd-mobile {
    padding: 20px;
  }
}

.is-body-full {
  @include wh;
  overflow: hidden;
}

</style>
