// LINE Access Token → Firebase Custom Token 交換
// 流程：LIFF 取得 LINE token → 本端點驗證 → 建立/取得 Firebase 使用者 → 回傳 custom token
//
// P10 重要規範（見 docs/decision-log.md 2026/05/07~08）：
//   1. config.firebaseServiceAccountJson 可能是 string 或 object（destr 自動 parse）
//      → 處理交給 useFirebaseAdmin（已內建深拷貝、必填欄位驗證）
//   2. 同步 Firebase Auth ↔ Firestore 文件時禁用 .set() 直接覆寫
//      → 必須 merge: true 或先 .get() 檢查存在性
//   3. handler 整體 wrap try-catch，避免 unhandled exception 讓 Nitro 回 HTTP 500
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@@/utils/rate-limit';

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
  try {
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

    // P31：IP 級限流 — 10 次 / 分鐘（LIFF 首次登入會連續打 token / refresh / idToken，需稍寬）
    try {
      const { db: limitDb } = useFirebaseAdmin(config.firebaseServiceAccountJson);
      const ip = getClientIp(event);
      const limit = await checkRateLimit(limitDb, {
        key: `line-exchange:ip:${ip}`,
        windowSec: 60,
        max: 10,
      });
      if (!limit.ok) {
        setResponseHeader(event, 'Retry-After', limit.retryAfter ?? 60);
        return rateLimitedResponse(limit.retryAfter ?? 60);
      }
    } catch {
      // rate-limit 內部已 fail-open；catch 是雙保險
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
    } catch (err) {
      console.error('[line-exchange] useFirebaseAdmin failed:', err);
      return serverError({ zh_tw: 'Firebase 初始化失敗', en: 'Firebase initialization failed', ja: 'Firebase初期化に失敗しました' });
    }

    const uid = `line:${lineProfile.sub}`;

    // ── 3. 取得或建立 Firebase 使用者 ─────────────────────────
    // P10：新使用者一律建為 ['passenger']，由 admin 加入額外 role
    // 既有使用者：每次登入同步刷新 displayName / pictureUrl（不覆蓋 roles / approved）
    // P27：driverApplication 已搬至 drivers/{uid}.application，users doc 不再含此欄位
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
        // 重要：用 merge: true 避免覆寫既有 Firestore 文件中的手動設定（admin 預先設好的
        // roles / approved）。Firebase Auth user 可能因前次失敗而從未建成功，但 Firestore
        // 文件已存在，直接 .set() 會把使用者已有的 roles / approved 全清掉。
        // P27：driverApplication 已搬至 drivers/{uid}.application，users doc 不再含此欄位
        const docRef = db.collection('users').doc(lineProfile.sub);
        const existingSnap = await docRef.get();
        if (existingSnap.exists) {
          await docRef.set({
            lineUserId: lineProfile.sub,
            displayName: lineProfile.name,
            pictureUrl: lineProfile.picture,
          }, { merge: true });
        } else {
          await docRef.set({
            roles: ['passenger'],
            approved: true,
            lineUserId: lineProfile.sub,
            displayName: lineProfile.name,
            pictureUrl: lineProfile.picture,
            createdAt: new Date(),
          });
        }
      } catch (err) {
        console.error('[line-exchange] createUser/set failed:', err);
        return serverError({ zh_tw: '建立使用者失敗', en: 'Failed to create user', ja: 'ユーザー作成に失敗しました' });
      }
    } else {
      // 既有使用者：merge 寫入最新 displayName / pictureUrl
      try {
        await db.collection('users').doc(lineProfile.sub).set({
          displayName: lineProfile.name,
          pictureUrl: lineProfile.picture,
        }, { merge: true });
      } catch (err) {
        // 同步失敗不阻擋登入流程，但要 log（避免 displayName / pictureUrl 永遠不更新無人發現）
        console.warn('[line-exchange] existing user displayName/pictureUrl sync failed (non-fatal):', err);
      }
    }

    // ── 4. 取得 Firestore 角色與核准狀態 ──────────────────────
    type Role = 'passenger' | 'driver' | 'admin';
    // 容錯：若使用者在 Firebase Console 誤把 roles 存成 string 型別，嘗試 parse
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

    return successResponse({
      customToken,
      roles,
      approved,
      lineUserId: lineProfile.sub,
      displayName: lineProfile.name,
      pictureUrl: lineProfile.picture,
    });
  } catch (err) {
    // 兜底：任何 unhandled exception 都回 serverError，避免 Nitro 回 HTTP 500
    console.error('[line-exchange] uncaught exception:', err);
    return serverError({ zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' });
  }
});
