/**
 * POST /nuxt-api/driver-docs/sign
 * 重簽司機證件 GCS URL（TTL 4 小時）— P31 資安債修補
 *
 * 用途：client 端從 Firestore 讀到 documents.{type} 內舊 1 年 URL，或 4h URL 已過期；
 *      呼叫本端點傳入舊 URL，server 反推 objectPath 後重簽 4h URL 回傳。
 *
 * 授權：
 *   - admin（roles includes 'admin'）：可重簽任何 driver 證件
 *   - driver self：URL 必須屬於 caller 自己（drivers/{lineUid}/* path 比對）
 *
 * Body:
 *   url: string  — 既有 GCS signed URL（必須 https://storage.googleapis.com/ 開頭）
 *
 * Response:
 *   { url: string }  — 新 4h URL；若反推失敗 fallback 原 URL（已 log warn）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { resignGcsUrl, reverseParseObjectPath } from '@@/utils/signed-url';

interface PostBody {
  url?: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  if (!body || !body.url || typeof body.url !== 'string') {
    return badRequestError({ zh_tw: '請提供 url', en: 'url is required', ja: 'url が必要です' });
  }
  if (!body.url.startsWith('https://storage.googleapis.com/')) {
    return badRequestError({ zh_tw: 'url 必須為 GCS signed URL', en: 'url must be a GCS signed URL', ja: 'GCS signed URL が必要です' });
  }

  // owner-only 路徑驗證：driver 自己只能重簽自家證件
  const parsed = reverseParseObjectPath(body.url);
  if (!parsed) {
    return badRequestError({ zh_tw: 'url 格式無法解析', en: 'cannot parse url', ja: 'url 形式が無効です' });
  }
  const isAdmin = auth.roles.includes('admin');
  if (!isAdmin) {
    // objectPath 期待格式：drivers/{lineUid}/{docType}-{ts}.{ext}
    const segments = parsed.objectPath.split('/');
    const pathLineUid = segments[0] === 'drivers' ? segments[1] : null;
    if (!pathLineUid || pathLineUid !== auth.lineUid) {
      return forbiddenError({ zh_tw: '無權重簽他人證件', en: 'Cannot resign other user\'s document', ja: '他人の証明書は再署名できません' });
    }
  }

  try {
    const { storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const fresh = await resignGcsUrl(storage, body.url);
    return successResponse({ url: fresh });
  } catch (err) {
    console.error('[driver-docs/sign] resign failed:', err);
    return serverError();
  }
});
