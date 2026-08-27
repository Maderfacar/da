<script setup lang="ts">
// LayoutMarketing — 行銷公開頁 layout（W1 AEO）
//
// 為什麼新建這個 layout 而不沿用 front-desk？
//   front-desk.vue:160 的 `slot(v-if="authResolved && ...")` 會等 auth 解析完才 render slot，
//   對其他乘客頁是對的（避免閃登入），但對 `/` 行銷首頁是錯的：
//   SSR 時 authResolved 必為 false → slot 不渲染 → AI 爬蟲拿到空白 body。
//
// 設計原則：
//   - 不 import StoreAuth、不讀 authResolved/isSignIn
//   - SSR 時直接 render slot（hero/features 等爬蟲可讀內容）
//   - 用戶相關 UI（CommonHeaderUser, CommonDrawer）包 ClientOnly 避免 hydration mismatch
//   - 視覺基調對齊 front-desk（同 nav 高度、字體、色票），避免品牌分裂
//
// 適用頁面：純行銷 / 公開 landing page，目前僅 `/`（pages/index.vue）使用。

// 季節主題：SSR 解析生效主題並注入 [data-da-theme]（FOUC-free；只作用乘客端）
useSiteThemeInject();

const drawerOpen = ref(false);
const ClickHamburger = () => { drawerOpen.value = true; };
const ClickLogo = () => navigateTo('/');
</script>

<template lang="pug">
.LayoutMarketing(data-da-theme)
  //- ── 固定頂部 Nav（SSR 友善：hamburger / logo / langSwitcher 都可 SSR）──────
  nav.LayoutMarketing__top
    .LayoutMarketing__nav-left
      button.LayoutMarketing__hamburger(
        type="button"
        :aria-label="$t('drawer.ariaOpen')"
        @click="ClickHamburger"
      )
        span.LayoutMarketing__hamburger-line
        span.LayoutMarketing__hamburger-line
        span.LayoutMarketing__hamburger-line
      .LayoutMarketing__logo(@click="ClickLogo")
        | DEST
        span ∙
        | ANYWHERE
    .LayoutMarketing__nav-right
      LangSwitcher
      //- 已登入頭像 / 跨端切換鈕：依賴 auth state，包 ClientOnly 避免 hydration mismatch
      ClientOnly
        CommonHeaderUser

  //- ── 頁面內容（slot 直接 SSR，無 auth gate）─────────────────────────
  main.LayoutMarketing__body
    slot

  //- ── 共用 Footer（含 LINE QR）──────────────────────────────────────
  CommonFooter

  //- ── Drawer（純 client-side 互動，包 ClientOnly）─────────────────────
  ClientOnly
    CommonDrawer(v-model="drawerOpen")
</template>

<style lang="scss" scoped>

.LayoutMarketing {
  min-height: 100svh;
  background: var(--da-off-white);
  color: var(--da-dark);
  -webkit-font-smoothing: antialiased;
}

// ── 頂部 Nav（與 front-desk 視覺一致）──────────────────────────────
.LayoutMarketing__top {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: var(--z-header);
  height: 56px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-a88);
  border-bottom: 1px solid var(--hairline);
}

.LayoutMarketing__logo {
  font-family: var(--ff-display);
  font-size: 22px;
  letter-spacing: 0.08em;
  color: var(--da-dark);
  line-height: 1;
  cursor: pointer;
  user-select: none;

  span { color: var(--da-amber); }
}

.LayoutMarketing__nav-left,
.LayoutMarketing__nav-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

// ── Hamburger 按鈕 ─────────────────────────────────────────────────
.LayoutMarketing__hamburger {
  width: 36px;
  height: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--ink-a06);
  border-radius: var(--r-md);
  background: var(--surface-a40);
  cursor: pointer;
  padding: 0;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-a72);
    border-color: var(--ink-a12);
  }
  &:active { transform: scale(0.96); }
}

.LayoutMarketing__hamburger-line {
  width: 16px;
  height: 1.5px;
  background: var(--da-dark);
  border-radius: var(--r-xs);
}

// ── 頁面主體 ─────────────────────────────────────────────────────
.LayoutMarketing__body {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
