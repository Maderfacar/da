/**
 * GET /nuxt-api/passenger/announcements/[id]
 *
 * 取單篇公告詳情；順帶寫 announcement_reads/{lineUid}/items/{id}（idempotent）。
 *
 * 安全：
 *   - 必須登入（getAuthFromEvent）
 *   - 必須對該乘客可見（status=published / inApp=true / target match）；否則 404 回應
 *     避免洩漏「draft 公告 id 是否存在」資訊
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { isAnnouncementVisibleToUser } from '@@/utils/announcement';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: 'id 缺失', en: 'id is required', ja: 'id が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('announcements').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '公告不存在', en: 'Announcement not found', ja: 'お知らせが見つかりません' });
    }
    const data = snap.data() ?? {};

    // ownedOrderIds 給 targetType='order' 過濾用
    const ownedSnap = await db.collection('orders')
      .where('userId', '==', auth.lineUid)
      .get();
    const ownedOrderIds = ownedSnap.docs.map((d) => d.id);

    const channels = data.channels as { inApp?: boolean } | undefined;
    const visible = !!channels?.inApp && isAnnouncementVisibleToUser(
      {
        status: data.status,
        targetType: data.targetType,
        targetOrderId: data.targetOrderId,
      },
      { lineUid: auth.lineUid, roles: auth.roles, ownedOrderIds },
    );
    if (!visible) {
      // 對乘客來說 = 不存在；避免 status=draft / archived / 不在受眾範圍被探測
      return notFoundError({ zh_tw: '公告不存在', en: 'Announcement not found', ja: 'お知らせが見つかりません' });
    }

    // 寫已讀（idempotent；錯誤吞掉不影響回應）
    void (async () => {
      try {
        await db.collection('announcement_reads')
          .doc(auth.lineUid)
          .collection('items')
          .doc(id)
          .set({
            announcementId: id,
            readAt: FieldValue.serverTimestamp(),
          }, { merge: true });
      } catch (err) {
        console.error('[passenger/announcements GET id] write read failed:', err);
      }
    })();

    return successResponse({
      id: snap.id,
      title: data.title,
      body: data.body,
      coverImageUrl: data.coverImageUrl ?? null,
      ctaButton: data.ctaButton ?? null,
      publishedAt: data.publishedAt?.toDate?.()?.toISOString?.() ?? null,
    });
  } catch (err) {
    console.error('[passenger/announcements GET id] failed:', err);
    return serverError();
  }
});
