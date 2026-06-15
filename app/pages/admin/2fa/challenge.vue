<script setup lang="ts">
// Admin 2FA TOTP challenge page
// 流程：admin 已綁但 session 過期 / 新開瀏覽器 → 輸 6 位數 → /2fa/verify-login →
//      成功寫 localStorage sessionToken → 回 next query path 或 /admin/dashboard

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const route = useRoute();
const router = useRouter();

interface VerifyRes { sessionToken: string }
interface ApiEnvelope<T> { data?: T; status?: { code: number; message?: { zh_tw?: string } } }

const code = ref('');
const errorMsg = ref('');
const submitting = ref(false);

const ClickVerify = async () => {
  if (!/^\d{6}$/.test(code.value)) {
    errorMsg.value = '請輸入 6 位數驗證碼';
    return;
  }
  submitting.value = true;
  errorMsg.value = '';
  try {
    const idToken = await authStore.GetFreshIdToken();
    const res = await $fetch<ApiEnvelope<VerifyRes>>('/nuxt-api/admin/2fa/verify-login', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      body: { code: code.value },
    });
    if (res?.status?.code !== 200 || !res.data?.sessionToken) {
      errorMsg.value = res?.status?.message?.zh_tw || '驗證失敗';
      return;
    }
    try { localStorage.setItem('da_admin_2fa_session', res.data.sessionToken); } catch { /* ignore */ }
    authStore.admin2faSessionVerified = true;

    // 解 next query；防 open redirect（必 /admin/ 開頭、無 //、無 scheme）
    const rawNext = String(route.query.next ?? '');
    let target = '/admin/dashboard';
    if (rawNext.startsWith('/admin/') && !rawNext.includes('//') && !rawNext.includes(':') && !rawNext.startsWith('/admin/2fa')) {
      target = rawNext;
    }
    await router.replace(target);
  } catch (err: unknown) {
    const e = err as { data?: ApiEnvelope<unknown> };
    errorMsg.value = e?.data?.status?.message?.zh_tw || '驗證失敗';
  } finally {
    submitting.value = false;
  }
};
</script>

<template lang="pug">
.Admin2faChallenge
  .Admin2faChallenge__card
    h1.Admin2faChallenge__title 兩階段驗證
    p.Admin2faChallenge__lead 請輸入您的 authenticator app 顯示的 6 位數驗證碼。

    .Admin2faChallenge__field
      ElInput(
        v-model="code"
        maxlength="6"
        inputmode="numeric"
        placeholder="000000"
        @keyup.enter="ClickVerify"
      )

    .Admin2faChallenge__error(v-if="errorMsg") {{ errorMsg }}

    .Admin2faChallenge__actions
      ElButton(type="primary" :loading="submitting" @click="ClickVerify") 驗證

    p.Admin2faChallenge__help 忘記裝置？請聯絡 super admin 至 Firestore 手動清除 totpSecret 與 totpEnrolledAt 後重新綁定。
</template>

<style lang="scss" scoped>
.Admin2faChallenge {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #f5f5f7;
}
.Admin2faChallenge__card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.Admin2faChallenge__title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 12px;
}
.Admin2faChallenge__lead {
  font-size: 14px;
  color: #555;
  line-height: 1.6;
  margin: 0 0 20px;
}
.Admin2faChallenge__field {
  margin: 12px 0;
}
.Admin2faChallenge__error {
  color: #c4262e;
  font-size: 13px;
  margin: 8px 0;
}
.Admin2faChallenge__actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.Admin2faChallenge__help {
  font-size: 12px;
  color: #888;
  line-height: 1.6;
  margin: 20px 0 0;
}
</style>
