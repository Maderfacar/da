<script setup lang="ts">
// PageDriverRegister 司機申請頁面（P10 多角色版本）
//
// 顯示模式依 store 狀態決定：
//   1. 無 driver 身分（純 passenger / admin）  → 申請表單（P8-2 補完，目前顯示「即將推出」）
//   2. driver + !approved + 無 rejectedAt → 「審核中」訊息
//   3. driver + !approved + 有 rejectedAt → 「需進一步審核，請聯絡管理者」
//
// approved driver 不會進到此頁（middleware/role.ts 會放行至 /driver/dashboard）

definePageMeta({ layout: false, ssr: false });

const authStore = StoreAuth();
const { isDriver, approved, lineProfile, driverApplication, authResolved } = storeToRefs(authStore);

type RegisterMode = 'apply' | 'pending' | 'rejected';

const mode = computed<RegisterMode>(() => {
  if (isDriver.value && !approved.value) {
    return driverApplication.value?.rejectedAt ? 'rejected' : 'pending';
  }
  // 無 driver 身分 → 顯示申請表單
  return 'apply';
});

const ClickBackHome = () => navigateTo('/home');
</script>

<template lang="pug">
.PageDriverRegister
  .PageDriverRegister__watermark APPLY

  .PageDriverRegister__card
    .PageDriverRegister__logo
      | DEST
      span ∙
      | DRIVER
    p.PageDriverRegister__tagline 司機申請

    .PageDriverRegister__divider

    //- ── 認證初始化中 ─────────────────────────────────────
    template(v-if="!authResolved")
      p.PageDriverRegister__loading 載入中...

    //- ── 模式 1：申請表單（P8-2 將補完整表單） ───────────
    template(v-else-if="mode === 'apply'")
      .PageDriverRegister__user-info(v-if="lineProfile")
        img.PageDriverRegister__avatar(
          :src="lineProfile.pictureUrl"
          :alt="lineProfile.displayName"
          referrerpolicy="no-referrer"
        )
        .PageDriverRegister__user-name {{ lineProfile.displayName }}
      h2.PageDriverRegister__heading 申請成為司機
      p.PageDriverRegister__desc 完整申請功能即將推出，將需要填寫司機資料、車輛資訊、銀行帳號，並上傳駕照、行照、保險卡、良民證等證件。
      p.PageDriverRegister__hint （P8-2 階段補完表單）
      button.PageDriverRegister__back-btn(@click="ClickBackHome") 返回乘客首頁

    //- ── 模式 2：審核中 ──────────────────────────────────
    template(v-else-if="mode === 'pending'")
      .PageDriverRegister__status-icon ⏳
      h2.PageDriverRegister__heading 申請審核中
      p.PageDriverRegister__desc 您的司機申請正在審核中，管理員將於工作時間內處理，請耐心等候。
      p.PageDriverRegister__hint(v-if="driverApplication?.appliedAt") 申請時間：{{ new Date(driverApplication.appliedAt).toLocaleString('zh-TW') }}
      button.PageDriverRegister__back-btn(@click="ClickBackHome") 返回乘客首頁

    //- ── 模式 3：已拒絕 / 需聯絡管理者 ──────────────────
    template(v-else-if="mode === 'rejected'")
      .PageDriverRegister__status-icon ⚠
      h2.PageDriverRegister__heading 需進一步審核
      p.PageDriverRegister__desc 您的司機申請目前無法通過自動審核，請聯絡管理者協助處理。
      p.PageDriverRegister__reason(v-if="driverApplication?.rejectReason") 原因：{{ driverApplication.rejectReason }}
      button.PageDriverRegister__back-btn(@click="ClickBackHome") 返回乘客首頁

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
  font-size: clamp(140px, 42vw, 240px);
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
  max-width: 380px;
  background: rgba(40, 37, 31, 0.8);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(212, 134, 10, 0.2);
  border-radius: 20px;
  padding: 36px 28px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
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
}

.PageDriverRegister__divider {
  width: 100%;
  height: 1px;
  background: rgba(212, 134, 10, 0.15);
  margin: 24px 0;
}

.PageDriverRegister__loading {
  font-family: $font-body;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.4);
  padding: 20px 0;
}

.PageDriverRegister__user-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.PageDriverRegister__avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2px solid rgba(212, 134, 10, 0.4);
  object-fit: cover;
}

.PageDriverRegister__user-name {
  font-family: $font-body;
  font-size: 14px;
  color: var(--da-cream);
  font-weight: 500;
}

.PageDriverRegister__status-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.PageDriverRegister__heading {
  font-family: $font-condensed;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--da-cream);
  margin-bottom: 12px;
}

.PageDriverRegister__desc {
  font-family: $font-body;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.65);
  margin-bottom: 16px;
}

.PageDriverRegister__hint {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 24px;
}

.PageDriverRegister__reason {
  font-family: $font-body;
  font-size: 13px;
  color: rgba(248, 113, 113, 0.85);
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 24px;
  width: 100%;
  text-align: left;
}

.PageDriverRegister__back-btn {
  width: 100%;
  margin-top: 8px;
  padding: 12px 8px;
  background: rgba(212, 134, 10, 0.12);
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 10px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--da-amber);
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;

  &:hover { background: rgba(212, 134, 10, 0.22); }
  &:active { transform: scale(0.98); }
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
