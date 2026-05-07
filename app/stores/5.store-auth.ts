// Firebase Auth + LINE LIFF 認證狀態管理
// InitAuthFlow() 由 app/plugins/auth.client.ts 呼叫，確保僅在瀏覽器端執行
//
// P10（2026/05/07 起）：身分模型由單一 role 改為 roles[] 陣列，支援單一使用者同時具
// passenger / driver / admin 多重身分。approved 仍為單一 boolean，僅代表 driver 核准狀態。
type Role = 'passenger' | 'driver' | 'admin';

export const StoreAuth = defineStore('StoreAuth', () => {

  // -- State -----------------------------------------------------------------------------------------

  const user = ref<import('firebase/auth').User | null>(null);
  const roles = ref<Role[]>([]);
  const approved = ref<boolean>(true); // 僅作為 driver 核准旗標；passenger/admin 永遠視為 true
  const authResolved = ref(false);
  const liffReady = ref(false);
  const lineAccessToken = ref('');
  const lineProfile = ref<{ displayName: string; pictureUrl: string } | null>(null);
  const idToken = ref('');
  const isFriend = ref<boolean | null>(null); // null = 尚未查詢

  // 司機申請狀態（P8）：null = 未申請；rejectedAt 有值 = 已被拒絕等待 admin 解除
  const driverApplication = ref<{
    appliedAt: string | null;
    reviewedAt: string | null;
    rejectedAt: string | null;
    rejectReason: string | null;
  } | null>(null);

  // -- Computed --------------------------------------------------------------------------------------

  const isSignIn = computed(() => !!user.value);
  const isAdmin = computed(() => roles.value.includes('admin'));
  const isDriver = computed(() => roles.value.includes('driver'));
  const isPassenger = computed(() => roles.value.includes('passenger'));
  const isApprovedDriver = computed(() => isDriver.value && approved.value);

  // -- Helpers ---------------------------------------------------------------------------------------

  const _clearState = () => {
    user.value = null;
    roles.value = [];
    approved.value = true;
    idToken.value = '';
    lineAccessToken.value = '';
    lineProfile.value = null;
    liffReady.value = false;
    isFriend.value = null;
    driverApplication.value = null;
  };

  const _normalizeRoles = (raw: unknown): Role[] => {
    if (!Array.isArray(raw)) return [];
    const valid = raw.filter((r): r is Role => r === 'passenger' || r === 'driver' || r === 'admin');
    return valid;
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
          await _LoadRolesFromFirestore(firebaseApp, firebaseUser.uid);
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

  const _LoadRolesFromFirestore = async (firebaseApp: import('firebase/app').FirebaseApp, uid: string) => {
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const db = getFirestore(firebaseApp);
      // Firebase UID 格式為 line:{lineUserId}，Firestore 文件 key 直接使用 LINE UID
      const lineUid = uid.startsWith('line:') ? uid.slice(5) : uid;
      const snap = await getDoc(doc(db, 'users', lineUid));
      if (snap.exists()) {
        const data = snap.data();
        const parsed = _normalizeRoles(data.roles);
        roles.value = parsed.length > 0 ? parsed : ['passenger']; // 防呆：至少給 passenger
        approved.value = (data.approved as boolean) ?? false;
        // 補回 LINE profile（避免重新整理後因 Firebase session 命中跳過 LIFF 導致 lineProfile=null）
        const displayName = data.displayName as string | undefined;
        const pictureUrl = data.pictureUrl as string | undefined;
        if (displayName && pictureUrl) {
          lineProfile.value = { displayName, pictureUrl };
        }
        // 補回司機申請狀態（P8）：register 頁與 driver/auth watch 依此分流
        const appData = data.driverApplication as Record<string, unknown> | undefined;
        if (appData) {
          driverApplication.value = {
            appliedAt: (appData.appliedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (appData.appliedAt as string | null) ?? null,
            reviewedAt: (appData.reviewedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (appData.reviewedAt as string | null) ?? null,
            rejectedAt: (appData.rejectedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (appData.rejectedAt as string | null) ?? null,
            rejectReason: (appData.rejectReason as string | null) ?? null,
          };
        } else {
          driverApplication.value = null;
        }
      }
    } catch {
      // Firestore 讀取失敗時維持預設值
    }
  };

  const _InitLiffFlow = async (firebaseApp: import('firebase/app').FirebaseApp) => {
    const config = useRuntimeConfig().public;
    const route = useRoute();

    // 三端統一走 LINE LIFF（admin 改採 Firestore roles 陣列白名單，2026/05/07 起 P10）
    // admin 端從 LINE 入口進入時走 passenger LIFF App（roles 由 Firestore 決定，與 LIFF App 無關）
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

      // LIFF 已登入 → 主動取 profile 寫入 store
      // 確保即使後續 Firebase session 命中跳過 line-exchange，lineProfile 仍有值
      // 避免重新整理或既有 session 使用者的 Header 頭像/名稱永遠空白
      if (liff.isLoggedIn()) {
        try {
          const profile = await liff.getProfile();
          lineProfile.value = { displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? '' };
        } catch { /* 取 profile 失敗時保持原值，後續 _LoadRolesFromFirestore 會嘗試補回 */ }
      }

      // Firebase session 有效 → LIFF 不需重新登入，直接標記就緒
      const { getAuth } = await import('firebase/auth');
      if (getAuth(firebaseApp).currentUser) {
        liffReady.value = true;
        return;
      }

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

      // 交換 Firebase Custom Token
      const res = await $fetch<{ data: { customToken: string; roles: Role[]; displayName: string; pictureUrl: string } }>(
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

  /** 測試模式：直接設定身分（TestMode 用，不走 Firebase） */
  const MockSignIn = (_roles: Role[]) => {
    user.value = { uid: `mock-${_roles.join('-')}` } as import('firebase/auth').User;
    roles.value = _roles.length > 0 ? _roles : ['passenger'];
    approved.value = true; // 測試模式視為已核准
    authResolved.value = true;
  };

  const SignOut = async () => {
    try {
      const { getAuth } = await import('firebase/auth');
      await getAuth().signOut();
    } catch { /* Firebase 未初始化時忽略 */ }
    _clearState();
    // authResolved 保持 true（auth 流程仍是「已解析，當前未登入」狀態）
    // 若設為 false 會導致 layout v-if="!authResolved" 顯示 loading，但 plugin 不會再跑而永久卡住
    navigateTo('/');
  };

  // -------------------------------------------------------------------------------------------------
  return {
    user, roles, approved, authResolved, liffReady, lineAccessToken, lineProfile, isFriend,
    driverApplication,
    isSignIn, isAdmin, isDriver, isPassenger, isApprovedDriver, idToken,
    InitAuthFlow, MockSignIn, SignOut,
  };
});
