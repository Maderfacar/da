<script setup lang="ts">
// PageDriverRegister 司機申請頁面（P8-2 完整版）
//
// 三模式：
//   1. 無 driver 身分（純 passenger）→ apply 模式：完整申請表單（6 欄位 + 4 證件）
//   2. driver + !approved + 無 rejectedAt → pending 模式：「審核中」提示
//   3. driver + !approved + 有 rejectedAt → rejected 模式：拒絕原因 + 24h 冷卻倒數
//
// approved driver 不會進到此頁（middleware/role.ts 會放行至 /driver/dashboard）

definePageMeta({ layout: false, ssr: false });

const authStore = StoreAuth();
const lineProfile = computed(() => authStore.lineProfile);
const driverApplication = computed(() => authStore.driverApplication);
const authResolved = computed(() => authStore.authResolved);

type RegisterMode = 'apply' | 'pending' | 'rejected';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// P29：driver OA 加好友 URL（pending mode 顯示給待審核司機，鼓勵先加好友）
const runtimeConfig = useRuntimeConfig();
const driverOaUrl = computed(() => runtimeConfig.public.lineOaAddUrlDriver as string);

const mode = computed<RegisterMode>(() => {
  if (authStore.roles.includes('driver') && !authStore.approved) {
    const rejectedAt = driverApplication.value?.rejectedAt;
    if (rejectedAt) {
      const diff = Date.now() - new Date(rejectedAt).getTime();
      if (diff < COOLDOWN_MS) return 'rejected';
      // 冷卻已過 → 視為仍在 pending（admin 應該主動清掉 rejectedAt 但容錯處理）
      return 'pending';
    }
    return 'pending';
  }
  return 'apply';
});

// 取得使用者的 LINE userId（用於上傳路徑與 apply 寫入文件 ID）
const lineUserId = computed(() => {
  const uid = authStore.user?.uid ?? '';
  return uid.startsWith('line:') ? uid.slice(5) : uid;
});

// ── 申請表單欄位 ───────────────────────────────────────────────────
const driverName = ref('');
const phone = ref('');
const plateNumber = ref('');
// Home redesign 同期：把 4 選 1 分類 radio 換成「車輛品牌與型號」自由文字欄
const vehicleModel = ref('');
const bankCode = ref('');
const bankAccount = ref('');

const docs = ref({
  licenseUrl: '',
  registrationUrl: '',
  insuranceUrl: '',
  goodCitizenUrl: '',
});

const submitting = ref(false);
const submitError = ref('');
const submitSuccess = ref(false);

const isFormValid = computed(() =>
  !!driverName.value.trim()
  && !!phone.value.trim()
  && !!plateNumber.value.trim()
  && !!vehicleModel.value.trim()
  && !!bankCode.value.trim()
  && !!bankAccount.value.trim()
  && !!docs.value.licenseUrl
  && !!docs.value.registrationUrl
  && !!docs.value.insuranceUrl
  && !!docs.value.goodCitizenUrl,
);

const ApiSubmit = async () => {
  if (submitting.value || !isFormValid.value || !lineUserId.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const res = await $api.ApplyDriver({
      lineUserId: lineUserId.value,
      driverName: driverName.value.trim(),
      phone: phone.value.trim(),
      plateNumber: plateNumber.value.trim(),
      vehicleModel: vehicleModel.value.trim(),
      bankCode: bankCode.value.trim(),
      bankAccount: bankAccount.value.trim(),
      documents: docs.value,
    });
    if (res.status?.code === 200) {
      submitSuccess.value = true;
      // 申請成功後 reload 取最新 store 狀態（會自動切到 pending 模式）
      setTimeout(() => location.reload(), 1500);
    } else if (res.status?.code === 403) {
      // 冷卻中
      submitError.value = '您的申請目前在冷卻期，請聯絡管理者。';
    } else {
      submitError.value = res.status?.message?.zh_tw ?? '申請送出失敗';
    }
  } catch {
    submitError.value = '申請送出失敗，請稍後重試';
  }
  submitting.value = false;
};

const ClickBackHome = () => navigateTo('/home');

// 倒數計時：顯示冷卻剩餘時間（hh:mm:ss）
const cooldownRemaining = ref('');
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

const UpdateCooldown = () => {
  const rejectedAt = driverApplication.value?.rejectedAt;
  if (!rejectedAt) {
    cooldownRemaining.value = '';
    return;
  }
  const remaining = COOLDOWN_MS - (Date.now() - new Date(rejectedAt).getTime());
  if (remaining <= 0) {
    cooldownRemaining.value = '已過冷卻期，請聯絡管理者';
    return;
  }
  const h = Math.floor(remaining / 3600_000);
  const m = Math.floor((remaining % 3600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  cooldownRemaining.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

watch(mode, (m) => {
  if (m === 'rejected') {
    UpdateCooldown();
    if (!cooldownTimer) cooldownTimer = setInterval(UpdateCooldown, 1000);
  } else if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
}, { immediate: true });

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});
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

    //- ── 模式 1：申請表單 ─────────────────────────────────
    template(v-else-if="mode === 'apply'")
      .PageDriverRegister__user-info(v-if="lineProfile")
        img.PageDriverRegister__avatar(
          :src="lineProfile.pictureUrl"
          :alt="lineProfile.displayName"
          referrerpolicy="no-referrer"
        )
        .PageDriverRegister__user-name {{ lineProfile.displayName }}
      h2.PageDriverRegister__heading 申請成為司機

      .PageDriverRegister__success(v-if="submitSuccess")
        span ✅
        span 申請已送出，重新整理中…

      template(v-else)
        //- ── 基本資料 ─────────────────────────────────
        .PageDriverRegister__section-title 基本資料

        .PageDriverRegister__field
          label.PageDriverRegister__label 司機姓名
            span.PageDriverRegister__required *
          input.PageDriverRegister__input(
            v-model="driverName"
            type="text"
            maxlength="40"
            placeholder="請填寫真實姓名"
          )

        .PageDriverRegister__field
          label.PageDriverRegister__label 聯絡電話
            span.PageDriverRegister__required *
          input.PageDriverRegister__input(
            v-model="phone"
            type="tel"
            maxlength="15"
            inputmode="numeric"
            placeholder="0912345678"
          )

        //- ── 車輛資訊 ─────────────────────────────────
        .PageDriverRegister__section-title 車輛資訊

        .PageDriverRegister__field
          label.PageDriverRegister__label 車牌號碼
            span.PageDriverRegister__required *
          input.PageDriverRegister__input(
            v-model="plateNumber"
            type="text"
            maxlength="10"
            placeholder="ABC-1234"
            style="text-transform: uppercase"
          )

        .PageDriverRegister__field
          label.PageDriverRegister__label 車輛品牌與型號
            span.PageDriverRegister__required *
          input.PageDriverRegister__input(
            v-model="vehicleModel"
            type="text"
            maxlength="80"
            placeholder="例：Tesla Model S、Benz Vito、Toyota RAV4"
          )

        //- ── 銀行帳戶（用於收款） ─────────────────────
        .PageDriverRegister__section-title 銀行帳戶（用於收款）

        .PageDriverRegister__field
          label.PageDriverRegister__label 銀行代號
            span.PageDriverRegister__required *
          input.PageDriverRegister__input(
            v-model="bankCode"
            type="text"
            maxlength="3"
            inputmode="numeric"
            placeholder="例：004（台銀）"
          )

        .PageDriverRegister__field
          label.PageDriverRegister__label 銀行帳號
            span.PageDriverRegister__required *
          input.PageDriverRegister__input(
            v-model="bankAccount"
            type="text"
            maxlength="20"
            inputmode="numeric"
            placeholder="請填完整帳號"
          )

        //- ── 證件上傳 ─────────────────────────────────
        .PageDriverRegister__section-title 證件上傳（jpg / png / pdf · 5MB 內）

        .PageDriverRegister__docs
          DriverRegisterUploadField(
            v-model="docs.licenseUrl"
            doc-type="licenseUrl"
            label="駕照"
            :line-user-id="lineUserId"
          )
          DriverRegisterUploadField(
            v-model="docs.registrationUrl"
            doc-type="registrationUrl"
            label="行照"
            :line-user-id="lineUserId"
          )
          DriverRegisterUploadField(
            v-model="docs.insuranceUrl"
            doc-type="insuranceUrl"
            label="保險卡"
            :line-user-id="lineUserId"
          )
          DriverRegisterUploadField(
            v-model="docs.goodCitizenUrl"
            doc-type="goodCitizenUrl"
            label="良民證"
            :line-user-id="lineUserId"
          )

        .PageDriverRegister__error(v-if="submitError") {{ submitError }}

        button.PageDriverRegister__submit-btn(
          type="button"
          :disabled="!isFormValid || submitting"
          @click="ApiSubmit"
        ) {{ submitting ? '送出中…' : '送出申請' }}

        button.PageDriverRegister__back-btn(
          type="button"
          @click="ClickBackHome"
        ) 返回乘客首頁

    //- ── 模式 2：審核中 ──────────────────────────────────
    template(v-else-if="mode === 'pending'")
      .PageDriverRegister__status-icon ⏳
      h2.PageDriverRegister__heading 申請審核中
      p.PageDriverRegister__desc 您的司機申請正在審核中，管理員將於工作時間內處理，請耐心等候。
      p.PageDriverRegister__hint(v-if="driverApplication?.appliedAt")
        | 申請時間：{{ new Date(driverApplication.appliedAt).toLocaleString('zh-TW') }}
      //- P29：審核期間鼓勵先加 driver OA 為好友，核准後即可收派單通知
      a.PageDriverRegister__oa-cta(
        v-if="driverOaUrl"
        :href="driverOaUrl"
        target="_blank"
        rel="noopener"
      )
        span.PageDriverRegister__oa-cta-icon 🔔
        span.PageDriverRegister__oa-cta-text 加 Driver LINE 為好友（核准後接收派單通知）
      button.PageDriverRegister__back-btn(@click="ClickBackHome") 返回乘客首頁

    //- ── 模式 3：已拒絕 / 冷卻中 ─────────────────────────
    template(v-else-if="mode === 'rejected'")
      .PageDriverRegister__status-icon ⚠
      h2.PageDriverRegister__heading 申請冷卻中
      p.PageDriverRegister__desc 您的司機申請目前無法通過自動審核，請聯絡管理者協助處理。
      .PageDriverRegister__cooldown
        .PageDriverRegister__cooldown-label 冷卻倒數
        .PageDriverRegister__cooldown-time {{ cooldownRemaining }}
      p.PageDriverRegister__reason(v-if="driverApplication?.rejectReason")
        | 原因：{{ driverApplication.rejectReason }}
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
  justify-content: flex-start;
  padding: 24px 16px 60px;
  position: relative;
  overflow-x: hidden;
}

.PageDriverRegister__watermark {
  position: fixed;
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
  z-index: 0;
}

.PageDriverRegister__card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 480px;
  background: rgba(40, 37, 31, 0.85);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(212, 134, 10, 0.2);
  border-radius: 20px;
  padding: 32px 24px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 24px;
}

.PageDriverRegister__logo {
  font-family: $font-display;
  font-size: 32px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;
  margin-bottom: 6px;

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
  margin: 20px 0;
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
  gap: 6px;
  margin-bottom: 12px;
}

.PageDriverRegister__avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid rgba(212, 134, 10, 0.4);
  object-fit: cover;
}

.PageDriverRegister__user-name {
  font-family: $font-body;
  font-size: 13px;
  color: var(--da-cream);
  font-weight: 500;
}

.PageDriverRegister__heading {
  font-family: $font-condensed;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--da-cream);
  margin-bottom: 16px;
  text-align: center;
}

.PageDriverRegister__success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-family: $font-body;
  font-size: 14px;
  color: #4ade80;
  padding: 24px 0;

  span:first-child { font-size: 36px; }
}

// ── 區塊標題 ────────────────────────────────────────────
.PageDriverRegister__section-title {
  width: 100%;
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin: 16px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(212, 134, 10, 0.2);
}

.PageDriverRegister__section-title:first-of-type { margin-top: 0; }

// ── 表單欄位 ────────────────────────────────────────────
.PageDriverRegister__field {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.PageDriverRegister__label {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.75);
}

.PageDriverRegister__required {
  color: #f87171;
  margin-left: 2px;
}

.PageDriverRegister__input {
  width: 100%;
  padding: 9px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  font-family: $font-body;
  font-size: 14px;
  color: #fff;

  &::placeholder { color: rgba(255, 255, 255, 0.3); }
  &:focus {
    outline: none;
    border-color: rgba(212, 134, 10, 0.5);
    background: rgba(255, 255, 255, 0.08);
  }
}

// ── Radio 車型 ──────────────────────────────────────────
.PageDriverRegister__radio-group {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.PageDriverRegister__radio {
  position: relative;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: $font-condensed;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);

  input { display: none; }

  &.is-active {
    border-color: rgba(212, 134, 10, 0.5);
    background: rgba(212, 134, 10, 0.12);
    color: var(--da-amber);
  }

  &:hover:not(.is-active) {
    background: rgba(255, 255, 255, 0.08);
  }
}

// ── 證件上傳區 ──────────────────────────────────────────
.PageDriverRegister__docs {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 8px;
}

@media (max-width: 480px) {
  .PageDriverRegister__docs {
    grid-template-columns: 1fr;
  }
}

// ── 訊息與按鈕 ──────────────────────────────────────────
.PageDriverRegister__error {
  width: 100%;
  font-family: $font-body;
  font-size: 13px;
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 10px;
  padding: 10px 14px;
  margin-top: 12px;
}

.PageDriverRegister__submit-btn {
  width: 100%;
  margin-top: 16px;
  padding: 13px 8px;
  background: var(--da-amber);
  color: var(--da-dark);
  border: none;
  border-radius: 10px;
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  &:not(:disabled):hover { opacity: 0.9; }
  &:not(:disabled):active { transform: scale(0.98); }
}

.PageDriverRegister__desc {
  font-family: $font-body;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.65);
  margin-bottom: 16px;
  text-align: center;
}

.PageDriverRegister__hint {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 24px;
  text-align: center;
}

.PageDriverRegister__status-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.PageDriverRegister__cooldown {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 16px 0 24px;
  padding: 14px 20px;
  background: rgba(248, 113, 113, 0.06);
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 12px;
}

.PageDriverRegister__cooldown-label {
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: rgba(248, 113, 113, 0.7);
  text-transform: uppercase;
}

.PageDriverRegister__cooldown-time {
  font-family: $font-display;
  font-size: 28px;
  letter-spacing: 0.06em;
  color: #f87171;
  font-variant-numeric: tabular-nums;
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
  padding: 11px 8px;
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

// P29：driver OA 加好友 CTA（pending mode 顯示）
.PageDriverRegister__oa-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 16px;
  margin-bottom: 12px;
  padding: 12px 14px;
  background: rgba(6, 199, 85, 0.16);
  border: 1px solid rgba(6, 199, 85, 0.4);
  border-radius: 10px;
  text-decoration: none;
  transition: background 0.2s;

  &:hover { background: rgba(6, 199, 85, 0.24); }
}

.PageDriverRegister__oa-cta-icon { font-size: 18px; }

.PageDriverRegister__oa-cta-text {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 500;
  color: #4ade80;
  text-align: center;
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
