<script setup lang="ts">
// CommonTabBar — 乘客端底部四格 Tab Bar（2026-08-30 自 front-desk layout 抽出）
//
// 抽出理由：/fare /faq /legal 走 marketing layout（AEO 公開頁），登入者一走進去
// tab bar 就消失 —— 兩個 layout 各自為政的洞。抽成共用元件後：
//   - front-desk：無條件渲染（原行為不變，CSS 只在 ≤900px 顯示）
//   - marketing：包 ClientOnly、只給登入者（訪客維持純行銷版，SEO 不動）
//
// 清單 SSOT 在 app/utils/passenger-tabs.ts，桌機常駐導覽也吃同一份。
// 佈局的 padding-bottom（讓出四格高度）由各 layout 自己負責 —— 元件是 fixed 定位，
// 不知道也不該知道宿主的排版。

const route = useRoute();

// 作用中分頁：最長前綴匹配 + 剝 i18n 的 /en /ja 前綴
// （prefix_except_default → 英日版路徑會多一段，不剝的話四格永遠沒有 active）。
const activeTab = computed(() => {
  const path = route.path.replace(/^\/(?:en|ja)(?=\/|$)/, '') || '/';
  const hit = PASSENGER_TABS
    .filter((t) => path === t.path || path.startsWith(`${t.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return hit?.id ?? '';
});
</script>

<template lang="pug">
//- 跑道斜紋帶：5px 品牌記號，壓在四格之上（提案裝飾語彙 A）；桌機那一端在頁尾
.CommonTabBar__stripe
nav.CommonTabBar__tabs(:aria-label="$t('tab.ariaLabel')")
  button.CommonTabBar__tab(
    v-for="t in PASSENGER_TABS"
    :key="t.id"
    type="button"
    :class="{ 'is-active': activeTab === t.id }"
    :aria-current="activeTab === t.id ? 'page' : undefined"
    @click="navigateTo(t.path)"
  )
    NuxtIcon.CommonTabBar__tab-icon(:name="t.icon")
    span.CommonTabBar__tab-label {{ $t(t.labelKey) }}
</template>

<style lang="scss" scoped>
/* 只在窄螢幕出現：桌機上滿版底欄會讓網站讀起來像手機 App，
   桌機的入口交給常駐導覽 / drawer。 */
.CommonTabBar__stripe {
  display: none;
}

.CommonTabBar__tabs {
  display: none;
}

@media (max-width: 900px) {
  .CommonTabBar__stripe {
    display: block;
    position: fixed;
    left: 0; right: 0;
    bottom: var(--tabbar-h);
    z-index: var(--z-header);
    height: var(--tabbar-stripe);
    background: repeating-linear-gradient(
      -45deg,
      var(--da-stripe-dark) 0 10px,
      var(--da-stripe-yellow) 10px 20px
    );
  }

  .CommonTabBar__tabs {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: var(--z-header);
    display: flex;
    /* 高度與 --tabbar-h 綁死；下緣的安全區留白由 padding 讓出，
       圖示與文字永遠落在 --tabbar-body 那一段裡，不會被手勢列吃到。 */
    height: var(--tabbar-h);
    padding-bottom: var(--tabbar-safe);
    background: var(--da-off-white);
    border-top: 1px solid var(--da-gray-pale);
  }
}

.CommonTabBar__tab {
  flex: 1;
  /* 高度吃滿 --tabbar-body（62px），比 --tap 的 44px 再厚一階 ——
     四格是全站最常按的東西，而且底下就是手機的手勢列，太薄會誤觸。 */
  min-height: var(--tabbar-body);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 0;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--da-gray-light);
  transition: color var(--dur-fast) var(--ease-out);

  &.is-active { color: var(--da-dark); }
}

.CommonTabBar__tab-icon {
  font-size: var(--fs-h4);
  line-height: var(--lh-flat);
}

.CommonTabBar__tab-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  line-height: var(--lh-flat);
}
</style>
