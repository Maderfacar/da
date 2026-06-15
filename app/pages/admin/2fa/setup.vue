<script setup lang="ts">
// Admin 2FA TOTP enrollment page
// 流程：onMounted 呼叫 /2fa/setup 取 otpauthUrl + qrcodeDataUrl + secret →
//      使用者用 authenticator app 掃 QR 或手動輸入 secret → 輸入 6 位數 →
//      呼叫 /2fa/verify-enrollment → 成功寫 localStorage sessionToken → /admin/dashboard

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const router = useRouter();

interface SetupRes { otpauthUrl: string; qrcodeDataUrl: string; secret: string }
interface VerifyRes { sessionToken: string }
interface ApiEnvelope<T> { data?: T; status?: { code: number; message?: { zh_tw?: string } } }

const loading = ref(false);
const otpauthUrl = ref('');
const qrcodeDataUrl = ref('');
const manualSecret = ref('');
const code = ref('');
const errorMsg = ref('');
const submitting = ref(false);

const ApiSetup = async () => {
  loading.value = true;
  errorMsg.value = '';
  try {
    const idToken = await authStore.GetFreshIdToken();
    const res = await $fetch<ApiEnvelope<SetupRes>>('/nuxt-api/admin/2fa/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res?.status?.code !== 200 || !res.data) {
      errorMsg.value = res?.status?.message?.zh_tw || '初始化失敗';
      return;
    }
    otpauthUrl.value = res.data.otpauthUrl;
    qrcodeDataUrl.value = res.data.qrcodeDataUrl;
    manualSecret.value = res.data.secret;
  } catch (err: unknown) {
    const e = err as { data?: ApiEnvelope<unknown> };
    errorMsg.value = e?.data?.status?.message?.zh_tw || '初始化失敗';
  } finally {
    loading.value = false;
  }
};

const ClickConfirm = async () => {
  if (!/^\d{6}$/.test(code.value)) {
    errorMsg.value = '請輸入 6 位數驗證碼';
    return;
  }
  submitting.value = true;
  errorMsg.value = '';
  try {
    const idToken = await authStore.GetFreshIdToken();
    const res = await $fetch<ApiEnvelope<VerifyRes>>('/nuxt-api/admin/2fa/verify-enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      body: { code: code.value },
    });
    if (res?.status?.code !== 200 || !res.data?.sessionToken) {
      errorMsg.value = res?.status?.message?.zh_tw || '驗證失敗';
      return;
    }
    try { localStorage.setItem('da_admin_2fa_session', res.data.sessionToken); } catch { /* ignore */ }
    authStore.admin2faEnrolled = true;
    authStore.admin2faSessionVerified = true;
    await router.replace('/admin/dashboard');
  } catch (err: unknown) {
    const e = err as { data?: ApiEnvelope<unknown> };
    errorMsg.value = e?.data?.status?.message?.zh_tw || '驗證失敗';
  } finally {
    submitting.value = false;
  }
};

onMounted(() => { void ApiSetup(); });
</script>

<template lang="pug">
.Admin2faSetup
  .Admin2faSetup__card
    h1.Admin2faSetup__title 綁定兩階段驗證
    p.Admin2faSetup__lead 請用 Google Authenticator / 1Password / Authy 任一 app 掃描下方 QR Code 或手動輸入金鑰，然後輸入 6 位數驗證碼完成綁定。
    p.Admin2faSetup__warn ⚠️ 沒有備援碼。若裝置遺失，請聯絡 super admin 至 Firestore 手動清除 totpSecret 與 totpEnrolledAt 後重新綁定。

    .Admin2faSetup__loading(v-if="loading") 初始化中…

    template(v-else-if="qrcodeDataUrl")
      .Admin2faSetup__qr
        img(:src="qrcodeDataUrl" alt="TOTP QR Code" width="240" height="240")
      .Admin2faSetup__secret
        .Admin2faSetup__secretLabel 手動輸入金鑰：
        code.Admin2faSetup__secretCode {{ manualSecret }}

      .Admin2faSetup__field
        label.Admin2faSetup__label 6 位數驗證碼
        ElInput(
          v-model="code"
          maxlength="6"
          inputmode="numeric"
          placeholder="000000"
          @keyup.enter="ClickConfirm"
        )

      .Admin2faSetup__error(v-if="errorMsg") {{ errorMsg }}

      .Admin2faSetup__actions
        ElButton(type="primary" :loading="submitting" @click="ClickConfirm") 完成綁定

    .Admin2faSetup__error(v-else-if="errorMsg") {{ errorMsg }}
</template>

<style lang="scss" scoped>
.Admin2faSetup {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #f5f5f7;
}
.Admin2faSetup__card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.Admin2faSetup__title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 12px;
}
.Admin2faSetup__lead {
  font-size: 14px;
  color: #555;
  line-height: 1.6;
  margin: 0 0 8px;
}
.Admin2faSetup__warn {
  font-size: 13px;
  color: #b54708;
  background: #fffaeb;
  border: 1px solid #fedf89;
  border-radius: 8px;
  padding: 10px 12px;
  margin: 12px 0 20px;
  line-height: 1.6;
}
.Admin2faSetup__loading {
  text-align: center;
  color: #888;
  padding: 32px 0;
}
.Admin2faSetup__qr {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}
.Admin2faSetup__secret {
  margin: 12px 0 20px;
  text-align: center;
}
.Admin2faSetup__secretLabel {
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}
.Admin2faSetup__secretCode {
  display: inline-block;
  font-family: monospace;
  font-size: 15px;
  letter-spacing: 1px;
  background: #f0f0f3;
  padding: 6px 10px;
  border-radius: 6px;
  word-break: break-all;
}
.Admin2faSetup__field {
  margin: 16px 0 8px;
}
.Admin2faSetup__label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #333;
}
.Admin2faSetup__error {
  color: #c4262e;
  font-size: 13px;
  margin: 8px 0;
}
.Admin2faSetup__actions {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
