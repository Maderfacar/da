// Firebase Auth + LINE LIFF 認證狀態管理
// InitAuthFlow() 由 app/plugins/auth.client.ts 呼叫，確保僅在瀏覽器端執行
export const StoreAuth = defineStore('StoreAuth', () => {

  // -- State -----------------------------------------------------------------------------------------

  const user = ref<import('firebase/auth').User | null>(null);
  const role = ref<'passenger' | 'driver' | 'admin' | null>(null);
  const authResolved = ref(false);
  const liffReady = ref(false);
  const lineAccessToken = ref('');
  const lineProfile = ref<{ displayName: string; pictureUrl: string } | null>(null);
  const idToken = ref('');
  const isFriend = ref<boolean | null>(null); // null = 尚未查詢

  // -- Computed --------------------------------------------------------------------------------------

  const isSignIn = computed(() => !!user.value);

  // -- Helpers ---------------------------------------------------------------------------------------

  const _clearState = () => {
    user.value = null;
    role.value = null;
    idToken.value = '';
    lineAccessToken.value = '';
    lineProfile.value = null;
    liffReady.value = false;
    isFriend.value = null;
  };

  // -- Flow Control ----------------------------------------------------------------------------------

  const InitAuthFlow = async () => {
    const config = useRuntimeConfig().public;

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
      try {
        if (firebaseUser) {
          user.value = firebaseUser;
          idToken.value = await firebaseUser.getIdToken();
          await _LoadRoleFromFirestore(firebaseApp, firebaseUser.uid);
        } else {
          _clearState();
        }
      } catch {
        _clearState();
      } finally {
        authResolved.value = true;
      }
    });

    await _InitLiffFlow(firebaseApp);
  };

  const _LoadRoleFromFirestore = async (firebaseApp: import('firebase/app').FirebaseApp, uid: string) => {
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const db = getFirestore(firebaseApp);
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        role.value = snap.data().role as 'passenger' | 'driver' | 'admin';
      }
    } catch {
      // Firestore 讀取失敗時維持 null
    }
  };

  const _InitLiffFlow = async (firebaseApp: import('firebase/app').FirebaseApp) => {
    const config = useRuntimeConfig().public;
    const route = useRoute();

    const isDriverPath = route.path.startsWith('/driver');
    const liffId = isDriverPath ? config.lineLiffIdDriver : config.lineLiffIdPassenger;
    const clientType = isDriverPath ? 'driver' : 'passenger';

    if (!liffId) { liffReady.value = true; return; }

    try {
      const liff = (await import('@line/liff')).default;
      await liff.init({ liffId });

      if (!liff.isLoggedIn()) {
        liffReady.value = true;
        return;
      }

      const token = liff.getAccessToken() ?? '';
      lineAccessToken.value = token;

      // 查詢是否已加官方帳號好友
      try {
        const friendship = await liff.getFriendship();
        isFriend.value = friendship.friendFlag;
      } catch {
        isFriend.value = null;
      }

      liffReady.value = true;

      // 已有 Firebase 使用者 → 不重複登入
      const { getAuth } = await import('firebase/auth');
      if (getAuth(firebaseApp).currentUser) return;

      // 交換 Firebase Custom Token
      const res = await $fetch<{ data: { customToken: string; role: string; displayName: string; pictureUrl: string } }>(
        '/nuxt-api/auth/line-exchange',
        { method: 'POST', body: { lineAccessToken: token, clientType } },
      );

      if (!res.data?.customToken) return;

      lineProfile.value = { displayName: res.data.displayName, pictureUrl: res.data.pictureUrl };

      const { signInWithCustomToken } = await import('firebase/auth');
      await signInWithCustomToken(getAuth(firebaseApp), res.data.customToken);
      // onAuthStateChanged 接手後續
    } catch {
      liffReady.value = true;
    }
  };

  // -- Actions ---------------------------------------------------------------------------------------

  const SetRole = (_role: 'passenger' | 'driver' | 'admin') => { role.value = _role; };

  /** 測試模式：直接設定角色（TestMode 用，不走 Firebase） */
  const MockSignIn = (_role: 'passenger' | 'driver' | 'admin') => {
    // 設定 mock user 讓 isSignIn = true，否則 auth middleware 會一直 redirect
    user.value = { uid: `mock-${_role}` } as import('firebase/auth').User;
    role.value = _role;
    authResolved.value = true;
  };

  const SignOut = async () => {
    try {
      const { getAuth } = await import('firebase/auth');
      await getAuth().signOut();
    } catch { /* Firebase 未初始化時忽略 */ }
    _clearState();
    authResolved.value = false;
    navigateTo('/');
  };

  // -------------------------------------------------------------------------------------------------
  return {
    user, role, authResolved, liffReady, lineAccessToken, lineProfile, isFriend,
    isSignIn, idToken,
    InitAuthFlow, SetRole, MockSignIn, SignOut,
  };
});
