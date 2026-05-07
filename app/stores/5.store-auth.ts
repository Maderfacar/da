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
    // 容錯：若使用者在 Firebase Console 誤把 roles 存成 string 型別
    // （例如 "['passenger', 'driver', 'admin']" 或 "passenger,driver,admin"），
    // 嘗試 parse 出有效角色名稱，避免 ADMIN/PASSENGER 鈕永遠不顯示。
    let arr: unknown[] = [];
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === 'string') {
      const stripped = raw.replace(/[[\]'"\s]/g, '');
      arr = stripped.split(',');
    }
    const valid = arr.filter((r): r is Role => r === 'passenger' || r === 'driver' || r === 'admin');
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
      // 重要：firebaseUser 為 null 才清空 state；其餘情況保留 user，避免 token 取得
      // 失敗或 Firestore 讀失敗時誤踢使用者（症狀：切換路由觸發 middleware/auth 把人
      // 導去 /driver/auth，看似「再觸發 LINE 登入」）
      if (!firebaseUser) {
        _clearState();
        authResolved.value = true;
        return;
      }
      user.value = firebaseUser;
      // getIdToken / Firestore 讀失敗都不應該影響 user 狀態
      try {
        idToken.value = await firebaseUser.getIdToken();
      } catch (err) {
        console.error('[StoreAuth] getIdToken failed:', err);
      }
      try {
        await _LoadRolesFromFirestore(firebaseApp, firebaseUser.uid);
      } catch (err) {
        console.error('[StoreAuth] _LoadRolesFromFirestore unexpected throw:', err);
      }
      authResolved.value = true;
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
        // 兼容舊 schema：若 roles 為空但有舊 role 欄位，自動 fallback 到單一 role
        const parsed = _normalizeRoles(data.roles);
        if (parsed.length > 0) {
          roles.value = parsed;
        } else if (typeof data.role === 'string') {
          const legacy = _normalizeRoles([data.role]);
          roles.value = legacy.length > 0 ? legacy : ['passenger'];
        } else {
          roles.value = ['passenger'];
        }
        approved.value = (data.approved as boolean) ?? false;
        if (typeof console !== 'undefined') {
          console.info('[StoreAuth] loaded roles', roles.value, 'approved', approved.value);
        }
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
      } else {
        console.warn('[StoreAuth] users/{uid} 文件不存在', { uid, lineUid });
      }
    } catch (err) {
      console.error('[StoreAuth] _LoadRolesFromFirestore failed:', err);
    }
  };

  const _InitLiffFlow = async (firebaseApp: import('firebase/app').FirebaseApp) => {
    const config = useRuntimeConfig().public;

    // P10 後續修復：三端統一走 passenger LIFF App
    const liffId = config.lineLiffIdPassenger || config.lineLiffIdDriver;
    const clientType = 'passenger';
    console.info('[StoreAuth] _InitLiffFlow start, liffId set?', !!liffId);

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
      console.info('[StoreAuth] liff.init OK, isLoggedIn=', liff.isLoggedIn());

      // LIFF 已登入 → 主動取 profile 寫入 store
      if (liff.isLoggedIn()) {
        try {
          const profile = await liff.getProfile();
          lineProfile.value = { displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? '' };
        } catch { /* 取 profile 失敗時保持原值 */ }
      }

      // 沒登入 LIFF → 強制 LINE 登入，redirect 後重新執行
      if (!liff.isLoggedIn()) {
        console.warn('[StoreAuth] LIFF 未登入，呼叫 liff.login() redirect');
        liff.login();
        return;
      }

      const token = liff.getAccessToken() ?? '';
      lineAccessToken.value = token;
      console.info('[StoreAuth] LIFF token length:', token.length);

      // 查詢是否已加官方帳號好友
      try {
        const friendship = await liff.getFriendship();
        isFriend.value = friendship.friendFlag;
      } catch {
        isFriend.value = null;
      }

      liffReady.value = true;

      // 永遠跑 line-exchange 取 server-side roles
      console.info('[StoreAuth] calling line-exchange...');
      const res = await $fetch<{ data: { customToken?: string; roles?: Role[]; approved?: boolean; displayName?: string; pictureUrl?: string }; status?: { code: number; message?: unknown } }>(
        '/nuxt-api/auth/line-exchange',
        { method: 'POST', body: { lineAccessToken: token, clientType } },
      ).catch((err) => {
        console.error('[StoreAuth] line-exchange failed:', err);
        return null;
      });
      console.info('[StoreAuth] line-exchange status code:', res?.status?.code, 'data keys:', Object.keys(res?.data ?? {}));
      if (res?.status?.code !== 200) {
        console.error('[StoreAuth] ❌ line-exchange returned non-200 business code:', res?.status);
      }

      if (res?.data) {
        if (res.data.displayName && res.data.pictureUrl) {
          lineProfile.value = { displayName: res.data.displayName, pictureUrl: res.data.pictureUrl };
        }
        const parsed = _normalizeRoles(res.data.roles);
        console.info('[StoreAuth] parsed roles from server:', parsed, 'raw:', res.data.roles);
        if (parsed.length > 0) {
          roles.value = parsed;
          approved.value = res.data.approved ?? true;
          console.info('[StoreAuth] ✅ roles set to', roles.value, 'approved', approved.value);
        } else {
          console.warn('[StoreAuth] ⚠️ server 回傳的 roles parse 後為空（多半是 server 走 error path，請看 Vercel runtime logs）');
        }

        const { getAuth, signInWithCustomToken } = await import('firebase/auth');
        if (!getAuth(firebaseApp).currentUser && res.data.customToken) {
          await signInWithCustomToken(getAuth(firebaseApp), res.data.customToken);
          console.info('[StoreAuth] signInWithCustomToken OK');
        } else if (!res.data.customToken) {
          console.error('[StoreAuth] ❌ server 沒回 customToken，Firebase 無法 sign in，後續整個 auth flow 會卡住');
        }
      }
    } catch (err) {
      console.error('[StoreAuth] _InitLiffFlow caught error:', err);
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
