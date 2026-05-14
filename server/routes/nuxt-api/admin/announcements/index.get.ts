/**
 * GET /nuxt-api/admin/announcements
 *
 * 列出公告（admin 用），支援 status filter + 分頁。
 *
 * Query：
 *   status?: 'draft' | 'published' | 'archived' | 'all'（default='all'）
 *   limit?:  number（1-100，default=20）
 *   cursor?: string（上一頁最後一篇的 createdAt ISO；optional）
 *
 * 回傳：
 *   { items: AnnouncementDoc[], nextCursor: string | null }
 *
 * 排序：createdAt desc（最新在前）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

const VALID_STATUS = ['draft', 'published', 'archived', 'all'] as const;
type FilterStatus = typeof VALID_STATUS[number];

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  const query = getQuery(event);
  const statusRaw = (query.status as string | undefined) ?? 'all';
  if (!VALID_STATUS.includes(statusRaw as FilterStatus)) {
    return badRequestError({ zh_tw: 'status 參數錯誤', en: 'Invalid status', ja: 'status が無効' });
  }
  const status = statusRaw as FilterStatus;

  let limit = Number(query.limit ?? 20);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  const cursor = (query.cursor as string | undefined) ?? null;

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    let q: FirebaseFirestore.Query = db.collection('announcements').orderBy('createdAt', 'desc');
    if (status !== 'all') {
      q = q.where('status', '==', status);
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        q = q.startAfter(cursorDate);
      }
    }
    q = q.limit(limit + 1); // 多撈 1 篇判斷是否還有下一頁

    const snap = await q.get();
    const docs = snap.docs.slice(0, limit);
    const hasMore = snap.docs.length > limit;

    const items = docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        publishedAt: data.publishedAt?.toDate?.()?.toISOString?.() ?? null,
        archivedAt: data.archivedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    });

    const nextCursor = hasMore
      ? (docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString?.() ?? null)
      : null;

    return successResponse({ items, nextCursor });
  } catch (err) {
    console.error('[admin/announcements GET] failed:', err);
    // Firestore 缺 composite index 時 err.message 會帶 console URL，dev mode 暴露給 client 方便部署
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `伺服器錯誤：${detail}` : '伺服器錯誤',
      en: detail ? `Server error: ${detail}` : 'Server error',
      ja: detail ? `サーバーエラー: ${detail}` : 'サーバーエラー',
    });
  }
});
