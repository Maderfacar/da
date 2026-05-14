/**
 * POST /nuxt-api/admin/line-richmenus/[id]/unpublish
 *
 * 取消 channel default（並 archive 本 menu）。
 *
 * 流程：
 *   1. 驗 status='active'
 *   2. LINE API：DELETE /user/all/richmenu（清預設）
 *   3. Firestore：status → archived、archivedAt = now
 *
 * **不刪 LINE richmenu**（保留 lineRichMenuId 供 rollback；archived doc 可重 publish 直接套用既有 lineRichMenuId）
 *
 * 副作用：audit log `line.richmenu.unpublish`
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { clearDefaultRichmenu, LineApiError } from '@@/utils/line-richmenu';
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
    if (existing.status !== 'active') {
      return badRequestError({
        zh_tw: '僅 active 狀態可以 unpublish',
        en: 'Only active richmenu can be unpublished',
        ja: 'active のみ unpublish 可能',
      });
    }

    // LINE API 清預設
    let lineCleared = false;
    let syncError: string | null = null;
    try {
      await clearDefaultRichmenu(existing.channel);
      lineCleared = true;
    } catch (err) {
      if (err instanceof LineApiError && err.statusCode === 404) {
        lineCleared = true; // 已經沒有 default
      } else {
        syncError = (err as Error).message ?? 'Unknown';
        console.error('[admin/line-richmenus/[id]/unpublish] LINE clear failed:', err);
      }
    }

    await ref.update({
      status: 'archived',
      archivedAt: FieldValue.serverTimestamp(),
      syncStatus: lineCleared ? 'synced' : 'sync_failed',
      syncError,
      lastSyncedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.unpublish',
      targetType: 'line_richmenu',
      targetId: id,
      payload: {
        channel: existing.channel,
        lineRichMenuId: existing.lineRichMenuId,
        lineCleared,
        syncError,
      },
    });

    return successResponse({ id, status: 'archived', lineCleared, syncError });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/unpublish] failed:', err);
    return serverError();
  }
});
