// 推薦碼落地捕捉 + 綁定（推薦獎勵機制 Phase 2）
//
// 設計：openspec/changes/2026-05-20-referral-share-reward/design.md §4 ③
//
// 兩段流程：
//   1. 落地捕捉：進站若 URL 帶 ?ref=<6 碼推薦碼>，立即存入 localStorage。
//      盡早執行 —— 趕在 auth.client.ts 觸發的 liff.login() redirect 前先存好。
//   2. 待 auth 解析完成且已登入 → 呼叫 /referral/bind；防刷檢查由 server 負責。
//      收到回應（成功或業務拒絕）即清除；網路層失敗則保留，下次進站重試。
const REF_STORAGE_KEY = 'da_referral_ref';
const REF_CODE_REGEX = /^[A-Z0-9]{6}$/;

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;

  // 1. 落地捕捉
  try {
    const raw = new URLSearchParams(window.location.search).get('ref');
    const ref = raw ? raw.trim().toUpperCase() : '';
    if (ref && REF_CODE_REGEX.test(ref)) {
      localStorage.setItem(REF_STORAGE_KEY, ref);
    }
  } catch {
    // localStorage 不可用（隱私模式等）→ 略過，不影響其他流程
  }

  // 2. 待登入後綁定（不阻塞 plugin 回傳）
  const authStore = StoreAuth();
  void (async () => {
    await Promise.race([
      authStore.WaitForAuthResolved(),
      new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
    ]);
    if (!authStore.isSignIn) return;

    let pendingRef: string | null = null;
    try {
      pendingRef = localStorage.getItem(REF_STORAGE_KEY);
    } catch {
      return;
    }
    if (!pendingRef) return;

    const idToken = await authStore.GetFreshIdToken();
    if (!idToken) return;

    try {
      await $fetch('/nuxt-api/referral/bind', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: { ref: pendingRef },
      });
      // 收到回應（綁定成功或被防刷拒絕）→ 清除；bind 為 write-once，重試無益
      try {
        localStorage.removeItem(REF_STORAGE_KEY);
      } catch {
        // 忽略
      }
    } catch (err) {
      // 網路層錯誤 → 保留 ref，下次進站重試
      console.warn('[referral] bind request failed, will retry next visit:', err);
    }
  })();
});
