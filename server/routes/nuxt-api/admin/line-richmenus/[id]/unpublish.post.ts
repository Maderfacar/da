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
import { clearDefaultRichmenu, unlinkRichmenuFromUser, LineApiError } from '@@/utils/line-richmenu';
import type { LineRichmenuDoc } from '@@/utils/line-richmenu-doc';

/** P42：unpublish 後對既有綁定 user batch unlink 的硬上限（與 publish 對齊） */
const UNBIND_USER_LIMIT = 100;
const UNBIND_THROTTLE_MS = 100;
const _sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

    // P42：lang='zh_tw' 才清 LINE channel default（其他 lang 是 per-user 綁定，無 default 可清）
    let lineCleared = false;
    let syncError: string | null = null;
    if (existing.lang === 'zh_tw') {
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
    } else {
      lineCleared = true; // 非 zh_tw 沒 default 可清，視為「清乾淨」
    }

    // P42：對該 lang 既有綁定 user batch unlink（讓 user 看 LINE default / fallback lang richmenu）
    const unbindStats: {
      total: number;
      success: number;
      failed: number;
      limitExceeded: boolean;
      errors: Array<{ lineUid: string; error: string }>;
    } = { total: 0, success: 0, failed: 0, limitExceeded: false, errors: [] };

    try {
      const usersSnap = await db.collection('users')
        .where('lang', '==', existing.lang)
        .limit(UNBIND_USER_LIMIT + 1)
        .get();

      if (usersSnap.size > UNBIND_USER_LIMIT) {
        unbindStats.total = UNBIND_USER_LIMIT;
        unbindStats.limitExceeded = true;
        console.warn(`[unpublish] unbind skipped: user count for lang=${existing.lang} > ${UNBIND_USER_LIMIT}; needs cron job (P50+)`);
      } else {
        unbindStats.total = usersSnap.size;
        for (const userDoc of usersSnap.docs) {
          const lineUid = userDoc.id;
          try {
            await unlinkRichmenuFromUser(existing.channel, lineUid);
            unbindStats.success += 1;
          } catch (err) {
            // 404 視為「user 本來就沒綁」也算 success
            if (err instanceof LineApiError && err.statusCode === 404) {
              unbindStats.success += 1;
            } else {
              unbindStats.failed += 1;
              const msg = err instanceof LineApiError
                ? `[${err.statusCode}] ${err.message}`
                : ((err as Error).message ?? 'Unknown');
              if (unbindStats.errors.length < 10) {
                unbindStats.errors.push({ lineUid, error: msg });
              }
            }
          }
          await _sleep(UNBIND_THROTTLE_MS);
        }
      }
    } catch (err) {
      console.error('[unpublish] unbind batch failed:', err);
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
        lang: existing.lang,
        lineRichMenuId: existing.lineRichMenuId,
        lineCleared,
        syncError,
        unbindStats,
      },
    });

    return successResponse({ id, status: 'archived', lineCleared, syncError, unbindStats });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/unpublish] failed:', err);
    return serverError();
  }
});
