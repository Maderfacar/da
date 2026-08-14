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
import { provisionLineUser } from '@@/utils/line-user-provision';

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
    // Step 1a：verify endpoint 驗證 token 合法性 + client_id（防偽造 token 與跨 channel 濫用）
    // LINE 的 /verify 回傳 { client_id, expires_in }，client_id 必須與本服務的 LIFF Channel 一致。
    // 此驗證採非對稱方式：token 只有 LINE 發行，server 無法偽造，可抵禦 userId 注入攻擊。
    const verifyRes = await $fetch<{ client_id: string; expires_in: number }>(
      'https://api.line.me/oauth2/v2.1/verify',
      { query: { access_token: body.lineAccessToken } },
    ).catch(() => null);

    const expectedChannelId = config.lineChannelId as string | undefined;
    if (!verifyRes?.client_id) {
      return badRequestError({ zh_tw: 'LINE Token 驗證失敗', en: 'LINE token verification failed', ja: 'LINEトークンの検証に失敗しました' });
    }
    // client_id 不符代表 token 來自其他 LINE channel（可能是偽造或測試 token）
    if (expectedChannelId && verifyRes.client_id !== expectedChannelId) {
      return badRequestError({ zh_tw: 'LINE Token 來源不符', en: 'LINE token channel mismatch', ja: 'LINEトークンのチャンネルが一致しません' });
    }

    // Step 1b：userinfo 取得使用者身分（sub / name / picture）
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

    // ── 3~6. 使用者建置（取得/建立 user → 角色核准 → 同步 claims → 簽發 custom token）─────────
    // 抽為 provisionLineUser 共用 helper，與 P3 server OAuth callback 單一真相（勿再複製一份）。
    // P10：新使用者一律建為 ['passenger']；P27：driverApplication 已搬至 drivers/{uid}.application。
    const provisioned = await provisionLineUser(auth, db, {
      sub: lineProfile.sub,
      name: lineProfile.name,
      picture: lineProfile.picture,
    });
    if (!provisioned.ok) {
      if (provisioned.reason === 'createUser') {
        return serverError({ zh_tw: '建立使用者失敗', en: 'Failed to create user', ja: 'ユーザー作成に失敗しました' });
      }
      return serverError({ zh_tw: '無法建立登入憑證', en: 'Failed to create custom token', ja: 'カスタムトークンの生成に失敗しました' });
    }

    return successResponse({
      customToken: provisioned.customToken,
      roles: provisioned.roles,
      approved: provisioned.approved,
      lineUserId: provisioned.lineUserId,
      displayName: provisioned.displayName,
      pictureUrl: provisioned.pictureUrl,
    });
  } catch (err) {
    // 兜底：任何 unhandled exception 都回 serverError，避免 Nitro 回 HTTP 500
    console.error('[line-exchange] uncaught exception:', err);
    return serverError({ zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' });
  }
});
