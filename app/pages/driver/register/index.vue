<script setup lang="ts">
definePageMeta({ layout: false, ssr: false, middleware: ['auth'] });
</script>

<template lang="pug">
.PageDriverRegister
  .PageDriverRegister__watermark REG

  .PageDriverRegister__card
    .PageDriverRegister__logo
      | DEST
      span ∙
      | DRIVER
    p.PageDriverRegister__tagline 司機申請

    .PageDriverRegister__divider

    .PageDriverRegister__icon 🚗
    h2.PageDriverRegister__title 成為 DEST 司機
    p.PageDriverRegister__desc
      | 您目前尚未擁有司機權限。
      br
      | 請聯絡管理人員申請司機帳號。

    .PageDriverRegister__actions
      button.PageDriverRegister__back-btn(@click="navigateTo('/')") 返回乘客端

  p.PageDriverRegister__copy © DEST・ANYWHERE
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageDriverRegister {
  min-height: 100svh;
  background: var(--da-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  position: relative;
  overflow: hidden;
}

.PageDriverRegister__watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: $font-display;
  font-size: clamp(160px, 50vw, 280px);
  letter-spacing: -0.04em;
  color: rgba(255, 255, 255, 0.04);
  pointer-events: none;
  user-select: none;
  line-height: 1;
}

.PageDriverRegister__card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 360px;
  background: rgba(40, 37, 31, 0.8);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(212, 134, 10, 0.2);
  border-radius: 20px;
  padding: 36px 28px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.PageDriverRegister__logo {
  font-family: $font-display;
  font-size: 36px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;
  margin-bottom: 8px;

  span { color: var(--da-amber); }
}

.PageDriverRegister__tagline {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 0;
}

.PageDriverRegister__divider {
  width: 100%;
  height: 1px;
  background: rgba(212, 134, 10, 0.15);
  margin: 28px 0 24px;
}

.PageDriverRegister__icon {
  font-size: 40px;
  margin-bottom: 14px;
}

.PageDriverRegister__title {
  font-family: $font-display;
  font-size: 28px;
  letter-spacing: 0.06em;
  color: var(--da-cream);
  margin-bottom: 12px;
  text-align: center;
}

.PageDriverRegister__desc {
  font-family: $font-body;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  line-height: 1.6;
  margin-bottom: 0;
}

.PageDriverRegister__actions {
  margin-top: 28px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageDriverRegister__back-btn {
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.8);
  }
}

.PageDriverRegister__copy {
  position: relative;
  z-index: 1;
  margin-top: 24px;
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.15);
}
</style>
