// Firebase Auth + LINE LIFF 客戶端初始化
// .client.ts 確保此 plugin 僅在瀏覽器執行，完全規避 SSR 的 window/navigator 未定義問題
//
// Debug：開發者可在 DevTools Console 透過 window.__authStore 即時讀取
// roles / lineProfile / approved 等狀態，便於排查 auth 流程問題（無 console log 噪音）。
export default defineNuxtPlugin(() => {
  const { testMode } = useRuntimeConfig().public;
  const authStore = StoreAuth();

  if (typeof window !== 'undefined') {
    (window as unknown as { __authStore: ReturnType<typeof StoreAuth> }).__authStore = authStore;
  }

  // E2E bypass：Playwright fixture 用 addInitScript 預塞 window.__E2E_MODE__ = true
  // 同時可指定 window.__E2E_ROLES__ + __E2E_PATCH__；走與 testMode='T' 同一道既有 mock 閘
  // 風險共用：不增加新的「prod 後門」面，env 在 prod 必須未設或不為 'T'，window flag 在 prod 也無人注入
  type E2EPatch = { approved?: boolean; admin2faEnrolled?: boolean; admin2faSessionVerified?: boolean };
  const e2eWindow = window as unknown as {
    __E2E_MODE__?: boolean;
    __E2E_ROLES__?: ('passenger' | 'driver' | 'admin')[];
    __E2E_PATCH__?: E2EPatch;
  };
  const isMockMode = testMode === 'T' || e2eWindow.__E2E_MODE__ === true;

  if (isMockMode) {
    // 本地開發 / E2E：直接 mock 角色，跳過 LIFF / Firebase
    authStore.MockSignIn(e2eWindow.__E2E_ROLES__ ?? ['passenger']);
    const patch = e2eWindow.__E2E_PATCH__;
    if (patch) {
      if (patch.approved !== undefined) authStore.approved = patch.approved;
      if (patch.admin2faEnrolled !== undefined) authStore.admin2faEnrolled = patch.admin2faEnrolled;
      if (patch.admin2faSessionVerified !== undefined) authStore.admin2faSessionVerified = patch.admin2faSessionVerified;
    }
    return;
  }

  authStore.InitAuthFlow();
});
