/**
 * GET /nuxt-api/driver/announcements
 *
 * 司機端公告欄列表。
 *
 * 過濾規則：
 *   - status='published'
 *   - channels.inApp=true
 *   - targetType 必為 'all' 或 'driver'（passenger / order 一律不在司機端顯示）
 *   - caller 必須有 driver role
 *
 * Query：
 *   limit?: number（1-50，default=20）
 *   cursor?: string（上一頁最後一篇 publishedAt ISO）
 *
 * 回傳：
 *   { items: AnnouncementListItem[], nextCursor: string | null }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { isAnnouncementVisibleToDriver } from '@@/utils/announcement';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身份', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  const query = getQuery(event);
  let limit = Number(query.limit ?? 20);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  const cursor = (query.cursor as string | undefined) ?? null;

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    let q: FirebaseFirestore.Query = db.collection('announcements')
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc');
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) q = q.startAfter(cursorDate);
    }
    q = q.limit(limit * 3 + 1);

    const snap = await q.get();

    const visible = snap.docs.filter((doc) => {
      const data = doc.data();
      const channels = data.channels as { line?: boolean; inApp?: boolean } | undefined;
      if (!channels?.inApp) return false;
      return isAnnouncementVisibleToDriver(
        { status: data.status, targetType: data.targetType },
        { roles: auth.roles },
      );
    });

    const docs = visible.slice(0, limit);
    const hasMore = visible.length > limit;

    // 撈 announcement_reads/{lineUid}/items 取得已讀狀態
    const readIdsSet = new Set<string>();
    if (docs.length > 0) {
      try {
        const readsSnap = await db.collection('announcement_reads')
          .doc(auth.lineUid)
          .collection('items')
          .get();
        readsSnap.docs.forEach((d) => readIdsSet.add(d.id));
      } catch {
        // 沒有 sub-collection 視為全部未讀
      }
    }

    const items = docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        coverImageUrl: data.coverImageUrl ?? null,
        publishedAt: data.publishedAt?.toDate?.()?.toISOString?.() ?? null,
        isRead: readIdsSet.has(doc.id),
      };
    });

    const nextCursor = hasMore
      ? (docs[docs.length - 1].data().publishedAt?.toDate?.()?.toISOString?.() ?? null)
      : null;

    return successResponse({ items, nextCursor });
  } catch (err) {
    console.error('[driver/announcements GET] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `伺服器錯誤：${detail}` : '伺服器錯誤',
      en: detail ? `Server error: ${detail}` : 'Server error',
      ja: detail ? `サーバーエラー: ${detail}` : 'サーバーエラー',
    });
  }
});
