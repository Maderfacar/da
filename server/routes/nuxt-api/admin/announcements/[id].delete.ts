/**
 * DELETE /nuxt-api/admin/announcements/[id]
 *
 * 刪除公告。任何 status 都可刪（Brain AI 拍板：archived 可刪）。
 *
 * 副作用：
 *   - audit log `announcement.delete`
 *   - 對應的 announcement_reads sub-collection **不清理**（孤兒紀錄無害，省 Firestore write）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

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
    const ref = db.collection('announcements').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '公告不存在', en: 'Announcement not found', ja: 'お知らせが見つかりません' });
    }

    const existingTitle = (snap.data()?.title as string | undefined) ?? '';
    const existingStatus = (snap.data()?.status as string | undefined) ?? '';

    await ref.delete();

    await writeAuditLog({
      event,
      auth,
      action: 'announcement.delete',
      targetType: 'announcement',
      targetId: id,
      payload: { title: existingTitle, status: existingStatus },
    });

    return successResponse({ id, deleted: true });
  } catch (err) {
    console.error('[admin/announcements/[id] DELETE] failed:', err);
    return serverError();
  }
});
