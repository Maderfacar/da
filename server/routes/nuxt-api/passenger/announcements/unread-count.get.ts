/**
 * GET /nuxt-api/passenger/announcements/unread-count
 *
 * 乘客未讀公告數（drawer 紅點 polling 用）。
 *
 * 邏輯（design.md §5.2）：
 *   1. 撈 announcements status='published' & channels.inApp=true & visible-to-user → 集合 A
 *   2. 撈 announcement_reads/{lineUid}/items 全部 id → 集合 B
 *   3. 回傳 |A − B|
 *
 * 性能：A 集合每次掃全表（max ~500 篇 published），對 LIFF 場景可接受；
 *      若未來 published 過多，再考慮 server-side cache（30s TTL）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { isAnnouncementVisibleToUser } from '@@/utils/announcement';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // 撈 ownedOrderIds（給 targetType='order' 過濾用）
    const ownedSnap = await db.collection('orders')
      .where('userId', '==', auth.lineUid)
      .get();
    const ownedOrderIds = ownedSnap.docs.map((d) => d.id);

    // A：所有 published & inApp visible 給此 user 的 id 集合
    const annSnap = await db.collection('announcements')
      .where('status', '==', 'published')
      .get();
    const visibleIds = new Set<string>();
    annSnap.docs.forEach((doc) => {
      const data = doc.data();
      const channels = data.channels as { inApp?: boolean } | undefined;
      if (!channels?.inApp) return;
      const visible = isAnnouncementVisibleToUser(
        {
          status: data.status,
          targetType: data.targetType,
          targetOrderId: data.targetOrderId,
        },
        { lineUid: auth.lineUid, roles: auth.roles, ownedOrderIds },
      );
      if (visible) visibleIds.add(doc.id);
    });

    // B：已讀 id 集合
    let readIds = new Set<string>();
    try {
      const readsSnap = await db.collection('announcement_reads')
        .doc(auth.lineUid)
        .collection('items')
        .get();
      readIds = new Set(readsSnap.docs.map((d) => d.id));
    } catch {
      // sub-collection 不存在 → 全未讀
    }

    let unread = 0;
    for (const id of visibleIds) {
      if (!readIds.has(id)) unread += 1;
    }

    return successResponse({ unread, total: visibleIds.size });
  } catch (err) {
    console.error('[passenger/announcements/unread-count] failed:', err);
    return serverError();
  }
});
