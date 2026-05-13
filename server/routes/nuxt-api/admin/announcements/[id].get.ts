/**
 * GET /nuxt-api/admin/announcements/[id]
 *
 * 讀取單篇公告詳情（admin 用，含 draft / published / archived 三種 status）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: 'id 缺失', en: 'id is required', ja: 'id が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('announcements').doc(id).get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '公告不存在', en: 'Announcement not found', ja: 'お知らせが見つかりません' });
    }
    const data = snap.data() ?? {};
    return successResponse({
      id: snap.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
      publishedAt: data.publishedAt?.toDate?.()?.toISOString?.() ?? null,
      archivedAt: data.archivedAt?.toDate?.()?.toISOString?.() ?? null,
    });
  } catch (err) {
    console.error('[admin/announcements/[id] GET] failed:', err);
    return serverError();
  }
});
