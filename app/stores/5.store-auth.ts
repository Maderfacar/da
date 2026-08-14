// Firebase Auth + LINE LIFF 認證狀態管理
// InitAuthFlow() 由 app/plugins/auth.client.ts 呼叫，確保僅在瀏覽器端執行
//
// P10（2026/05/07 起）：身分模型由單一 role 改為 roles[] 陣列，支援單一使用者同時具
// passenger / driver / admin 多重身分。approved 仍為單一 boolean，僅代表 driver 核准狀態。
//
// Firebase-First 重構（2026/06 起）：
// 以 Firebase Session 為主軸，LIFF Token 驗證完全移至背景非阻塞執行。
// liff.login() redirect 僅在「Firebase 與 LIFF 雙重失聯」時才觸發（首次登入）。
// 重整或 LIFF token 12h 過期時，只要 Firebase session 仍活著就直接放行，不跳轉。
//
// W4（2026-06-18）：lazy load 重構
//   - InitAuthFlow / onAuthStateChanged 不再讀 users / drivers / admins doc，不發 admin 2FA POST
//   - 改由 middleware/role 在進對應路徑時 await Ensure*（4 個 lazy action）
//   - 4 個 Ensure* 共用 shared/auth/lazy-loader.ts 純函式 sticky-promise factory
import { createLazyLoader } from '~shared/auth/lazy-loader';
import { logAuth } from '~/utils/error-log';

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
  // P34 / 車資權限：admins.permissions 細粒度 override（讀失敗或未設 → 空物件）
  const adminPermissions = ref<Partial<Record<string, boolean>>>({});
  const authResolved = ref(false);
  const liffReady = ref(false);
  const lineAccessToken = ref('');
  // W2：localStorage 快取 lineProfile，回訪用戶重整後立即顯示頭像/名稱
  const _PROFILE_KEY = 'da_line_profile';
  const _cachedProfile = (() => {
    if (typeof localStorage === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(_PROFILE_KEY) ?? 'null'); } catch { return null; }
  })();
  const lineProfile = ref<{ displayName: string; pictureUrl: string } | null>(_cachedProfile);
  watch(lineProfile, (val) => {
    if (typeof localStorage === 'undefined') return;
    try {
      if (val) localStorage.setItem(_PROFILE_KEY, JSON.stringify(val));
      else localStorage.removeItem(_PROFILE_KEY);
    } catch { /* localStorage 不可用時靜默略過 */ }
  });
  const idToken = ref('');
  const isFriend = ref<boolean | null>(null); // null = 尚未查詢
  // 推薦獎勵機制 Phase 3：自己的推薦碼（從 users doc 載入；讀失敗則為空，由 /referral/me 補上）
  const referralCode = ref('');
  // Admin 2FA TOTP（極限版，無 backup code；忘失機需 super 手動 Firestore 清 totpSecret）
  // admin2faEnrolled：caller 是 admin 且 admins/{lineUid}.totpEnrolledAt 存在
  // admin2faSessionVerified：localStorage 'da_admin_2fa_session' 經 /2fa/session-check 驗證過
  const admin2faEnrolled = ref<boolean>(false);
  const admin2faSessionVerified = ref<boolean>(false);
  const _ADMIN_2FA_SESSION_KEY = 'da_admin_2fa_session';

  // ── 認證根治 P1（2026-08-14）：server httpOnly session cookie（da_session）─────────────────
  // 登入真相從前端 Firebase session（LINE in-app webview 儲存不可靠）移到 server 簽發的 cookie。
  //   - _sessionSignedIn：server /session-check 回 signedIn=true（或本機 seed 成功）→ cookie 有效
  //   - isSignIn 改為「Firebase user 存在 或 cookie session 有效」二者其一即視為已登入，
  //     使「localStorage 被清但 cookie 在」的裝置不再被誤判登出。
  //   - EnsureSessionChecked()：開機打一次 /session-check（sticky promise），以 server 真相
  //     設 roles/approved/level，取代前端等 Firebase hydration 的 12s race。
  const _sessionSignedIn = ref<boolean>(false);
  let _mockMode = false;                                 // MockSignIn（TestMode / E2E）時略過 session-check
  let _sessionCheckPromise: Promise<void> | null = null; // EnsureSessionChecked sticky
  let _sessionCookieSeeded = false;                      // 同一 JS 生命週期避免重複 seed

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

  // Firebase-First Gate：onAuthStateChanged 的「第一次」回調代表 Firebase SDK 已從
  // IndexedDB 恢復 session，此時 getAuth().currentUser 才可信。
  // _InitLiffFlow 在決定是否呼叫 liff.login() 前必須等此 Promise resolve，
  // 否則 cold start 期間 currentUser 恆為 null，導致不必要的 redirect。
  let _resolveFirebaseReady!: () => void;
  const _firebaseReadyPromise = new Promise<void>((r) => { _resolveFirebaseReady = r; });

  // ── 登入 hydration 埋點（2026-07-31，只加紀錄、不改登入行為）──────────────────────────
  // 背景：曾發生「Firebase session 活著、authResolved=true，但 roles 遲到／沒到」→ 畫面秀
  // 訪客樣被誤判登出，且全程無任何 log。以下 beacon 補上這條盲區的時間軸，皆 fire-and-forget，
  // 不影響任何登入判斷。事件：
  //   auth.resolved.snapshot（info）— authResolved 當下的 roles/profile 快照 + 距啟動耗時
  //   auth.roles.arrived   （info）— roles 在空窗後才到位，記延遲毫秒與來源
  //   auth.roles.slow      （warn）— authResolved 後 2.5s roles 仍為空（＝畫面顯示訪客的空窗）
  let _authStartedAt = 0;
  let _resolveBeaconSent = false;   // auth.resolved.snapshot 已送
  let _rolesEmptyAtResolve = false; // resolve 當下 roles 為空（代表存在空窗）
  let _rolesArrivedNoted = false;   // roles 到位／逾時 已記一次
  let _rolesSlowTimer: ReturnType<typeof setTimeout> | null = null;

  const _msSinceStart = (): number => (_authStartedAt ? Date.now() - _authStartedAt : -1);

  const _resetHydrationBeacon = (): void => {
    _resolveBeaconSent = false;
    _rolesEmptyAtResolve = false;
    _rolesArrivedNoted = false;
    if (_rolesSlowTimer) { clearTimeout(_rolesSlowTimer); _rolesSlowTimer = null; }
  };

  // roles 真正被填入時呼叫（line-exchange / user-doc 兩個來源各一）。
  // 只有在「resolve 當下 roles 為空」時才記延遲，避免正常快路徑噪音。
  const _noteRolesArrived = (source: string): void => {
    if (_rolesArrivedNoted) return;
    _rolesArrivedNoted = true;
    if (_rolesSlowTimer) { clearTimeout(_rolesSlowTimer); _rolesSlowTimer = null; }
    if (_resolveBeaconSent && _rolesEmptyAtResolve) {
      logAuth({
        event: 'auth.roles.arrived',
        severity: 'info',
        message: `roles 到位（來源 ${source}），距啟動 ${_msSinceStart()}ms`,
        metadata: { source, elapsedMs: _msSinceStart(), roles: [...roles.value] },
      });
    }
  };

  // authResolved 且有登入 user 時呼叫一次：記當下快照；若 roles 未到則掛 2.5s 慢速警報。
  const _beaconAuthHydration = (source: string): void => {
    if (_resolveBeaconSent) return;
    _resolveBeaconSent = true;
    _rolesEmptyAtResolve = roles.value.length === 0;

    logAuth({
      event: 'auth.resolved.snapshot',
      severity: 'info',
      message: `authResolved（${source}）；當下 roles=${roles.value.length}、profile=${!!lineProfile.value}`,
      metadata: {
        source,
        elapsedMs: _msSinceStart(),
        rolesAtResolve: [...roles.value],
        hasRoles: roles.value.length > 0,
        hasProfile: !!lineProfile.value,
      },
    });

    if (!_rolesEmptyAtResolve) {
      _rolesArrivedNoted = true; // 已就緒，無需再等到位
      return;
    }

    // roles 還沒到 → 2.5s 後仍為空就示警（正是「畫面秀訪客、使用者誤判登出」的空窗）
    _rolesSlowTimer = setTimeout(() => {
      if (!_rolesArrivedNoted && roles.value.length === 0) {
        logAuth({
          event: 'auth.roles.slow',
          severity: 'warn',
          message: 'authResolved 後 2.5s，roles 仍為空（畫面可能顯示訪客樣）',
          metadata: { source, elapsedMs: _msSinceStart() },
        });
      }
    }, 2_500);
  };

  // -- Computed --------------------------------------------------------------------------------------

  // 認證根治 P1：Firebase user 存在 或 server cookie session 有效 → 視為已登入。
  // 後者覆蓋「localStorage/IndexedDB 被清、但 httpOnly cookie 仍在」的裝置（不再誤判登出）。
  const isSignIn = computed(() => !!user.value || _sessionSignedIn.value);
  const isAdmin = computed(() => roles.value.includes('admin'));
  const isDriver = computed(() => roles.value.includes('driver'));
  const isPassenger = computed(() => roles.value.includes('passenger'));
  const isApprovedDriver = computed(() => isDriver.value && approved.value);
  // P18：最高管理員（僅 super 可看到「設定 level」「撤銷管理員」按鈕）
  const isSuper = computed(() => isAdmin.value && level.value === 'super');
  // 車資進階規則權限：override 優先；否則預設僅 super（與 server LEVEL_TABLE 對齊，決策 2026-07-28）
  const canManageFareRules = computed(() => {
    if (!isAdmin.value) return false;
    const override = adminPermissions.value?.canManageFareRules;
    if (typeof override === 'boolean') return override;
    return level.value === 'super';
  });
  // 乘客端季節主題管理權限：override 優先；否則預設僅 super（與 server LEVEL_TABLE 對齊）
  const canManageThemes = computed(() => {
    if (!isAdmin.value) return false;
    const override = adminPermissions.value?.canManageThemes;
    if (typeof override === 'boolean') return override;
    return level.value === 'super';
  });

  // -- Helpers ---------------------------------------------------------------------------------------

  const _clearState = () => {
    user.value = null;
    roles.value = [];
    approved.value = true;
    level.value = null;
    adminPermissions.value = {};
    idToken.value = '';
    lineAccessToken.value = '';
    lineProfile.value = null;
    liffReady.value = false;
    isFriend.value = null;
    driverApplication.value = null;
    referralCode.value = '';
    admin2faEnrolled.value = false;
    admin2faSessionVerified.value = false;
    // 認證根治 P1：清 cookie session 真相（僅在「確定登出／無 cookie」時呼叫；
    // onAuthStateChanged(null) 若偵測 cookie 仍有效會走 guard 分支不呼叫本函式）
    _sessionSignedIn.value = false;
    _sessionCookieSeeded = false;
    // W4：清四個 lazy loader sticky state，避免下一個 user 看到上個 user 的資料
    // 注意：閉包讀的是 user.value（reactive），ref 已先被 null；下次 ensure() 重新跑 fn 也 noop
    _userDocLoader?.reset();
    _driverDocLoader?.reset();
    _adminDocLoader?.reset();
    _admin2faSessionLoader?.reset();
    // 埋點：重置 hydration beacon（同一 JS session 內重新登入也能再量一次）
    _resetHydrationBeacon();
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
    _authStartedAt = Date.now(); // 埋點：hydration 計時起點

    // 安全超時：Firebase / LIFF 若在 12 秒內未回應，強制解除 loading 遮罩
    // 確保 LINE WebView 網路受限或 SDK hang 住時，使用者不會永久卡在轉圈圈
    const safetyTimer = setTimeout(() => {
      if (!authResolved.value) {
        console.warn('[StoreAuth] 初始化逾時 (12s)，強制解除 loading');
        logAuth({
          event: 'auth.init.timeout',
          severity: 'warn',
          message: 'InitAuthFlow 12s safetyTimer triggered',
        });
        _markAuthResolved();
      }
    }, 12_000);

    if (!config.firebaseApiKey) {
      clearTimeout(safetyTimer);
      _markAuthResolved();
      return;
    }

    const { initializeApp, getApps } = await import('firebase/app');
    const { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence } = await import('firebase/auth');

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

    // W4-FU 2026-06-18：顯式設 browserLocalPersistence（用 localStorage），跳過 IndexedDB。
    // 根因：LINE in-app browser 對 Firebase Auth Web SDK 預設的 IndexedDB persistence
    // 在 cold start 第一次 read 時會 hang 10-30s，導致 onAuthStateChanged 第一次回呼遲到，
    // BootGate `await WaitForAuthResolved()` 撞到 12s safetyTimer，使用者看到 splash 卡住。
    // localStorage 是同步 API、in-app browser 可靠；session 仍持久（reload 不丟）。
    // setPersistence 失敗 → fallback SDK 預設（IndexedDB → localStorage → sessionStorage → inMemory）。
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (err) {
      console.warn('[StoreAuth] setPersistence(browserLocal) failed; fallback to SDK default:', err);
    }

    onAuthStateChanged(auth, async (firebaseUser) => {
      // Firebase SDK 已從 IndexedDB 恢復 session（不論 user 是否存在），通知 _InitLiffFlow 可信任 currentUser
      _resolveFirebaseReady();
      clearTimeout(safetyTimer); // Firebase 成功回應，取消安全計時器
      // 重要：firebaseUser 為 null 才清空 state；其餘情況保留 user，避免 token 取得
      // 失敗或 Firestore 讀失敗時誤踢使用者（症狀：切換路由觸發 middleware/auth 把人
      // 導去 /driver/auth，看似「再觸發 LINE 登入」）
      if (!firebaseUser) {
        // 認證根治 P1：Firebase SDK 無 session，但若 server cookie session 仍有效
        // （典型：localStorage/IndexedDB 被清，但 httpOnly cookie 還在）→ 只清 Firebase
        // 派生狀態（user/idToken），保留 cookie 建立的登入真相，避免誤判登出。
        if (_sessionSignedIn.value) {
          user.value = null;
          idToken.value = '';
          _markAuthResolved();
          return;
        }
        _clearState();
        _markAuthResolved();
        return;
      }
      user.value = firebaseUser;
      // getIdToken 失敗不應影響 user 狀態
      try {
        // P0-1 claims-first hydration（2026-07-31）：roles 已由後端寫進 Firebase custom claims，
        // token 本身就帶著 → 拿 token 的同時直接讀 claims.roles，立即 hydrate roles，
        // 不必等 middleware/role 的 Firestore read 或背景 line-exchange。
        // 這是消滅「session 活著但 roles 空窗（畫面顯示訪客、被誤判登出）」的核心修法。
        // Firestore users doc / line-exchange 仍會跑，作為事後校正（roles 有異動時覆蓋）。
        const tokenRes = await firebaseUser.getIdTokenResult();
        idToken.value = tokenRes.token;
        if (roles.value.length === 0) {
          const claimRoles = _normalizeRoles(tokenRes.claims.roles);
          if (claimRoles.length > 0) {
            roles.value = claimRoles;
            _noteRolesArrived('id-token-claims'); // 埋點：記 claims 來源
          }
        }
      } catch (err) {
        console.error('[StoreAuth] getIdTokenResult failed:', err);
        const e = err instanceof Error ? err : new Error(String(err));
        logAuth({
          event: 'auth.get-id-token.failed',
          message: e.message,
          stack: e.stack,
        });
      }
      // 認證根治 P1：Firebase session 就緒（復原 或 signInWithCustomToken 新建都會觸發此分支）
      // → 立即以 idToken 種 server httpOnly session cookie（cookie-first）。單一 seed 點涵蓋所有
      // Firebase 登入來源；LIFF token 過期（>12h）但 Firebase session 仍在的回訪用戶也能種到 cookie。
      void _SeedSessionCookie(firebaseApp);
      // W4：移除 eager _LoadRolesFromFirestore + admin 2FA session-check
      // 這 4 個 IO 改由 middleware/role 在進對應路徑時 lazy load（Ensure* action）
      // 公開頁進站不再觸發任何 Firestore read / admin POST
      _markAuthResolved();
      _beaconAuthHydration('firebase-restore'); // 埋點：記 authResolved 當下 roles 是否已到
    });

    await _InitLiffFlow(firebaseApp);
  };

  // W4：把舊 _LoadRolesFromFirestore 拆成三個獨立 helper
  //   - _LoadUserDoc：users/{lineUid} doc → roles / approved / lineProfile / referralCode
  //   - _LoadDriverDoc：drivers/{lineUid} doc → driverApplication
  //   - _LoadAdminDoc：admins/{lineUid} doc → level / admin2faEnrolled
  // 三個 helper 由 ensure* lazy loader 包用（middleware/role 進對應路徑才 fire）。
  // Firebase UID 格式為 line:{lineUserId}，Firestore 文件 key 直接使用 LINE UID

  const _LoadUserDoc = async (
    firebaseApp: import('firebase/app').FirebaseApp,
    uid: string,
  ): Promise<void> => {
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const db = getFirestore(firebaseApp);
      const lineUid = uid.startsWith('line:') ? uid.slice(5) : uid;
      const snap = await getDoc(doc(db, 'users', lineUid));
      if (!snap.exists()) {
        // 埋點：users doc 不存在是原本的靜默洞（roles 不會被設、也不報錯）
        logAuth({
          event: 'auth.userdoc.missing',
          severity: 'warn',
          message: `users/${lineUid} 不存在，roles 未由 user-doc 補上`,
          metadata: { lineUid },
        });
        return;
      }
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
      _noteRolesArrived('user-doc'); // 埋點
      approved.value = (data.approved as boolean) ?? false;
      // 補回 LINE profile（避免重新整理後因 Firebase session 命中跳過 LIFF 導致 lineProfile=null）
      const displayName = data.displayName as string | undefined;
      const pictureUrl = data.pictureUrl as string | undefined;
      if (displayName && pictureUrl) {
        lineProfile.value = { displayName, pictureUrl };
      }
      // 推薦獎勵機制 Phase 3：載入自己的 referralCode
      referralCode.value = typeof data.referralCode === 'string' ? data.referralCode : '';

      // W1：persistent claims 一致性 — 若 Firestore roles 與目前 ID token claims.roles 不一致，
      // 或 users.claimsUpdatedAt 比手上 token 新（admin 剛改過角色）→ 強制刷新一次 token，
      // 讓 firestore.rules 立即拿到新角色（免重登、免重啟 LINE）。
      // _LoadUserDoc 由 sticky loader 包住，一個 session 只跑一次 → 最多刷新一次。
      try {
        const { getAuth } = await import('firebase/auth');
        const current = getAuth(firebaseApp).currentUser;
        if (current) {
          const tokenRes = await current.getIdTokenResult();
          const claimRoles = Array.isArray(tokenRes.claims.roles) ? (tokenRes.claims.roles as string[]) : [];
          const sortedClaim = [...claimRoles].sort().join(',');
          const sortedFs = [...roles.value].sort().join(',');
          const claimsUpdatedAt = (data.claimsUpdatedAt as { toDate?: () => Date } | undefined)?.toDate?.();
          const tokenIssuedAt = tokenRes.issuedAtTime ? new Date(tokenRes.issuedAtTime) : null;
          const claimsStale = !!(claimsUpdatedAt && tokenIssuedAt && claimsUpdatedAt.getTime() > tokenIssuedAt.getTime());
          if (sortedClaim !== sortedFs || claimsStale) {
            idToken.value = await current.getIdToken(true);
          }
        }
      } catch (refreshErr) {
        console.warn('[StoreAuth] claims refresh check failed (non-fatal):', refreshErr);
      }
    } catch (err) {
      // Firestore 讀失敗（多半是 client Rules 限制）— 不影響 server-side line-exchange 已寫入的 roles
      const e = err instanceof Error ? err : new Error(String(err));
      logAuth({
        event: 'auth.ensure-doc.failed',
        severity: 'warn',
        message: `_LoadUserDoc: ${e.message}`,
        stack: e.stack,
        metadata: { docKind: 'user' },
      });
    }
  };

  const _LoadDriverDoc = async (
    firebaseApp: import('firebase/app').FirebaseApp,
    uid: string,
  ): Promise<void> => {
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const db = getFirestore(firebaseApp);
      const lineUid = uid.startsWith('line:') ? uid.slice(5) : uid;
      const driverSnap = await getDoc(doc(db, 'drivers', lineUid));
      if (!driverSnap.exists()) {
        driverApplication.value = null;
        return;
      }
      const candidate = driverSnap.data()?.application;
      if (candidate && typeof candidate === 'object') {
        const appData = candidate as Record<string, unknown>;
        driverApplication.value = {
          appliedAt: (appData.appliedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (appData.appliedAt as string | null) ?? null,
          reviewedAt: (appData.reviewedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (appData.reviewedAt as string | null) ?? null,
          rejectedAt: (appData.rejectedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (appData.rejectedAt as string | null) ?? null,
          rejectReason: (appData.rejectReason as string | null) ?? null,
        };
      } else {
        driverApplication.value = null;
      }
    } catch (err) {
      // Rules 阻擋或 doc 不存在 → driverApplication 保持 null
      driverApplication.value = null;
      const e = err instanceof Error ? err : new Error(String(err));
      logAuth({
        event: 'auth.ensure-doc.failed',
        severity: 'warn',
        message: `_LoadDriverDoc: ${e.message}`,
        stack: e.stack,
        metadata: { docKind: 'driver' },
      });
    }
  };

  const _LoadAdminDoc = async (
    firebaseApp: import('firebase/app').FirebaseApp,
    uid: string,
  ): Promise<void> => {
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const db = getFirestore(firebaseApp);
      const lineUid = uid.startsWith('line:') ? uid.slice(5) : uid;
      // P18：admins/{lineUid} 取 level（client SDK 受 firestore.rules 限制）
      // 讀失敗（rules 未部署 / doc 不存在）→ level=null，不影響 admin 入口；僅讓 isSuper 等 UI 隱藏
      const adminSnap = await getDoc(doc(db, 'admins', lineUid));
      if (!adminSnap.exists()) return;
      const adminData = adminSnap.data();
      const raw = adminData.level;
      if (raw === 'super' || raw === 'admin' || raw === 'assistant') {
        level.value = raw;
      }
      // 車資權限等細粒度 override（P34）；讀不到 → 保持空物件走 level 預設
      const rawPerms = adminData.permissions;
      if (rawPerms && typeof rawPerms === 'object') {
        adminPermissions.value = rawPerms as Partial<Record<string, boolean>>;
      }
      // Admin 2FA：totpEnrolledAt 存在即視為已綁定（值為 Firestore Timestamp / 也可能為 null）
      admin2faEnrolled.value = !!adminData.totpEnrolledAt;
    } catch (err) {
      // rules 阻擋或 doc 不存在 → level 保持 null
      const e = err instanceof Error ? err : new Error(String(err));
      logAuth({
        event: 'auth.ensure-doc.failed',
        severity: 'warn',
        message: `_LoadAdminDoc: ${e.message}`,
        stack: e.stack,
        metadata: { docKind: 'admin' },
      });
    }
  };

  // W4：把 admin 2FA session-check 包成 lazy fn（factory 包成 loader）
  const _CheckAdmin2faSession = async (): Promise<void> => {
    if (typeof localStorage === 'undefined') return;
    const storedToken = localStorage.getItem(_ADMIN_2FA_SESSION_KEY) ?? '';
    if (!storedToken) return;
    try {
      const res = await $fetch<{ status?: { code: number } }>('/nuxt-api/admin/2fa/session-check', {
        // 認證根治 P2：帶 da_session cookie 認證（cookie-only 裝置 idToken 為空，改由 cookie 過 gate）；
        // Bearer 保留為過渡 fallback（有 Firebase user 時）。X-Admin-2FA-Session 仍是 2FA session 憑證。
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${idToken.value}`,
          'X-Admin-2FA-Session': storedToken,
        },
      });
      if (res?.status?.code === 200) {
        admin2faSessionVerified.value = true;
      } else {
        try { localStorage.removeItem(_ADMIN_2FA_SESSION_KEY); } catch { /* ignore */ }
      }
    } catch {
      // 401 / 網路錯 → 視為未驗證，clear cache 讓 middleware 導 challenge
      try { localStorage.removeItem(_ADMIN_2FA_SESSION_KEY); } catch { /* ignore */ }
    }
  };

  // W4：四個 lazy loader — 進對應路徑才 fire；SignOut / user 切換時 reset
  // 注意：閉包延遲到 ensure() 才取 getApps()[0] 與 user.value，避免 store init 時 firebase 未就緒
  const _userDocLoader = createLazyLoader(async () => {
    const { getApps } = await import('firebase/app');
    const app = getApps()[0];
    if (!app || !user.value) return false; // F2：前置未就緒 → 不標 loaded，下次重試
    await _LoadUserDoc(app, user.value.uid);
  });

  const _driverDocLoader = createLazyLoader(async () => {
    const { getApps } = await import('firebase/app');
    const app = getApps()[0];
    if (!app || !user.value) return false; // F2
    await _LoadDriverDoc(app, user.value.uid);
  });

  const _adminDocLoader = createLazyLoader(async () => {
    const { getApps } = await import('firebase/app');
    const app = getApps()[0];
    if (!app || !user.value) return false; // F2
    await _LoadAdminDoc(app, user.value.uid);
  });

  const _admin2faSessionLoader = createLazyLoader(async () => {
    await _CheckAdmin2faSession();
    return true; // 完成即 sticky（無前置條件可缺）
  });

  // ── 背景輔助：靜默刷新 LIFF Profile cache ──────────────────────────────────────────────────────
  // Firebase session 活著但 LIFF token 可能已過期的場景下使用。
  // 失敗時靜默略過（localStorage 已有 lineProfile cache 會繼續顯示）。
  const _RefreshLiffProfileBackground = async (liff: typeof import('@line/liff').default) => {
    if (!liff.isLoggedIn()) return;
    try {
      const profile = await liff.getProfile();
      lineProfile.value = { displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? '' };
    } catch { /* 非致命，cache 版本繼續沿用 */ }
  };

  // ── 認證根治 P1：以剛驗過的 Firebase ID token 換 server httpOnly session cookie ──────────────
  // 由 onAuthStateChanged(user) 分支呼叫（涵蓋 Firebase session 復原 + signInWithCustomToken 新建）。
  // 種植成功後 API 靠 cookie，不再需要保住前端 session；失敗僅記 log，不影響既有 Bearer 路徑。
  // 同一 JS 生命週期只 seed 一次（_sessionCookieSeeded），跨 reload 自然重種（順帶滑動 14d 效期）。
  const _SeedSessionCookie = async (
    firebaseApp: import('firebase/app').FirebaseApp,
  ): Promise<void> => {
    if (_sessionCookieSeeded || _mockMode) return;
    try {
      const { getAuth } = await import('firebase/auth');
      const current = getAuth(firebaseApp).currentUser;
      if (!current) return;
      const freshIdToken = await current.getIdToken();
      if (!freshIdToken) return;
      const res = await $fetch<{ status?: { code?: number } }>('/nuxt-api/auth/session-login', {
        method: 'POST',
        body: { idToken: freshIdToken },
        credentials: 'include',
      }).catch((err) => {
        console.warn('[StoreAuth] session-login seed failed (non-fatal):', err);
        return null;
      });
      if (res?.status?.code === 200) {
        _sessionCookieSeeded = true;
        _sessionSignedIn.value = true;
        logAuth({
          event: 'auth.session-cookie.seeded',
          severity: 'info',
          message: 'da_session cookie 種植成功（cookie-first）',
        });
      }
    } catch (err) {
      // Firebase 未就緒 / 網路錯 → 靜默；下次開機或核心動作會再種
      console.warn('[StoreAuth] _SeedSessionCookie unexpected error (non-fatal):', err);
    }
  };

  // ── 背景輔助：LIFF token → line-exchange → 更新 roles / Firebase session ─────────────────────
  // 此函式為純背景執行，不阻塞頁面渲染。
  // 兩種場景下呼叫：
  //   1. Firebase 有 session + LIFF 也有 token → 靜默刷新 roles（避免 roles 舊 session 過期）
  //   2. Firebase 無 session + LIFF 有 token → 首次換 customToken 建立 Firebase session
  //
  // 認證根治 P1（2026-08-14）：移除舊「B 方案」— line-exchange 傳輸失敗時 liff.logout()+reload。
  // 舊法是毒藥：它把「唯一能鑄 Firebase session 的 LIFF token」也砍掉，且 logout 觸發動態
  // redirect_uri 迴圈（redirect_uri does not match 死鏈）。改為有上限退避重試（3 次，0.5/1/2s），
  // 全程保留 LIFF 登入；連續失敗則放棄，待下次核心動作（GetFreshLiffToken）或開機重試。
  const _EXCHANGE_MAX_RETRY = 3;
  const _EXCHANGE_BACKOFF_MS = [500, 1000, 2000];
  const _ExchangeLiffTokenBackground = async (
    liff: typeof import('@line/liff').default,
    firebaseApp: import('firebase/app').FirebaseApp,
    clientType: 'passenger' | 'driver',
    attempt = 0,
  ) => {
    const token = liff.getAccessToken() ?? '';
    if (!token) return;
    lineAccessToken.value = token;

    const res = await $fetch<{ data: { customToken?: string; roles?: Role[]; approved?: boolean; displayName?: string; pictureUrl?: string }; status?: { code: number; message?: { zh_tw?: string } } }>(
      '/nuxt-api/auth/line-exchange',
      { method: 'POST', body: { lineAccessToken: token, clientType } },
    ).catch((err) => {
      console.error('[StoreAuth] line-exchange failed:', err);
      return null;
    });

    // W0 2026-06-18：把 server 回的錯誤訊息顯示給 user
    // 過去這條 path 完全沉默 —— server 用 badRequestError 等 utility 回傳 HTTP 200 + envelope
    // status.code=400/401/500，$fetch 不會 throw，res?.data 對空 {} 也是 truthy，前面 if 都過，
    // 最後在「res.data.customToken 不存在」處安靜失敗，user 看不到任何訊息（Peter case 黑箱根因）。
    // 抓 status.code !== 200 顯示 ElMessage error toast，附 server 帶的 zh_tw 訊息（如「LINE Token
    // 來源不符」「建立使用者失敗」），下次同類問題能直接被 user / 客服第一線辨識。
    //
    // 注意：不在 W0 擴張 B 方案觸發條件 —— B 方案 reload 會清掉 toast，user 反而看不到錯誤訊息。
    // B 方案因 server 200 envelope 而從未實際被 fire 的設計 bug 留 W3 一併處理。
    if (res && res.status?.code != null && res.status.code !== 200) {
      console.warn('[StoreAuth] line-exchange returned error:', res.status.code, res.status.message?.zh_tw);
      logAuth({
        event: 'auth.line-exchange.bad-status',
        message: `code=${res.status.code}: ${res.status.message?.zh_tw ?? ''}`,
        metadata: {
          code: res.status.code,
          messageZh: res.status.message?.zh_tw,
          clientType,
        },
      });
      if (typeof window !== 'undefined') {
        try {
          ElMessage({
            message: `LINE 登入失敗（${res.status.code}）：${res.status.message?.zh_tw ?? '請重試或聯絡客服'}`,
            type: 'error',
            duration: 6000,
          });
        } catch { /* ElMessage 在 plugin boot 階段尚未 ready 時靜默 */ }
      }
    }

    // 認證根治 P1：line-exchange 傳輸失敗（res null，網路/快取 hiccup）→ 有上限退避重試。
    // 全程保留 LIFF 登入（不 logout、不 reload），避免砍掉唯一能鑄 session 的 LIFF token
    // 以及觸發動態 redirect_uri 迴圈。連續 3 次仍失敗則放棄，待下次核心動作或開機重試。
    if (!res && liff.isLoggedIn()) {
      if (attempt < _EXCHANGE_MAX_RETRY) {
        const delay = _EXCHANGE_BACKOFF_MS[attempt] ?? 2000;
        logAuth({
          event: 'auth.line-exchange.retry',
          severity: 'warn',
          message: `line-exchange 傳輸失敗，第 ${attempt + 1} 次退避重試（${delay}ms）`,
          metadata: { attempt: attempt + 1, delay, clientType },
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        return _ExchangeLiffTokenBackground(liff, firebaseApp, clientType, attempt + 1);
      }
      logAuth({
        event: 'auth.line-exchange.retry-exhausted',
        severity: 'error',
        message: `line-exchange 連續 ${_EXCHANGE_MAX_RETRY} 次傳輸失敗，保留 LIFF 登入待下次重試`,
        metadata: { clientType },
      });
      return;
    }

    if (res?.data) {
      if (res.data.displayName && res.data.pictureUrl) {
        lineProfile.value = { displayName: res.data.displayName, pictureUrl: res.data.pictureUrl };
      }
      const parsed = _normalizeRoles(res.data.roles);
      if (parsed.length > 0) {
        roles.value = parsed;
        _noteRolesArrived('line-exchange'); // 埋點
        approved.value = res.data.approved ?? true;
      }

      const { getAuth, signInWithCustomToken } = await import('firebase/auth');
      if (!getAuth(firebaseApp).currentUser && res.data.customToken) {
        await signInWithCustomToken(getAuth(firebaseApp), res.data.customToken);
        // W3：成功建立 Firebase session → 清 LIFF redirect circuit breaker 計數
        // key 須與 app/composables/use-liff-redirect-guard.ts 同步
        if (typeof sessionStorage !== 'undefined') {
          try {
            sessionStorage.removeItem('liff_redirect_count');
            sessionStorage.removeItem('liff_redirect_lock_until');
          } catch { /* 隱私模式 / quota 滿時靜默 */ }
        }
      }
    }
  };

  const _InitLiffFlow = async (firebaseApp: import('firebase/app').FirebaseApp) => {
    const config = useRuntimeConfig().public;

    // ── 管理端：完全跳過 LIFF ────────────────────────────────────────────────────────────────────
    // Admin 走純 Firebase Email/Password 驗證，不進 LIFF 環境，不需任何 LINE token。
    // liff.init() 在純 Web 環境執行會拋錯或掛起，跳過可避免初始化噪音。
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      liffReady.value = true;
      return;
    }

    // client liff.init({ liffId }) 必須帶**對應入口的 LIFF ID**：
    //   - 司機從 driver LIFF 進來 → 用 driver LIFF ID
    //   - 乘客從 passenger LIFF 進來 → 用 passenger LIFF ID
    // 否則 liffId 與實際開啟的 LIFF browser 不匹配 → liff.init 行為異常 → 跳回 endpoint 首頁。
    //
    // ⚠️ 關鍵陷阱：司機點 LINE Flex 深連結（liff.line.me/{driverLiffId}/driver/dispatched/xxx）
    // 進來時，LIFF 用 `liff.state` query 傳遞目標 path，此時 window.location.pathname 還是 `/`
    // （目標 path 在 ?liff.state= 裡，要等 liff.init() 完成 SDK 才還原）。
    // 因此判斷入口端必須**同時看 pathname 與 liff.state**，否則司機一律被誤判成乘客。
    const _resolveEntryPath = (): string => {
      if (typeof window === 'undefined') return '';
      const rawPath = window.location.pathname;
      if (rawPath.startsWith('/driver')) return rawPath;
      const params = new URLSearchParams(window.location.search);
      const stateOrNext = params.get('liff.state') || params.get('next') || '';
      if (!stateOrNext) return rawPath;
      try {
        return decodeURIComponent(stateOrNext);
      } catch {
        return rawPath;
      }
    };
    const isDriverEntry = _resolveEntryPath().startsWith('/driver');
    const liffId = isDriverEntry
      ? (config.lineLiffIdDriver || config.lineLiffIdPassenger)
      : (config.lineLiffIdPassenger || config.lineLiffIdDriver);
    const clientType: 'passenger' | 'driver' = isDriverEntry ? 'driver' : 'passenger';

    if (!liffId) { liffReady.value = true; return; }

    try {
      const liff = (await import('@line/liff')).default;

      // W3：8 秒 timeout（手機慢速網路保留餘裕；login 頁按鈕另有 guard 補 init）
      await Promise.race([
        liff.init({ liffId }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('liff.init 逾時')), 8_000)
        ),
      ]);

      // B方案：?force-relogin=1 手動觸發一次性恢復（清 flag + logout + 跳轉乾淨 URL）
      {
        const sp = new URLSearchParams(window.location.search);
        if (sp.get('force-relogin') === '1') {
          sessionStorage.removeItem('liff_recovery_attempted');
          try { liff.logout(); } catch { /* LINE SDK 未初始化時略過 */ }
          const cleanUrl = window.location.href
            .replace(/([?&])force-relogin=1(&?)/, (_, q, a) => a ? q : '')
            .replace(/\?$/, '');
          location.replace(cleanUrl);
          return;
        }
      }

      // ── Firebase-First Gate ─────────────────────────────────────────────────────────────────
      // 等待 Firebase SDK 從 IndexedDB 恢復 session（最多 5 秒 buffer）。
      // 此步驟是整個 Firebase-First 架構的核心：
      //   - 舊版直接讀 getAuth().currentUser，在 cold start 時恆為 null → 誤觸 liff.login()
      //   - 新版等 onAuthStateChanged 第一次回調後才讀 currentUser，確保值可信
      await Promise.race([
        _firebaseReadyPromise,
        new Promise<void>((r) => setTimeout(r, 5_000)),
      ]);

      const { getAuth } = await import('firebase/auth');
      const currentUser = getAuth(firebaseApp).currentUser;

      if (currentUser) {
        // ── Firebase Session 存活：立即放行，LIFF 相關動作移至背景 ─────────────────────────
        // 使用者在平台的會話有效，不因 LIFF token 過期（12h）而重定向。
        // 此分支覆蓋「重整 + LIFF token 過期」的最常見閃爍場景。
        liffReady.value = true;

        // 背景：更新 LIFF profile cache（頭像/名稱）
        void _RefreshLiffProfileBackground(liff);

        // 背景：若 LIFF token 仍有效，靜默刷新 roles（roles 可能因 admin 異動而變）
        // 若 LIFF token 已過期（liff.isLoggedIn() === false），不 redirect，
        // 等使用者觸發核心動作（叫車、接單）時再由 GetFreshLiffToken() 引導
        if (liff.isLoggedIn()) {
          void _ExchangeLiffTokenBackground(liff, firebaseApp, clientType);
        }

        // liff.state 路由同步（司機深連結）
        void _SyncLiffStateRoute();
        return;
      }

      // ── 雙失聯：Firebase 無 session 且 LIFF 也未登入 ────────────────────────────────────
      // 過去設計：plugin boot 時自動 `liff.login({ redirectUri: window.location.href })`，
      // 假設 LINE 已授權用戶可秒回。
      //
      // 2026-06-17 修：對「裝有 LINE app 但未登入 LINE 帳號」/ 純 Safari/Chrome 未授權的全新用戶，
      // user 在 LINE 登入頁取消 → redirect 回原 URL → plugin 又跑此分支 → 再 liff.login() →
      // infinite loop。user 連 `/login` 的「LINE 登入按鈕」都看不到。
      //
      // 現行：plugin 不自動 redirect，把 LINE 授權動作交還給 `/login` / `/driver/auth` 的
      // 「LINE 登入按鈕」（ClickLineLogin）— user 看到頁面、自己決定何時授權。
      //   - 公開頁（/、/fleet、/fare、/faq、/legal）→ 全新用戶可正常瀏覽，不再被踢
      //   - 受保護頁 → middleware/auth 偵測 isSignIn=false 後 navigateTo('/login')
      //   - Firebase session 活著的回訪用戶 → 走上面 `if (currentUser)` 分支不受影響
      //   - 真「雙失聯」回訪用戶（極少：Firebase + LIFF 同時過期）→ middleware 踢 /login
      //     多按一下按鈕，可接受 trade-off，換來不 loop kill 全新用戶
      if (!liff.isLoggedIn()) {
        liffReady.value = true;
        return;
      }

      // ── Firebase 無 session 但 LIFF 有 Token ────────────────────────────────────────────
      // 邊緣情況：Firebase session 剛好在 1h 到期（auto-refresh 失敗），但 LIFF token 尚在。
      // 用 LIFF token 換 Firebase customToken，重建 Firebase session。
      lineAccessToken.value = liff.getAccessToken() ?? '';
      liffReady.value = true;

      // W1：getFriendship 移出關鍵路徑，背景執行省 0.3-0.8s
      void (async () => {
        try {
          const friendship = await liff.getFriendship();
          isFriend.value = friendship.friendFlag;
        } catch {
          isFriend.value = null;
        }
      })();

      await _ExchangeLiffTokenBackground(liff, firebaseApp, clientType);

      void _SyncLiffStateRoute();
    } catch (err) {
      console.error('[StoreAuth] _InitLiffFlow failed:', err);
      const e = err instanceof Error ? err : new Error(String(err));
      logAuth({
        event: 'auth.liff.init.failed',
        message: e.message,
        stack: e.stack,
        metadata: { liffId, clientType },
      });
      liffReady.value = true;
    }
  };

  // ── 路由同步：還原 liff.state 深連結目標 ──────────────────────────────────────────────────────
  // 司機點 LINE Flex 深連結（/driver/dispatched/xxx）時，LIFF 用 `liff.state` query
  // 傳遞目標 path；SDK init 後 window.location 不一定已 navigate 到目標，Vue Router
  // 也仍停在初始 route（多半 `/`）→ 司機卡在乘客端首頁、看不到訂單。
  // 解析優先序：liff.state query → next query（舊訊息相容）→ 當前非根 pathname。
  // 守則：目標必須 `/` 開頭、不可含 `//`、不可有 scheme — 避免 open redirect。
  const _SyncLiffStateRoute = async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const rawTarget = params.get('liff.state') || params.get('next') || '';
      let target = '';
      if (rawTarget) {
        try { target = decodeURIComponent(rawTarget); } catch { target = ''; }
      } else if (window.location.pathname !== '/') {
        target = window.location.pathname;
      }
      if (target && target.startsWith('/') && !target.includes('//') && !target.includes(':')) {
        const router = useRouter();
        if (target !== router.currentRoute.value.fullPath) {
          await router.replace(target);
        }
      }
    } catch (navErr) {
      console.warn('[StoreAuth] LIFF path sync failed:', navErr);
    }
  };

  // -- Actions ---------------------------------------------------------------------------------------

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

  // ── 認證根治 P1/P2：server cookie 開機權威登入判斷 + 三端 gate 欄位一把載齊 ────────────────────
  // 開機打一次 GET /nuxt-api/auth/session-check（帶 da_session cookie），以 server 回的
  // signedIn/roles/approved/level 為第一真相。命中 → isSignIn 立即為真，middleware 免等 Firebase
  // 12s hydration race。未命中（無 cookie / 尚未種）→ 不動任何 state，fallback 走 Firebase 派生。
  // sticky promise：一個 JS 生命週期只打一次（SignOut 會重置以允許重登後再查）。
  //
  // P2（2026-08-15，A 方案）：額外接收 permissions / admin2faEnrolled / driverApplication，
  // 於此一把設齊 admin/driver gate 所需的全部欄位。核心動機：cookie-only 裝置（localStorage/
  // IndexedDB 被清、但 httpOnly cookie 在）Firebase user=null → client SDK lazy loader 讀不到
  // level/2fa/driverApplication，會誤導 admin 去 /admin/2fa/setup、誤判 driver 未核准。改由 server
  // cookie 權威來源直接載入後，middleware/role 即可在 cookie 路徑正確 gate，不再依賴 Firebase user。
  const _RunSessionCheck = async (): Promise<void> => {
    if (typeof window === 'undefined') return;
    try {
      const res = await $fetch<{
        data?: {
          signedIn?: boolean;
          roles?: unknown;
          approved?: boolean;
          level?: AdminLevel | null;
          permissions?: Partial<Record<string, boolean>>;
          admin2faEnrolled?: boolean;
          driverApplication?: {
            appliedAt: string | null;
            reviewedAt: string | null;
            rejectedAt: string | null;
            rejectReason: string | null;
          } | null;
        };
      }>('/nuxt-api/auth/session-check', { credentials: 'include', timeout: 8000 }).catch(() => null);
      const data = res?.data;
      if (!data?.signedIn) return; // 未命中 → 保持沉默，交由 Firebase 派生路徑
      _sessionSignedIn.value = true;
      const parsed = _normalizeRoles(data.roles);
      if (parsed.length > 0) {
        roles.value = parsed;
        _noteRolesArrived('session-check'); // 埋點
      }
      if (typeof data.approved === 'boolean') approved.value = data.approved;
      if (data.level === 'super' || data.level === 'admin' || data.level === 'assistant') {
        level.value = data.level;
      }
      // P2：admin/driver gate 欄位（cookie 權威來源）
      if (data.permissions && typeof data.permissions === 'object') {
        adminPermissions.value = data.permissions;
      }
      if (typeof data.admin2faEnrolled === 'boolean') {
        admin2faEnrolled.value = data.admin2faEnrolled;
      }
      // server 恆回 driverApplication 欄位（driver 為物件、其餘為 null）；undefined 表舊 server 相容 → 不動
      if (data.driverApplication !== undefined) {
        driverApplication.value = data.driverApplication;
      }
    } catch (err) {
      // 網路 / 逾時 → 靜默，fallback Firebase 派生（不阻斷開機）
      console.warn('[StoreAuth] session-check failed (non-fatal):', err);
    }
  };

  const EnsureSessionChecked = (): Promise<void> => {
    if (_mockMode) return Promise.resolve();       // TestMode / E2E：跳過真實 session-check
    if (_sessionCheckPromise) return _sessionCheckPromise;
    _sessionCheckPromise = _RunSessionCheck();
    return _sessionCheckPromise;
  };

  /**
   * 取得最新的 Firebase ID token（自動 refresh）。
   * 所有受 require-auth 保護的 server endpoint 呼叫前使用。
   * Firebase ID token TTL 1 小時，getIdToken() 內部會在過期前自動 refresh。
   */
  const GetFreshIdToken = async (): Promise<string> => {
    if (typeof window === 'undefined') return idToken.value;
    try {
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

  /**
   * 取得最新有效的 LIFF Access Token（供核心業務動作使用）。
   *
   * 設計意圖（Firebase-First 架構）：
   *   - 平常的頁面瀏覽與 UI 渲染不需要 LIFF token
   *   - 只有在用戶執行「核心業務動作」時才需要向後端送 LIFF token 做身分驗證
   *     乘客端：確認叫車、查詢訂單明細
   *     司機端：接單、開始行程、抵達
   *
   * 回傳：
   *   - LIFF 登入中：當前有效的 Access Token（字串）
   *   - LIFF token 已過期：觸發 liff.login() redirect，回傳 null（caller 應中止動作）
   *   - LIFF 未初始化 / 非 LIFF 環境：回傳 null
   *
   * 注意：此函式在 LIFF token 過期時會觸發 redirect，caller 在收到 null 後應立即 return。
   * redirect 不會再顯示授權畫面（LINE 記住了一次同意），體驗約等同透明。
   */
  const GetFreshLiffToken = async (): Promise<string | null> => {
    if (typeof window === 'undefined') return null;
    try {
      const { getApps } = await import('firebase/app');
      if (getApps().length === 0) return null;
      const liff = (await import('@line/liff')).default;
      if (!liff.id) return null; // LIFF 尚未 init（例如 admin 端）

      if (liff.isLoggedIn()) {
        const token = liff.getAccessToken();
        lineAccessToken.value = token ?? '';
        return token;
      }

      // LIFF token 過期 → 此時用戶明確觸發了核心動作，redirect 是可接受的
      // LINE 已同意授權的用戶此 redirect 幾乎無感（秒回）
      //
      // W3：redirectUri 必須是 LINE Login channel「callback 白名單內的固定路徑」。
      // 過去用 window.location.href（任意 path+query）→ 永遠不在白名單 →
      // `redirect_uri does not match`（PC 外部瀏覽器必中）。收斂為端別固定路徑：
      //   司機端 → /driver/auth；其餘（乘客端）→ /login
      // 這樣全 app 送出的 redirectUri 僅有這兩個固定值，白名單好維護。
      const origin = window.location.origin;
      const isDriverCtx = window.location.pathname.startsWith('/driver');
      liff.login({ redirectUri: isDriverCtx ? `${origin}/driver/auth` : `${origin}/login` });
      return null;
    } catch (err) {
      console.error('[StoreAuth] GetFreshLiffToken failed:', err);
      return null;
    }
  };

  /** 測試模式：直接設定身分（TestMode 用，不走 Firebase） */
  const MockSignIn = (_roles: Role[]) => {
    _mockMode = true; // 認證根治 P1：EnsureSessionChecked 對 mock 直接 resolve，不打真實 session-check
    user.value = { uid: `mock-${_roles.join('-')}` } as import('firebase/auth').User;
    roles.value = _roles.length > 0 ? _roles : ['passenger'];
    approved.value = true; // 測試模式視為已核准
    _markAuthResolved();
  };

  /**
   * 登出 + 導向指定路徑。
   *
   * @param redirectTo 登出後導向路徑；預設 '/'（乘客端首頁）。
   *   - methods.ts 401 handler 在 /driver/* 路徑會傳 '/driver/auth'，避免司機被踢去乘客端
   *   - 其他主動觸發（譬如管理端登出按鈕）使用預設值
   */
  const SignOut = async (redirectTo: string = '/') => {
    // 認證根治 P1：先清 server session cookie，否則下次開機 session-check 仍回 signedIn → 看似沒登出。
    // 網路失敗不阻斷登出流程（cookie 過期後自然失效；本機仍走下方 _clearState）。
    if (typeof window !== 'undefined') {
      try {
        await $fetch('/nuxt-api/auth/session-logout', { method: 'POST', credentials: 'include' });
      } catch { /* 網路失敗略過；cookie 到期自然失效 */ }
    }
    _sessionCheckPromise = null; // 允許重登後重新 session-check
    try {
      const { getAuth } = await import('firebase/auth');
      await getAuth().signOut();
    } catch { /* Firebase 未初始化時忽略 */ }
    // 清 admin 2FA session token cache（_clearState 也會 reset flags）
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(_ADMIN_2FA_SESSION_KEY); } catch { /* ignore */ }
    }
    _clearState();
    // authResolved 保持 true（auth 流程仍是「已解析，當前未登入」狀態）
    // 若設為 false 會導致 layout v-if="!authResolved" 顯示 loading，但 plugin 不會再跑而永久卡住
    // replace 而非 push — 登出後不該按返回鍵回到受保護頁面（middleware 會再踢一次但歷史很亂）
    navigateTo(redirectTo, { replace: true });
  };

  // W4：lazy load actions（middleware/role 進對應路徑時呼叫）
  const EnsureUserDocLoaded = (): Promise<void> => _userDocLoader.ensure();
  const EnsureDriverDocLoaded = (): Promise<void> => _driverDocLoader.ensure();
  const EnsureAdminDocLoaded = (): Promise<void> => _adminDocLoader.ensure();
  const EnsureAdmin2faSessionVerified = (): Promise<void> => _admin2faSessionLoader.ensure();

  // -------------------------------------------------------------------------------------------------
  return {
    user, roles, approved, level, authResolved, liffReady, lineAccessToken, lineProfile, isFriend,
    driverApplication, referralCode,
    admin2faEnrolled, admin2faSessionVerified,
    isSignIn, isAdmin, isDriver, isPassenger, isApprovedDriver, isSuper, canManageFareRules, canManageThemes, idToken,
    InitAuthFlow, MockSignIn, SignOut, GetFreshIdToken, GetFreshLiffToken, WaitForAuthResolved,
    // 認證根治 P1：server cookie 開機權威登入判斷
    EnsureSessionChecked,
    // W4：lazy load
    EnsureUserDocLoaded, EnsureDriverDocLoaded, EnsureAdminDocLoaded, EnsureAdmin2faSessionVerified,
  };
});
