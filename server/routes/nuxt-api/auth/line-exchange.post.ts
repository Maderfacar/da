// LINE Access Token → Firebase Custom Token 交換
// 流程：LIFF 取得 LINE token → 本端點驗證 → 建立/取得 Firebase 使用者 → 回傳 custom token

interface LineUserInfo {
  sub: string
  name: string
  picture: string
}

interface RequestBody {
  lineAccessToken: string
  clientType: 'passenger' | 'driver'
}

export default defineEventHandler(async (event) => {
  // 入口 log：handler 是否真的被呼叫到
  console.error('[line-exchange] handler entry');

  try {
    const config = useRuntimeConfig();

    let body: RequestBody;
    try {
      body = await readBody<RequestBody>(event);
    } catch (err) {
      console.error('[line-exchange] readBody failed:', err);
      return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
    }

    if (!body?.lineAccessToken) {
      return badRequestError({ zh_tw: 'LINE Token 缺失', en: 'LINE token missing', ja: 'LINEトークンが必要です' });
    }

    if (!config.firebaseServiceAccountJson) {
      console.error('[line-exchange] firebaseServiceAccountJson is empty/missing');
      return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
    }

    // ── 1. 驗證 LINE Access Token ────────────────────────────
    const lineProfile = await $fetch<LineUserInfo>('https://api.line.me/oauth2/v2.1/userinfo', {
      headers: { Authorization: `Bearer ${body.lineAccessToken}` },
    }).catch((err) => {
      console.error('[line-exchange] LINE userinfo fetch failed:', err);
      return null;
    });

    if (!lineProfile?.sub) {
      return badRequestError({ zh_tw: 'LINE Token 無效', en: 'Invalid LINE token', ja: '無効なLINEトークン' });
    }

    // ── 2. 初始化 Firebase Admin ──────────────────────────────
    let auth: ReturnType<typeof useFirebaseAdmin>['auth'];
    let db: ReturnType<typeof useFirebaseAdmin>['db'];
    try {
      ({ auth, db } = useFirebaseAdmin(config.firebaseServiceAccountJson));
    } catch (err) {
      console.error('[line-exchange] useFirebaseAdmin failed:', err);
      console.error('[line-exchange] service account JSON length:', config.firebaseServiceAccountJson?.length);
      console.error('[line-exchange] starts with:', config.firebaseServiceAccountJson?.slice(0, 30));
      return serverError({ zh_tw: 'Firebase 初始化失敗', en: 'Firebase initialization failed', ja: 'Firebase初期化に失敗しました' });
    }

    const uid = `line:${lineProfile.sub}`;

    // ── 3. 取得或建立 Firebase 使用者 ─────────────────────────
    let isNewUser = false;
    try {
      await auth.getUser(uid);
    } catch {
      isNewUser = true;
    }

    if (isNewUser) {
      try {
        await auth.createUser({
          uid,
          displayName: lineProfile.name,
          photoURL: lineProfile.picture,
        });
        await db.collection('users').doc(lineProfile.sub).set({
          roles: ['passenger'],
          approved: true,
          lineUserId: lineProfile.sub,
          displayName: lineProfile.name,
          pictureUrl: lineProfile.picture,
          createdAt: new Date(),
        });
      } catch (err) {
        console.error('[line-exchange] createUser/set failed:', err);
        return serverError({ zh_tw: '建立使用者失敗', en: 'Failed to create user', ja: 'ユーザー作成に失敗しました' });
      }
    } else {
      try {
        await db.collection('users').doc(lineProfile.sub).set({
          displayName: lineProfile.name,
          pictureUrl: lineProfile.picture,
        }, { merge: true });
      } catch (err) {
        console.error('[line-exchange] merge displayName/pictureUrl failed (non-fatal):', err);
      }
    }

    // ── 4. 取得 Firestore 角色與核准狀態 ──────────────────────
    type Role = 'passenger' | 'driver' | 'admin';
    const parseRoles = (raw: unknown): Role[] => {
      let arr: unknown[] = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === 'string') {
        arr = raw.replace(/[[\]'"\s]/g, '').split(',');
      }
      return arr.filter((r): r is Role => r === 'passenger' || r === 'driver' || r === 'admin');
    };
    let roles: Role[] = ['passenger'];
    let approved = true;
    try {
      const userDoc = await db.collection('users').doc(lineProfile.sub).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        const parsed = parseRoles(data?.roles);
        if (parsed.length > 0) {
          roles = parsed;
        } else if (typeof data?.role === 'string') {
          const legacy = parseRoles([data.role]);
          if (legacy.length > 0) roles = legacy;
        }
        approved = (data?.approved as boolean) ?? true;
      }
    } catch (err) {
      console.error('[line-exchange] Firestore read failed (non-fatal):', err);
    }

    // ── 5. 建立 Firebase Custom Token ────────────────────────
    let customToken: string;
    try {
      customToken = await auth.createCustomToken(uid, { roles });
    } catch (err) {
      console.error('[line-exchange] createCustomToken failed:', err);
      return serverError({ zh_tw: '無法建立登入憑證', en: 'Failed to create custom token', ja: 'カスタムトークンの生成に失敗しました' });
    }

    console.error('[line-exchange] success, returning roles=', roles, 'approved=', approved);
    return successResponse({
      customToken,
      roles,
      approved,
      lineUserId: lineProfile.sub,
      displayName: lineProfile.name,
      pictureUrl: lineProfile.picture,
    });
  } catch (err) {
    // 兜底：捕獲任何 unhandled exception，避免 Nitro 回 HTTP 500 讓 client 完全摸不著頭緒
    console.error('[line-exchange] UNCAUGHT exception:', err);
    if (err instanceof Error) {
      console.error('[line-exchange] stack:', err.stack);
    }
    return serverError({ zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' });
  }
});
