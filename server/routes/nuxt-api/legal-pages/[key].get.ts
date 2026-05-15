/**
 * GET /nuxt-api/legal-pages/[key]
 *
 * 公開讀取會員服務條款 / 隱私權政策（無 auth 限制）。
 *
 * - 30s Vercel edge cache + 300s stale-while-revalidate（內容更新延遲可接受）
 * - 不存在的 doc 回 404；admin 必須先在 /admin/settings 建立
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import {
  validateLegalKey,
  toLegalPageDto,
  type LegalPageDoc,
} from '@@/utils/legal-pages';

export default defineEventHandler(async (event) => {
  const rawKey = getRouterParam(event, 'key');
  const keyCheck = validateLegalKey(rawKey);
  if (!keyCheck.ok) {
    return badRequestError({ zh_tw: keyCheck.error, en: keyCheck.error, ja: keyCheck.error });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('legal_pages').doc(keyCheck.value).get();
    if (!snap.exists) {
      return notFoundError({
        zh_tw: '尚未發布',
        en: 'Not published yet',
        ja: 'まだ公開されていません',
      });
    }

    // 公開頁面，30s edge cache + 300s SWR
    setHeader(event, 'Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');

    return successResponse(toLegalPageDto({ ...(snap.data() as Partial<LegalPageDoc>), key: keyCheck.value }));
  } catch (err) {
    console.error('[legal-pages [key] GET] failed:', err);
    return serverError();
  }
});
