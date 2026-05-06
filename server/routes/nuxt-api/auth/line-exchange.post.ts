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
  const config = useRuntimeConfig();

  let body: RequestBody;
  try {
    body = await readBody<RequestBody>(event);
  } catch {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  if (!body?.lineAccessToken) {
    return badRequestError({ zh_tw: 'LINE Token 缺失', en: 'LINE token missing', ja: 'LINEトークンが必要です' });
  }

  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  // ── 1. 驗證 LINE Access Token ────────────────────────────
  const lineProfile = await $fetch<LineUserInfo>('https://api.line.me/oauth2/v2.1/userinfo', {
    headers: { Authorization: `Bearer ${body.lineAccessToken}` },
  }).catch(() => null);

  if (!lineProfile?.sub) {
    return badRequestError({ zh_tw: 'LINE Token 無效', en: 'Invalid LINE token', ja: '無効なLINEトークン' });
  }

  // ── 2. 初始化 Firebase Admin ──────────────────────────────
  let auth: ReturnType<typeof useFirebaseAdmin>['auth'];
  let db: ReturnType<typeof useFirebaseAdmin>['db'];
  try {
    ({ auth, db } = useFirebaseAdmin(config.firebaseServiceAccountJson));
  } catch {
    return serverError({ zh_tw: 'Firebase 初始化失敗', en: 'Firebase initialization failed', ja: 'Firebase初期化に失敗しました' });
  }

  const uid = `line:${lineProfile.sub}`;
  const isDriver = body.clientType === 'driver';
  const defaultRole = isDriver ? 'driver' : 'passenger';

  // ── 3. 取得或建立 Firebase 使用者 ─────────────────────────
  // 新使用者：driver 預設 approved: false（須等管理員核准）
  // 既有使用者：每次登入同步刷新 displayName / pictureUrl（不覆蓋 role / approved）
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
        role: defaultRole,
        approved: isDriver ? false : true,
        lineUserId: lineProfile.sub,
        displayName: lineProfile.name,
        pictureUrl: lineProfile.picture,
        createdAt: new Date(),
      });
    } catch {
      return serverError({ zh_tw: '建立使用者失敗', en: 'Failed to create user', ja: 'ユーザー作成に失敗しました' });
    }
  } else {
    // 既有使用者：merge 寫入最新 displayName / pictureUrl，避免舊文件無此兩欄位導致 Header 永遠空白
    try {
      await db.collection('users').doc(lineProfile.sub).set({
        displayName: lineProfile.name,
        pictureUrl: lineProfile.picture,
      }, { merge: true });
    } catch { /* 同步失敗不阻擋登入流程 */ }
  }

  // ── 4. 取得 Firestore 角色與核准狀態 ──────────────────────
  let role = defaultRole;
  let approved = !isDriver; // passenger 預設已核准
  try {
    const userDoc = await db.collection('users').doc(lineProfile.sub).get();
    if (userDoc.exists) {
      role = (userDoc.data()?.role as string) ?? defaultRole;
      approved = (userDoc.data()?.approved as boolean) ?? (!isDriver);
    }
  } catch {
    // Firestore 讀取失敗時沿用預設值
  }

  // ── 5. 建立 Firebase Custom Token ────────────────────────
  let customToken: string;
  try {
    customToken = await auth.createCustomToken(uid, { role });
  } catch {
    return serverError({ zh_tw: '無法建立登入憑證', en: 'Failed to create custom token', ja: 'カスタムトークンの生成に失敗しました' });
  }

  return successResponse({
    customToken,
    role,
    approved,
    lineUserId: lineProfile.sub,
    displayName: lineProfile.name,
    pictureUrl: lineProfile.picture,
  });
});
