/**
 * GET /nuxt-api/admin/legal-pages
 *
 * 列出 'terms' / 'privacy' 兩 doc；不存在則回 placeholder（version=0、空 title/bodyHtml），
 * 讓 admin UI 一打開就有完整 2 個欄位可填。
 *
 * 權限：canBroadcast（與 announcement / template / richmenu 一致）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  LEGAL_PAGE_KEYS,
  placeholderLegalPageDto,
  toLegalPageDto,
  type LegalPageDoc,
  type LegalPageDto,
} from '@@/utils/legal-pages';

interface ListRes {
  items: LegalPageDto[];
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snaps = await Promise.all(
      LEGAL_PAGE_KEYS.map((k) => db.collection('legal_pages').doc(k).get()),
    );

    const items: LegalPageDto[] = LEGAL_PAGE_KEYS.map((k, idx) => {
      const snap = snaps[idx]!;
      if (!snap.exists) return placeholderLegalPageDto(k);
      return toLegalPageDto({ ...(snap.data() as Partial<LegalPageDoc>), key: k });
    });

    return successResponse<ListRes>({ items });
  } catch (err) {
    console.error('[admin/legal-pages GET list] failed:', err);
    return serverError();
  }
});
