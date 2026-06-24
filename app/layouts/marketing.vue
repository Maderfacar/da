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

const drawerOpen = ref(false);
const ClickHamburger = () => { drawerOpen.value = true; };
const ClickLogo = () => navigateTo('/');
</script>

<template lang="pug">
.LayoutMarketing
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
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

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
  z-index: 100;
  height: 56px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(250, 248, 244, 0.88);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--da-glass-border);
}

.LayoutMarketing__logo {
  font-family: $font-display;
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
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.7);
    border-color: rgba(0, 0, 0, 0.12);
  }
  &:active { transform: scale(0.96); }
}

.LayoutMarketing__hamburger-line {
  width: 16px;
  height: 1.5px;
  background: var(--da-dark);
  border-radius: 1px;
}

// ── 頁面主體 ─────────────────────────────────────────────────────
.LayoutMarketing__body {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
