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
  const body = await readBody<RequestBody>(event);

  if (!body.lineAccessToken) {
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
  const { auth, db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
  const uid = `line:${lineProfile.sub}`;

  // ── 3. 取得或建立 Firebase 使用者 ─────────────────────────
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({
      uid,
      displayName: lineProfile.name,
      photoURL: lineProfile.picture,
    });

    const defaultRole = body.clientType === 'driver' ? 'driver' : 'passenger';
    await db.collection('users').doc(uid).set({
      role: defaultRole,
      lineUserId: lineProfile.sub,
      displayName: lineProfile.name,
      pictureUrl: lineProfile.picture,
      createdAt: new Date(),
    });
  }

  // ── 4. 取得 Firestore 角色 ────────────────────────────────
  const userDoc = await db.collection('users').doc(uid).get();
  const role = (userDoc.data()?.role as string) ?? (body.clientType === 'driver' ? 'driver' : 'passenger');

  // ── 5. 建立 Firebase Custom Token ────────────────────────
  const customToken = await auth.createCustomToken(uid, { role });

  return successResponse({ customToken, role, lineUserId: lineProfile.sub, displayName: lineProfile.name, pictureUrl: lineProfile.picture });
});
