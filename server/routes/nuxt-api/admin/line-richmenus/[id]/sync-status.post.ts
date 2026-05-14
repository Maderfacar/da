/**
 * POST /nuxt-api/admin/line-richmenus/[id]/sync-status
 *
 * 詢問 LINE 端目前狀態，回傳本地 doc 與 LINE actual 的對齊狀況。
 *
 * - 撈 LINE 端目前 default richMenuId
 * - 若 doc.lineRichMenuId 存在：getRichmenuDetail 確認還在 LINE 端
 * - 回傳 {
 *     local: { status, lineRichMenuId, syncStatus },
 *     line:  { defaultRichMenuId, detailExists },
 *     match:  boolean (本地 active 且 lineRichMenuId === LINE default)
 *   }
 *
 * 同步寫 syncStatus / lastSyncedAt（不寫 syncError，純查詢不算失敗）
 *
 * 副作用：audit log `line.richmenu.sync`
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  getDefaultRichmenuId,
  getRichmenuDetail,
  LineApiError,
} from '@@/utils/line-richmenu';
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
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('line_richmenus').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: 'richmenu 不存在', en: 'Richmenu not found', ja: 'richmenu が見つかりません' });
    }
    const existing = snap.data() as LineRichmenuDoc;

    let defaultRichMenuId: string | null = null;
    let detailExists = false;
    let queryError: string | null = null;
    try {
      defaultRichMenuId = await getDefaultRichmenuId(existing.channel);
      if (existing.lineRichMenuId) {
        const detail = await getRichmenuDetail(existing.channel, existing.lineRichMenuId);
        detailExists = !!detail;
      }
    } catch (err) {
      queryError = err instanceof LineApiError
        ? `[${err.statusCode}] ${err.message}`
        : ((err as Error).message ?? 'Unknown');
      console.error('[admin/line-richmenus/[id]/sync-status] LINE query failed:', err);
    }

    const match =
      existing.status === 'active'
      && !!existing.lineRichMenuId
      && existing.lineRichMenuId === defaultRichMenuId;

    await ref.update({
      syncStatus: queryError ? 'sync_failed' : (match || existing.status !== 'active' ? 'synced' : 'sync_failed'),
      syncError: queryError,
      lastSyncedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.sync',
      targetType: 'line_richmenu',
      targetId: id,
      payload: { match, defaultRichMenuId, detailExists, queryError },
    });

    return successResponse({
      local: {
        status: existing.status,
        lineRichMenuId: existing.lineRichMenuId,
        syncStatus: queryError ? 'sync_failed' : (match || existing.status !== 'active' ? 'synced' : 'sync_failed'),
      },
      line: { defaultRichMenuId, detailExists },
      match,
      queryError,
    });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/sync-status] failed:', err);
    return serverError();
  }
});
