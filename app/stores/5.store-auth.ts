// Firebase Auth + LINE LIFF 認證狀態管理
// InitAuthFlow() 由 app/plugins/auth.client.ts 呼叫，確保僅在瀏覽器端執行
export const StoreAuth = defineStore('StoreAuth', () => {

  // -- State -----------------------------------------------------------------------------------------

  const user = ref<import('firebase/auth').User | null>(null);
  const role = ref<'passenger' | 'driver' | 'admin' | null>(null);
  const approved = ref<boolean>(true); // passenger 預設 true；driver/admin 從 Firestore 讀取
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
    approved.value = true;
    idToken.value = '';
    lineAccessToken.value = '';
    lineProfile.value = null;
    liffReady.value = false;
    isFriend.value = null;
  };

  // -- Flow Control ----------------------------------------------------------------------------------

  const InitAuthFlow = async () => {
    const config = useRuntimeConfig().public;

    // 安全超時：Firebase / LIFF 若在 12 秒內未回應，強制解除 loading 遮罩
    // 確保 LINE WebView 網路受限或 SDK hang 住時，使用者不會永久卡在轉圈圈
    const safetyTimer = setTimeout(() => {
      if (!authResolved.value) {
        console.warn('[StoreAuth] 初始化逾時 (12s)，強制解除 loading');
        authResolved.value = true;
      }
    }, 12_000);

    if (!config.firebaseApiKey) {
      clearTimeout(safetyTimer);
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
      clearTimeout(safetyTimer); // Firebase 成功回應，取消安全計時器
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
      // Firebase UID 格式為 line:{lineUserId}，Firestore 文件 key 直接使用 LINE UID
      const lineUid = uid.startsWith('line:') ? uid.slice(5) : uid;
      const snap = await getDoc(doc(db, 'users', lineUid));
      if (snap.exists()) {
        const data = snap.data();
        role.value = data.role as 'passenger' | 'driver' | 'admin';
        // passenger 永遠核准；driver/admin 讀取 approved 欄位
        approved.value = role.value === 'passenger' ? true : (data.approved as boolean) ?? false;
      }
    } catch {
      // Firestore 讀取失敗時維持預設值
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

      // 加入 10 秒 timeout，防止 liff.init() 在 LINE WebView 中 hang 住不返回
      await Promise.race([
        liff.init({ liffId }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('liff.init 逾時')), 10_000)
        ),
      ]);

      if (!liff.isLoggedIn()) {
        liff.login(); // 強制導向 LINE 登入，redirect 後重新執行
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
    user.value = { uid: `mock-${_role}` } as import('firebase/auth').User;
    role.value = _role;
    approved.value = true; // 測試模式視為已核准
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
    user, role, approved, authResolved, liffReady, lineAccessToken, lineProfile, isFriend,
    isSignIn, idToken,
    InitAuthFlow, SetRole, MockSignIn, SignOut,
  };
});
