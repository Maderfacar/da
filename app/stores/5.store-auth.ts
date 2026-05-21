// Firebase Auth + LINE LIFF 認證狀態管理
// InitAuthFlow() 由 app/plugins/auth.client.ts 呼叫，確保僅在瀏覽器端執行
//
// P10（2026/05/07 起）：身分模型由單一 role 改為 roles[] 陣列，支援單一使用者同時具
// passenger / driver / admin 多重身分。approved 仍為單一 boolean，僅代表 driver 核准狀態。
type Role = 'passenger' | 'driver' | 'admin';
// P18（2026/05/09 起）：admin 細分三層 level，僅作 admin 端內部權限判斷；roles[] 仍是身分入口的唯一依據。
type AdminLevel = 'super' | 'admin' | 'assistant';

export const StoreAuth = defineStore('StoreAuth', () => {

  // -- State -----------------------------------------------------------------------------------------

  const user = ref<import('firebase/auth').User | null>(null);
  const roles = ref<Role[]>([]);
  const approved = ref<boolean>(true); // 僅作為 driver 核准旗標；passenger/admin 永遠視為 true
  // P18：admin 細粒度權限（讀失敗或非 admin → null）；client SDK 受 firestore.rules 限制
  // 部署 rules 前讀失敗會降級 null，但不影響 admin 入口（roles 仍是依據）。
  const level = ref<AdminLevel | null>(null);
  const authResolved = ref(false);
  const liffReady = ref(false);
  const lineAccessToken = ref('');
  const lineProfile = ref<{ displayName: string; pictureUrl: string } | null>(null);
  const idToken = ref('');
  const isFriend = ref<boolean | null>(null); // null = 尚未查詢
  // 推薦獎勵機制 Phase 3：自己的推薦碼（從 users doc 載入；讀失敗則為空，由 /referral/me 補上）
  const referralCode = ref('');

  // 司機申請狀態（P8）：null = 未申請；rejectedAt 有值 = 已被拒絕等待 admin 解除
  const driverApplication = ref<{
    appliedAt: string | null;
    reviewedAt: string | null;
    rejectedAt: string | null;
    rejectReason: string | null;
  } | null>(null);

  // P18 hotfix（middleware/auth race）：暴露一個 plain Promise 讓 middleware/onMounted 可
  // `await`，不依賴 Vue reactivity（先前用 `watch(authResolved)` 在 SSR + Vercel 環境會 hang）。
  // - `_authResolvedPromise` 在 `_markAuthResolved()` 被呼叫時 resolve（idempotent）。
  // - middleware 用 `Promise.race(WaitForAuthResolved(), 12s timeout)` 套用上限，與
  //   InitAuthFlow safetyTimer 對齊。
  let _resolveAuthPromise: (() => void) | null = null;
  let _authResolvedPromise: Promise<void> | null = null;
  const _ensureAuthResolvedPromise = (): Promise<void> => {
    if (_authResolvedPromise) return _authResolvedPromise;
    if (authResolved.value) {
      _authResolvedPromise = Promise.resolve();
    } else {
      _authResolvedPromise = new Promise<void>((resolve) => { _resolveAuthPromise = resolve; });
    }
    return _authResolvedPromise;
  };
  const _markAuthResolved = () => {
    authResolved.value = true;
    if (_resolveAuthPromise) {
      _resolveAuthPromise();
      _resolveAuthPromise = null;
    }
  };

  // -- Computed --------------------------------------------------------------------------------------

  const isSignIn = computed(() => !!user.value);
  const isAdmin = computed(() => roles.value.includes('admin'));
  const isDriver = computed(() => roles.value.includes('driver'));
  const isPassenger = computed(() => roles.value.includes('passenger'));
  const isApprovedDriver = computed(() => isDriver.value && approved.value);
  // P18：最高管理員（僅 super 可看到「設定 level」「撤銷管理員」按鈕）
  const isSuper = computed(() => isAdmin.value && level.value === 'super');

  // -- Helpers ---------------------------------------------------------------------------------------

  const _clearState = () => {
    user.value = null;
    roles.value = [];
    approved.value = true;
    level.value = null;
    idToken.value = '';
    lineAccessToken.value = '';
    lineProfile.value = null;
    liffReady.value = false;
    isFriend.value = null;
    driverApplication.value = null;
    referralCode.value = '';
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
        _markAuthResolved();
      }
    }, 12_000);

    if (!config.firebaseApiKey) {
      clearTimeout(safetyTimer);
      _markAuthResolved();
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
        _markAuthResolved();
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
      _markAuthResolved();
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
      if (!snap.exists()) return;
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
      // 補回 LINE profile（避免重新整理後因 Firebase session 命中跳過 LIFF 導致 lineProfile=null）
      const displayName = data.displayName as string | undefined;
      const pictureUrl = data.pictureUrl as string | undefined;
      if (displayName && pictureUrl) {
        lineProfile.value = { displayName, pictureUrl };
      }
      // 推薦獎勵機制 Phase 3：載入自己的 referralCode
      referralCode.value = typeof data.referralCode === 'string' ? data.referralCode : '';
      // 補回司機申請狀態（P8）：讀 drivers/{uid}.application（P27 migration 後唯一來源）
      let appData: Record<string, unknown> | undefined;
      if (roles.value.includes('driver')) {
        try {
          const driverSnap = await getDoc(doc(db, 'drivers', lineUid));
          if (driverSnap.exists()) {
            const candidate = driverSnap.data()?.application;
            if (candidate && typeof candidate === 'object') {
              appData = candidate as Record<string, unknown>;
            }
          }
        } catch {
          // Rules 阻擋或 doc 不存在 → appData 保持 undefined，driverApplication 降為 null
        }
      }

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

      // P18：roles 含 admin → 額外讀 admins/{lineUid} 取 level（client SDK 受 firestore.rules 限制）
      // 讀失敗（rules 未部署 / doc 不存在）→ level=null，不影響 admin 入口；僅讓 isSuper 等 UI 隱藏
      if (roles.value.includes('admin')) {
        try {
          const adminSnap = await getDoc(doc(db, 'admins', lineUid));
          if (adminSnap.exists()) {
            const adminData = adminSnap.data();
            const raw = adminData.level;
            if (raw === 'super' || raw === 'admin' || raw === 'assistant') {
              level.value = raw;
            }
          }
        } catch {
          // rules 阻擋或 doc 不存在 → level 保持 null
        }
      }
    } catch {
      // Firestore 讀失敗（多半是 client Rules 限制）— 不影響 server-side line-exchange 已寫入的 roles
    }
  };

  const _InitLiffFlow = async (firebaseApp: import('firebase/app').FirebaseApp) => {
    const config = useRuntimeConfig().public;

    // P19：使用者已將 LINE Console 的兩個 LIFF App endpoint URL 分流：
    //   - 乘客 LIFF endpoint = /home
    //   - 司機 LIFF endpoint = /driver/dashboard
    // client liff.init({ liffId }) 必須帶**對應 URL 的 LIFF ID**，否則 LIFF SDK 會 warn
    // 「current URL is not under endpoint URL」。
    // path 推導：當前 URL 在 /driver/* → 用 driver LIFF；其他 → 用 passenger LIFF。
    // 從外部 URL 進入（不經 LIFF）時推導值不影響功能（liff.init 會因不在 LINE app 走 fallback）。
    const isDriverEntry = typeof window !== 'undefined' && window.location.pathname.startsWith('/driver');
    const liffId = isDriverEntry
      ? (config.lineLiffIdDriver || config.lineLiffIdPassenger)
      : (config.lineLiffIdPassenger || config.lineLiffIdDriver);
    const clientType: 'passenger' | 'driver' = isDriverEntry ? 'driver' : 'passenger';

    if (!liffId) { liffReady.value = true; return; }

    try {
      const liff = (await import('@line/liff')).default;

      // 10 秒 timeout 防止 liff.init() 在 LINE WebView 中 hang 住
      await Promise.race([
        liff.init({ liffId }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('liff.init 逾時')), 10_000)
        ),
      ]);

      // LIFF 已登入 → 主動取 profile 寫入 store（避免重整後 Header 頭像/名稱空白）
      if (liff.isLoggedIn()) {
        try {
          const profile = await liff.getProfile();
          lineProfile.value = { displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? '' };
        } catch { /* 取 profile 失敗時保持原值 */ }
      }

      // Firebase session 優先於 LIFF（原 P6 修復 commit f35e01f，2026/05/02）
      // LIFF token 比 Firebase custom token 短；若 Firebase session 仍有效但 LIFF 過期，
      // 此處不應觸發 liff.login() 把使用者踢去 LINE 登入頁，否則 LIFF 會把使用者送回
      // endpoint URL（乘客端首頁），看起來像「又陷入 LINE 登入又被導回乘客端」。
      // 此段邏輯在 P10/P11 重構中曾被誤刪，此處還原。
      const { getAuth } = await import('firebase/auth');
      if (!liff.isLoggedIn() && getAuth(firebaseApp).currentUser) {
        liffReady.value = true;
        return;
      }

      // 沒登入 LIFF 且 Firebase 也無 session → 強制 LINE 登入，redirect 後重新執行
      if (!liff.isLoggedIn()) {
        liff.login();
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

      // 永遠跑 line-exchange 取 server-side roles（即便 Firebase 已有 session）
      // 避免 client-side _LoadRolesFromFirestore 因 Rules 限制讀失敗時 roles 為空
      const res = await $fetch<{ data: { customToken?: string; roles?: Role[]; approved?: boolean; displayName?: string; pictureUrl?: string }; status?: { code: number } }>(
        '/nuxt-api/auth/line-exchange',
        { method: 'POST', body: { lineAccessToken: token, clientType } },
      ).catch((err) => {
        console.error('[StoreAuth] line-exchange failed:', err);
        return null;
      });

      if (res?.data) {
        if (res.data.displayName && res.data.pictureUrl) {
          lineProfile.value = { displayName: res.data.displayName, pictureUrl: res.data.pictureUrl };
        }
        const parsed = _normalizeRoles(res.data.roles);
        if (parsed.length > 0) {
          roles.value = parsed;
          approved.value = res.data.approved ?? true;
        }

        const { signInWithCustomToken } = await import('firebase/auth');
        if (!getAuth(firebaseApp).currentUser && res.data.customToken) {
          await signInWithCustomToken(getAuth(firebaseApp), res.data.customToken);
        }
      }

      // P19-fix（Phase 1G hotfix）：LIFF URL 帶 `?next=/path` 時 navigate 過去。
      // 動機：LIFF SDK 把 `liff.line.me/{liffId}/foo` 的 path append 到 endpoint URL
      //   （司機=/driver/dashboard、乘客=/home），導致 /driver/dashboard/driver/dispatched/[id] 404。
      // 修法：server 端 LINE Flex 推播改用 `?next=` 帶完整 subPath，這裡解析後 router.replace。
      // 守則：next 必須以 `/` 開頭、不可含 `//`、不可有 scheme — 避免 open redirect。
      try {
        const next = new URLSearchParams(window.location.search).get('next');
        if (next && next.startsWith('/') && !next.includes('//') && !next.includes(':')) {
          const router = useRouter();
          await router.replace(next);
        }
      } catch (navErr) {
        console.warn('[StoreAuth] LIFF next-query navigate failed:', navErr);
      }
    } catch (err) {
      console.error('[StoreAuth] _InitLiffFlow failed:', err);
      liffReady.value = true;
    }
  };

  // -- Actions ---------------------------------------------------------------------------------------

  /**
   * 取得最新的 Firebase ID token（自動 refresh）
   *
   * 用途：所有需要呼叫受 require-auth 保護的 server endpoint 之前，
   * client 必須帶 `Authorization: Bearer <freshIdToken>`。
   *
   * Firebase ID token TTL 1 小時，`getIdToken()` 內部會在過期前自動 refresh。
   *
   * 回傳：
   *   - 已登入：最新的有效 idToken
   *   - 未登入 / 取得失敗：空字串（caller 可選擇不帶 header，server 會回 401）
   */
  /**
   * 等待 InitAuthFlow 完成（authResolved=true）。
   *
   * 設計用意：middleware/auth 與部分 onMounted 場景需在 API 呼叫前確保 Firebase auth
   * 已解析（idToken 取得 / roles 載入），避免 race 導致 401「未授權」。
   *
   * 用 plain Promise（不靠 Vue watch）以避開以下陷阱：
   * 1. Nuxt route middleware 沒有 active component / effect scope，watch 行為不可靠
   * 2. SSR 上 plugin (.client.ts) 不跑、authResolved 永遠 false → watch 永遠不 fire
   *
   * caller 應自己套 timeout（如 12s），與 InitAuthFlow safetyTimer 對齊。
   */
  const WaitForAuthResolved = (): Promise<void> => _ensureAuthResolvedPromise();

  const GetFreshIdToken = async (): Promise<string> => {
    if (typeof window === 'undefined') return idToken.value;
    try {
      // InitAuthFlow 尚未跑完（或 firebaseApiKey 未設）時 default app 不存在，
      // 直接呼叫 getAuth() 會 throw `app/no-app`。先檢查 getApps() 避免噪音 log。
      const { getApps } = await import('firebase/app');
      if (getApps().length === 0) return idToken.value;
      const { getAuth } = await import('firebase/auth');
      const u = getAuth().currentUser;
      if (!u) return '';
      const fresh = await u.getIdToken();
      idToken.value = fresh;
      return fresh;
    } catch (err) {
      console.error('[StoreAuth] GetFreshIdToken failed:', err);
      return idToken.value;
    }
  };

  /** 測試模式：直接設定身分（TestMode 用，不走 Firebase） */
  const MockSignIn = (_roles: Role[]) => {
    user.value = { uid: `mock-${_roles.join('-')}` } as import('firebase/auth').User;
    roles.value = _roles.length > 0 ? _roles : ['passenger'];
    approved.value = true; // 測試模式視為已核准
    _markAuthResolved();
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
    user, roles, approved, level, authResolved, liffReady, lineAccessToken, lineProfile, isFriend,
    driverApplication, referralCode,
    isSignIn, isAdmin, isDriver, isPassenger, isApprovedDriver, isSuper, idToken,
    InitAuthFlow, MockSignIn, SignOut, GetFreshIdToken, WaitForAuthResolved,
  };
});
