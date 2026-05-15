/**
 * GET /nuxt-api/driver/announcements/[id]
 *
 * 司機端公告詳情。順帶寫 announcement_reads/{lineUid}/items/{id}。
 *
 * 安全：
 *   - 必須登入 + 有 driver role（否則 403）
 *   - 公告必須對司機可見（status=published / inApp=true / targetType in [all, driver]）
 *     不符合一律 404 — 避免洩漏 draft / 非司機 target 公告的 id 是否存在
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { isAnnouncementVisibleToDriver } from '@@/utils/announcement';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身份', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }

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

    const channels = data.channels as { inApp?: boolean } | undefined;
    const visible = !!channels?.inApp && isAnnouncementVisibleToDriver(
      { status: data.status, targetType: data.targetType },
      { roles: auth.roles },
    );
    if (!visible) {
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
        console.error('[driver/announcements GET id] write read failed:', err);
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
    console.error('[driver/announcements GET id] failed:', err);
    return serverError();
  }
});
