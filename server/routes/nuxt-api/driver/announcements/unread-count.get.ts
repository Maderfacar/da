/**
 * GET /nuxt-api/driver/announcements/unread-count
 *
 * 司機端未讀公告數（drawer 紅點 polling 用）。
 *
 * 邏輯：
 *   1. 撈 announcements status='published' & channels.inApp=true & visible-to-driver → 集合 A
 *   2. 撈 announcement_reads/{lineUid}/items 全部 id → 集合 B
 *   3. 回傳 |A − B|
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

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    const annSnap = await db.collection('announcements')
      .where('status', '==', 'published')
      .get();

    const visibleIds = new Set<string>();
    annSnap.docs.forEach((doc) => {
      const data = doc.data();
      const channels = data.channels as { inApp?: boolean } | undefined;
      if (!channels?.inApp) return;
      if (isAnnouncementVisibleToDriver(
        { status: data.status, targetType: data.targetType },
        { roles: auth.roles },
      )) {
        visibleIds.add(doc.id);
      }
    });

    let readIds = new Set<string>();
    try {
      const readsSnap = await db.collection('announcement_reads')
        .doc(auth.lineUid)
        .collection('items')
        .get();
      readIds = new Set(readsSnap.docs.map((d) => d.id));
    } catch {
      // 沒有 sub-collection → 全未讀
    }

    let unread = 0;
    for (const id of visibleIds) {
      if (!readIds.has(id)) unread += 1;
    }

    return successResponse({ unread, total: visibleIds.size });
  } catch (err) {
    console.error('[driver/announcements/unread-count] failed:', err);
    return serverError();
  }
});
