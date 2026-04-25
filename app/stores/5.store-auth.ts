// Firebase Auth + LINE LIFF 認證狀態管理
// InitAuthFlow() 由 app/plugins/auth.client.ts 呼叫，確保僅在瀏覽器端執行
export const StoreAuth = defineStore('StoreAuth', () => {

  // -- State -----------------------------------------------------------------------------------------

  /** 當前登入 Firebase User 物件 */
  const user = ref<import('firebase/auth').User | null>(null);

  /** 使用者角色，由 Firestore 自訂聲明或查詢後寫入 */
  const role = ref<'passenger' | 'driver' | 'admin' | null>(null);

  /** 是否已完成 Firebase Auth 狀態首次確認（解決初始化前 flicker 問題） */
  const authResolved = ref(false);

  /** LINE LIFF 是否已完成初始化 */
  const liffReady = ref(false);

  /** LINE Access Token */
  const lineAccessToken = ref<string>('');

  // -- Computed --------------------------------------------------------------------------------------

  /** 是否已登入 */
  const isSignIn = computed(() => !!user.value);

  /** Firebase ID Token（供 BFF 驗證使用） */
  const idToken = ref<string>('');

  // -- Helpers ---------------------------------------------------------------------------------------

  const _clearState = () => {
    user.value = null;
    role.value = null;
    idToken.value = '';
    lineAccessToken.value = '';
    liffReady.value = false;
  };

  // -- Flow Control ----------------------------------------------------------------------------------

  /**
   * 初始化 Firebase onAuthStateChanged 監聽器與 LINE LIFF。
   * 由 app/plugins/auth.client.ts 在 client 端啟動時呼叫一次。
   */
  const InitAuthFlow = async () => {
    const config = useRuntimeConfig().public;

    // Firebase 設定未填入時（開發初期）跳過初始化，直接標記已解析
    if (!config.firebaseApiKey) {
      authResolved.value = true;
      return;
    }

    const { initializeApp, getApps } = await import('firebase/app');
    const { getAuth, onAuthStateChanged } = await import('firebase/auth');

    const firebaseApp = getApps().length
      ? getApps()[0]
      : initializeApp({
          apiKey: config.firebaseApiKey,
          authDomain: config.firebaseAuthDomain,
          projectId: config.firebaseProjectId,
          storageBucket: config.firebaseStorageBucket,
          messagingSenderId: config.firebaseMessagingSenderId,
          appId: config.firebaseAppId,
        });

    const auth = getAuth(firebaseApp);

    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        user.value = firebaseUser;
        idToken.value = await firebaseUser.getIdToken();
        // TODO: 從 Firestore 或 Custom Claims 取得 role 並寫入 role.value
      } else {
        _clearState();
      }
      authResolved.value = true;
    });

    // LIFF 初始化（依路徑決定 liffId）
    await _InitLiffFlow();
  };

  /**
   * 依當前路徑決定使用乘客或司機的 LIFF ID 並完成初始化。
   */
  const _InitLiffFlow = async () => {
    const config = useRuntimeConfig().public;
    const route = useRoute();

    const liffId = route.path.startsWith('/driver')
      ? config.lineLiffIdDriver
      : config.lineLiffIdPassenger;

    if (!liffId) return;

    try {
      const liff = (await import('@line/liff')).default;
      await liff.init({ liffId });

      if (liff.isLoggedIn()) {
        lineAccessToken.value = liff.getAccessToken() ?? '';
        liffReady.value = true;
      }
    } catch {
      // LIFF 環境外（非 LINE App 開啟）時靜默略過
    }
  };

  // -- Actions ---------------------------------------------------------------------------------------

  /** 設定使用者角色（由 Firestore 查詢後呼叫） */
  const SetRole = (_role: 'passenger' | 'driver' | 'admin') => {
    role.value = _role;
  };

  /** 登出：清除 Firebase session 並重置狀態 */
  const SignOut = async () => {
    const { getAuth } = await import('firebase/auth');
    await getAuth().signOut();
    _clearState();
    authResolved.value = false;
    navigateTo('/');
  };

  // -------------------------------------------------------------------------------------------------
  return {
    user,
    role,
    authResolved,
    liffReady,
    lineAccessToken,
    isSignIn,
    idToken,
    InitAuthFlow,
    SetRole,
    SignOut,
  };
});
