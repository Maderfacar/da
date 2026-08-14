// 認證根治 Phase 0：用「剛驗過的 Firebase ID token」換 server 簽發的 httpOnly session cookie。
// client 於 signInWithCustomToken 後 getIdToken → 打本端點；之後 API 靠 cookie，不再需要保住前端 session。
//
// CSRF：本端點無 cookie 也可打，靠「攻擊者拿不到受害者的新鮮 idToken」天然防護（body 必帶合法 idToken）。
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@@/utils/rate-limit';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { createSessionCookie } from '@@/utils/session-cookie';

interface RequestBody {
  idToken?: string;
}

export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig();
    if (!config.firebaseServiceAccountJson) {
      return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
    }

    let body: RequestBody;
    try {
      body = await readBody<RequestBody>(event);
    } catch {
      return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
    }

    const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
    if (!idToken) {
      return badRequestError({ zh_tw: 'idToken 缺失', en: 'idToken missing', ja: 'idTokenが必要です' });
    }

    // IP 級限流（與 line-exchange 一致，首次登入連打稍寬）
    try {
      const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
      const ip = getClientIp(event);
      const limit = await checkRateLimit(db, { key: `session-login:ip:${ip}`, windowSec: 60, max: 10 });
      if (!limit.ok) {
        setResponseHeader(event, 'Retry-After', limit.retryAfter ?? 60);
        return rateLimitedResponse(limit.retryAfter ?? 60);
      }
    } catch {
      // rate-limit 內部已 fail-open；catch 雙保險
    }

    // 先驗 idToken 合法性，避免拿垃圾 token 去 createSessionCookie
    const { auth } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    let lineUid: string;
    try {
      const decoded = await auth.verifyIdToken(idToken);
      lineUid = decoded.uid.startsWith('line:') ? decoded.uid.slice(5) : decoded.uid;
    } catch {
      return unauthorizedError({ zh_tw: '登入憑證無效', en: 'Invalid auth token', ja: '認証トークンが無効です' });
    }

    const ok = await createSessionCookie(event, idToken);
    if (!ok) {
      return serverError({ zh_tw: '建立登入狀態失敗', en: 'Failed to create session', ja: 'セッションの作成に失敗しました' });
    }

    return successResponse({ ok: true, lineUid });
  } catch (err) {
    console.error('[session-login] uncaught exception:', err);
    return serverError({ zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' });
  }
});
