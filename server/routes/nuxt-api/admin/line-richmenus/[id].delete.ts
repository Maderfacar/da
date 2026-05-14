/**
 * DELETE /nuxt-api/admin/line-richmenus/[id]
 *
 * 刪除 richmenu。
 *
 * **限制**：
 *   - status='active' 不允許刪除（需先 unpublish 把 LINE 端 default 清掉）
 *   - LINE 端 richmenu 若已建立（lineRichMenuId 非 null）→ 一併 DELETE 至 LINE
 *   - Firebase Storage 圖片同步清除（archived 也清；rollback 需求由 archived doc 內 imageUrl 重新 push）
 *
 * 副作用：audit log `line.richmenu.delete`
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { deleteRichmenu, LineApiError } from '@@/utils/line-richmenu';
import type { LineRichmenuDoc } from '@@/utils/line-richmenu-doc';

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
    const { db, storage } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('line_richmenus').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: 'richmenu 不存在', en: 'Richmenu not found', ja: 'richmenu が見つかりません' });
    }
    const existing = snap.data() as LineRichmenuDoc;

    if (existing.status === 'active') {
      return badRequestError({
        zh_tw: 'active 狀態不允許刪除，請先取消預設',
        en: 'Cannot delete active richmenu; unpublish first',
        ja: 'active の richmenu は削除できません。先に unpublish してください',
      });
    }

    // ── 1. 刪 LINE 端 richmenu（若已建立）─────────────────────
    let lineDeleted = false;
    if (existing.lineRichMenuId) {
      try {
        await deleteRichmenu(existing.channel, existing.lineRichMenuId);
        lineDeleted = true;
      } catch (err) {
        // 404 視為已不存在（無需 retry）；其他錯誤往上拋
        if (err instanceof LineApiError && err.statusCode === 404) {
          lineDeleted = true;
        } else {
          console.error('[admin/line-richmenus/[id] DELETE] LINE delete failed:', err);
          return serverError({
            zh_tw: `LINE 端刪除失敗：${(err as Error).message ?? '未知錯誤'}`,
            en: `LINE deletion failed: ${(err as Error).message ?? 'unknown'}`,
            ja: `LINE 削除失敗: ${(err as Error).message ?? '不明'}`,
          });
        }
      }
    }

    // ── 2. 刪 Firebase Storage 圖片（best-effort）────────────
    if (existing.imageObjectPath) {
      try {
        await storage.bucket().file(existing.imageObjectPath).delete({ ignoreNotFound: true });
      } catch (err) {
        // 不阻擋 Firestore 刪除
        console.warn('[admin/line-richmenus/[id] DELETE] storage delete failed (silent):', err);
      }
    }

    // ── 3. 刪 Firestore doc ─────────────────────────────────
    await ref.delete();

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.delete',
      targetType: 'line_richmenu',
      targetId: id,
      payload: {
        channel: existing.channel,
        status: existing.status,
        lineRichMenuId: existing.lineRichMenuId,
        lineDeleted,
      },
    });

    return successResponse({ id, deleted: true, lineDeleted });
  } catch (err) {
    console.error('[admin/line-richmenus/[id] DELETE] failed:', err);
    return serverError();
  }
});
