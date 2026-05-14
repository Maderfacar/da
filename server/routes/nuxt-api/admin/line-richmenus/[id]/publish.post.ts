/**
 * POST /nuxt-api/admin/line-richmenus/[id]/publish
 *
 * Publish richmenu 為 channel default（複合動作）：
 *
 * 流程：
 *   1. 驗 isPublishReady（image / chatBarText / areas 都齊）
 *   2. rate-limit：publish 每 admin 每小時 ≤ 5 次（沿用 P31 rate-limit pattern）
 *   3. Firestore tx：
 *      - 把同 channel 既有 active → archived（保留 lineRichMenuId 供 rollback 用）
 *      - 把本 menu status='active'、publishedAt=now、syncStatus='syncing'
 *   4. LINE API 呼叫：
 *      - 若 lineRichMenuId 為 null → POST /richmenu（建立框架）+ POST /content（上傳圖）
 *      - POST /user/all/richmenu/{id}（設預設）
 *   5. 成功：syncStatus='synced' + lineRichMenuId 寫回；失敗：syncStatus='sync_failed' + syncError
 *
 * 副作用：audit log `line.richmenu.publish`
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { checkRateLimit, rateLimitedResponse } from '@@/utils/rate-limit';
import { isPublishReady, type LineRichmenuDoc } from '@@/utils/line-richmenu-doc';
import {
  createRichmenu,
  uploadRichmenuImage,
  setDefaultRichmenu,
  LineApiError,
} from '@@/utils/line-richmenu';

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
        zh_tw: '已是 active 狀態',
        en: 'Already active',
        ja: '既に active です',
      });
    }

    // ── 1. 驗 publish-ready ─────────────────────────────────
    const ready = isPublishReady(existing);
    if (!ready.ok) {
      return badRequestError({
        zh_tw: `尚未準備好可發佈，缺少：${ready.missing.join(', ')}`,
        en: `Not ready, missing: ${ready.missing.join(', ')}`,
        ja: `準備未完了、不足: ${ready.missing.join(', ')}`,
      });
    }

    // ── 2. Rate-limit（publish ≤ 5 / hr / admin）────────────
    try {
      const limit = await checkRateLimit(db, {
        key: `line-richmenu-publish:uid:${auth.lineUid}`,
        windowSec: 3600,
        max: 5,
      });
      if (!limit.ok) {
        setResponseHeader(event, 'Retry-After', limit.retryAfter ?? 3600);
        return rateLimitedResponse(limit.retryAfter ?? 3600);
      }
    } catch {
      // rate-limit fail-open
    }

    // ── 3. Firestore tx：archive 舊 active + mark 本 menu 'syncing' ────
    let prevActiveId: string | null = null;
    let prevActiveLineId: string | null = null;
    await db.runTransaction(async (tx) => {
      const prevQuery = await tx.get(
        db.collection('line_richmenus')
          .where('channel', '==', existing.channel)
          .where('status', '==', 'active'),
      );
      prevQuery.docs.forEach((d) => {
        if (d.id === id) return;
        prevActiveId = d.id;
        const pData = d.data() as LineRichmenuDoc;
        prevActiveLineId = pData.lineRichMenuId ?? null;
        tx.update(d.ref, {
          status: 'archived',
          archivedAt: FieldValue.serverTimestamp(),
          updatedBy: auth.lineUid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      tx.update(ref, {
        status: 'active',
        publishedAt: FieldValue.serverTimestamp(),
        syncStatus: 'syncing',
        syncError: null,
        updatedBy: auth.lineUid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // ── 4. LINE API 呼叫 ────────────────────────────────────
    let lineRichMenuId = existing.lineRichMenuId;
    let syncStatus: 'synced' | 'sync_failed' = 'synced';
    let syncError: string | null = null;

    try {
      if (!lineRichMenuId) {
        // 建立 LINE richmenu 框架
        const created = await createRichmenu(existing.channel, {
          size: existing.imageSize!,
          selected: existing.selected,
          name: existing.name.slice(0, 100),
          chatBarText: existing.chatBarText,
          areas: existing.areas,
        });
        lineRichMenuId = created.richMenuId;

        // 上傳圖片
        const [imgBuf] = await storage.bucket().file(existing.imageObjectPath!).download();
        await uploadRichmenuImage(
          existing.channel,
          lineRichMenuId,
          imgBuf,
          existing.imageMime!,
        );
      }
      // 設為 default
      await setDefaultRichmenu(existing.channel, lineRichMenuId);
    } catch (err) {
      syncStatus = 'sync_failed';
      if (err instanceof LineApiError) {
        syncError = `[${err.statusCode}] ${err.message}`;
      } else {
        syncError = (err as Error).message ?? 'Unknown';
      }
      console.error('[admin/line-richmenus/[id]/publish] LINE sync failed:', err);
    }

    // ── 5. 寫回最終狀態 ────────────────────────────────────
    await ref.update({
      lineRichMenuId,
      syncStatus,
      syncError,
      lastSyncedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.publish',
      targetType: 'line_richmenu',
      targetId: id,
      payload: {
        channel: existing.channel,
        prevActiveId,
        prevActiveLineId,
        newLineRichMenuId: lineRichMenuId,
        syncStatus,
        syncError,
      },
    });

    if (syncStatus === 'sync_failed') {
      return {
        data: { id, syncStatus, syncError, lineRichMenuId },
        status: {
          code: 502,
          message: {
            zh_tw: `Firestore 已切 active，但 LINE 同步失敗：${syncError}`,
            en: `Firestore updated but LINE sync failed: ${syncError}`,
            ja: `Firestore 更新済みだが LINE 同期失敗: ${syncError}`,
          },
        },
      };
    }

    return successResponse({
      id,
      syncStatus,
      lineRichMenuId,
      prevActiveId,
    });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/publish] failed:', err);
    return serverError();
  }
});
