<script setup lang="ts">
// Admin 敏感操作 PIN 設定頁
// - 未設過（admins.pinSetAt 空）→ 顯示「新 PIN + 確認新 PIN」
// - 已設過 → 顯示「舊 PIN + 新 PIN + 確認新 PIN」三欄
//
// 走 $api.SetupAdminPin；完成 ElMessage success + replace 回 /admin/settings

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const router = useRouter();

const loading = ref(true);
const submitting = ref(false);
const errorMsg = ref('');
const hasExistingPin = ref(false);

const oldPin = ref('');
const newPin = ref('');
const confirmPin = ref('');

const _LoadStatus = async () => {
  loading.value = true;
  try {
    if (typeof window === 'undefined') return;
    const { getApps } = await import('firebase/app');
    if (!getApps().length) { loading.value = false; return; }
    const { getFirestore, doc, getDoc } = await import('firebase/firestore');
    const db = getFirestore();
    // user.uid 形如 'line:Uxxx'；admins doc key 不含前綴
    const uid = (authStore.user?.uid ?? '').replace(/^line:/, '');
    if (!uid) { loading.value = false; return; }
    const snap = await getDoc(doc(db, 'admins', uid));
    hasExistingPin.value = !!snap.data()?.pinSetAt;
  } catch {
    hasExistingPin.value = false;
  } finally {
    loading.value = false;
  }
};

const ClickSubmit = async () => {
  errorMsg.value = '';
  if (!/^\d{4,8}$/.test(newPin.value)) {
    errorMsg.value = '新 PIN 必須為 4-8 位純數字';
    return;
  }
  if (newPin.value !== confirmPin.value) {
    errorMsg.value = '兩次輸入的新 PIN 不一致';
    return;
  }
  if (hasExistingPin.value && !/^\d{4,8}$/.test(oldPin.value)) {
    errorMsg.value = '請輸入舊 PIN';
    return;
  }

  submitting.value = true;
  try {
    const body: { newPin: string; oldPin?: string } = { newPin: newPin.value };
    if (hasExistingPin.value) body.oldPin = oldPin.value;
    const res = await $api.SetupAdminPin(body);
    if (res.status?.code !== 200) {
      errorMsg.value = res.status?.message?.zh_tw || '設定失敗';
      return;
    }
    ElMessage({ message: hasExistingPin.value ? 'PIN 已更新' : 'PIN 已設定', type: 'success' });
    await router.replace('/admin/settings');
  } finally {
    submitting.value = false;
  }
};

onMounted(() => { void _LoadStatus(); });
</script>

<template lang="pug">
.AdminSettingsPin
  .AdminSettingsPin__card
    h1.AdminSettingsPin__title 敏感操作 PIN

    p.AdminSettingsPin__lead
      | 此 PIN 為步階驗證（step-up auth），於以下操作前要求二次確認：
    ul.AdminSettingsPin__list
      li LINE 廣播
      li 加 / 撤管理員角色
      li 車資進階規則寫入

    p.AdminSettingsPin__warn ⚠️ PIN 通過後在 sessionStorage 內保留 5 分鐘；登出後失效。

    .AdminSettingsPin__loading(v-if="loading") 載入狀態中…

    template(v-else)
      .AdminSettingsPin__field(v-if="hasExistingPin")
        label.AdminSettingsPin__label 舊 PIN
        ElInput(
          v-model="oldPin"
          type="password"
          show-password
          maxlength="8"
          minlength="4"
          inputmode="numeric"
          placeholder="輸入目前 PIN"
        )

      .AdminSettingsPin__field
        label.AdminSettingsPin__label 新 PIN
        ElInput(
          v-model="newPin"
          type="password"
          show-password
          maxlength="8"
          minlength="4"
          inputmode="numeric"
          placeholder="4-8 位數字"
        )

      .AdminSettingsPin__field
        label.AdminSettingsPin__label 再次輸入新 PIN
        ElInput(
          v-model="confirmPin"
          type="password"
          show-password
          maxlength="8"
          minlength="4"
          inputmode="numeric"
          placeholder="再輸入一次"
          @keyup.enter="ClickSubmit"
        )

      .AdminSettingsPin__error(v-if="errorMsg") {{ errorMsg }}

      .AdminSettingsPin__actions
        ElButton(@click="router.replace('/admin/settings')") 取消
        ElButton(type="primary" :loading="submitting" @click="ClickSubmit") {{ hasExistingPin ? '更新' : '設定' }}
</template>

<style lang="scss" scoped>
.AdminSettingsPin {
  padding: 24px;
  display: flex;
  justify-content: center;
}
.AdminSettingsPin__card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 12px;
  padding: 28px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.AdminSettingsPin__title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 12px;
}
.AdminSettingsPin__lead {
  font-size: 13px;
  color: #555;
  margin: 0 0 4px;
  line-height: 1.6;
}
.AdminSettingsPin__list {
  margin: 0 0 12px 18px;
  padding: 0;
  font-size: 13px;
  color: #555;
  line-height: 1.8;
}
.AdminSettingsPin__warn {
  font-size: 12px;
  color: #b54708;
  background: #fffaeb;
  border: 1px solid #fedf89;
  border-radius: 8px;
  padding: 8px 10px;
  margin: 8px 0 18px;
  line-height: 1.6;
}
.AdminSettingsPin__loading {
  text-align: center;
  color: #888;
  padding: 24px 0;
}
.AdminSettingsPin__field {
  margin: 12px 0;
}
.AdminSettingsPin__label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #333;
}
.AdminSettingsPin__error {
  color: #c4262e;
  font-size: 13px;
  margin: 8px 0;
}
.AdminSettingsPin__actions {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
