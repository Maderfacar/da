/**
 * GET /nuxt-api/passenger/announcements
 *
 * 乘客端公告列表。
 * 過濾規則（依 design.md §1.1 + utils/announcement.isAnnouncementVisibleToUser）：
 *   - status='published' 才顯示
 *   - channels.inApp 必須為 true（line-only 公告不顯示在 App 列表）
 *   - targetType / targetOrderId 需 match user 的 roles / ownedOrderIds
 *
 * Query：
 *   limit?: number（1-50，default=20）
 *   cursor?: string（上一頁最後一篇 publishedAt ISO；optional）
 *
 * 回傳：
 *   { items: AnnouncementListItem[], nextCursor: string | null }
 *
 * 注意：每項帶 `isRead` 欄位（讀 announcement_reads/{lineUid}/items 對比）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { isAnnouncementVisibleToUser } from '@@/utils/announcement';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  const query = getQuery(event);
  let limit = Number(query.limit ?? 20);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  const cursor = (query.cursor as string | undefined) ?? null;

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // 先撈 user 的 ownedOrderIds（給 targetType='order' 過濾用）
    const ownedSnap = await db.collection('orders')
      .where('userId', '==', auth.lineUid)
      .get();
    const ownedOrderIds = ownedSnap.docs.map((d) => d.id);

    // 多撈一些（用 client-side 過濾後可能不足，每次撈 limit*3 + 1 給容錯）
    let q: FirebaseFirestore.Query = db.collection('announcements')
      .where('status', '==', 'published')
      .orderBy('publishedAt', 'desc');
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) q = q.startAfter(cursorDate);
    }
    q = q.limit(limit * 3 + 1);

    const snap = await q.get();

    // 過濾：channels.inApp + visibility
    const visible = snap.docs.filter((doc) => {
      const data = doc.data();
      const channels = data.channels as { line?: boolean; inApp?: boolean } | undefined;
      if (!channels?.inApp) return false;
      return isAnnouncementVisibleToUser(
        {
          status: data.status,
          targetType: data.targetType,
          targetOrderId: data.targetOrderId,
        },
        { lineUid: auth.lineUid, roles: auth.roles, ownedOrderIds },
      );
    });

    const docs = visible.slice(0, limit);
    const hasMore = visible.length > limit;

    // 撈 announcement_reads 對應已讀狀態
    const readIdsSet = new Set<string>();
    if (docs.length > 0) {
      try {
        const readsSnap = await db.collection('announcement_reads')
          .doc(auth.lineUid)
          .collection('items')
          .get();
        readsSnap.docs.forEach((d) => readIdsSet.add(d.id));
      } catch {
        // sub-collection 不存在或讀取失敗 → 視為全部未讀
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
    console.error('[passenger/announcements GET] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `伺服器錯誤：${detail}` : '伺服器錯誤',
      en: detail ? `Server error: ${detail}` : 'Server error',
      ja: detail ? `サーバーエラー: ${detail}` : 'サーバーエラー',
    });
  }
});
