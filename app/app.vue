<script setup lang="ts">
// App 入口
// -- 引入 --------------------------------------------------------------------------------------------
// 手動導入組件，避免自動註冊產生的靜態/動態導入衝突
import LoadingPage from '~/components/loading/page.vue';
import OpenGroup from '~/components/open/group/index.vue';

/** 初始化 */
StoreEnv();
StoreTool();

// -- 資料 --------------------------------------------------------------------------------------------
const $elementI18n = UseElementI18n();
// -- 接收事件 -----------------------------------------------------------------------------------------

// -- 流程 --------------------------------------------------------------------------------------------

// -- 函式 --------------------------------------------------------------------------------------------

// -- Api ---------------------------------------------------------------------------------------------

// -- 生命週期 -----------------------------------------------------------------------------------------

</script>

<template lang="pug">
ElConfigProvider(:locale="$elementI18n.elLocale.value")
  //- 加載橫條（client only）
  ClientOnly
    NuxtLoadingIndicator(color="#86D4A187")

  //- 加載動畫（client only，避免 SSR hydration mismatch）
  ClientOnly
    LoadingPage

  //- 本體
  NuxtLayout
    NuxtPage

  //- Drawer Modal Dialog 跳窗群組（client only）
  ClientOnly
    OpenGroup
</template>
