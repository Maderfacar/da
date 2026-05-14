/**
 * POST /nuxt-api/admin/line-richmenus/[id]/publish
 *
 * Publish richmenu（複合動作；P42 改為 lang-aware）：
 *
 * 流程：
 *   1. 驗 isPublishReady（image / chatBarText / areas 都齊）
 *   2. rate-limit：publish 每 admin 每小時 ≤ 5 次（沿用 P31 rate-limit pattern）
 *   3. Firestore tx（P42 改）：
 *      - 把同 channel × 同 lang 既有 active → archived（保留 lineRichMenuId 供 rollback 用）
 *      - 把本 menu status='active'、publishedAt=now、syncStatus='syncing'
 *   4. LINE API 呼叫：
 *      - 若 lineRichMenuId 為 null → POST /richmenu（建立框架）+ POST /content（上傳圖）
 *      - **lang='zh_tw' 才** POST /user/all/richmenu/{id}（設預設給未綁定 / 未知 lang user 看）
 *   5. P42：對既有 user batch re-bind（users where lang == publishedLang limit 100；超量 throw）
 *   6. 成功：syncStatus='synced' + lineRichMenuId 寫回；失敗：syncStatus='sync_failed' + syncError
 *
 * 副作用：audit log `line.richmenu.publish`（含 lang + rebindStats）
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
  linkRichmenuToUser,
  LineApiError,
} from '@@/utils/line-richmenu';

/** P42：publish 後對既有 user batch re-bind 的硬上限（超過 → throw 並警示需 cron job，P50+ 範圍） */
const REBIND_USER_LIMIT = 100;
/** 每次 linkRichmenuToUser 後 sleep 毫秒（避免 LINE rate limit；100ms × 100 user = 10s 總時長） */
const REBIND_THROTTLE_MS = 100;
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

    // ── 3. Firestore tx：archive 同 channel × 同 lang 既有 active + mark 本 menu 'syncing' ────
    let prevActiveId: string | null = null;
    let prevActiveLineId: string | null = null;
    await db.runTransaction(async (tx) => {
      const prevQuery = await tx.get(
        db.collection('line_richmenus')
          .where('channel', '==', existing.channel)
          .where('lang', '==', existing.lang)
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
      // P42：只在 lang='zh_tw' 才設為全 user default（其他 lang user 透過 PATCH /api/self/lang 或 follow event 個別綁定）
      if (existing.lang === 'zh_tw') {
        await setDefaultRichmenu(existing.channel, lineRichMenuId);
      }
    } catch (err) {
      syncStatus = 'sync_failed';
      if (err instanceof LineApiError) {
        syncError = `[${err.statusCode}] ${err.message}`;
      } else {
        syncError = (err as Error).message ?? 'Unknown';
      }
      console.error('[admin/line-richmenus/[id]/publish] LINE sync failed:', err);
    }

    // ── 5. P42：對既有 user batch re-bind（撈 users where lang == publishedLang）──
    // 只在 syncStatus='synced' 時跑（同步失敗時 lineRichMenuId 可能無效，重綁無意義）
    const rebindStats: {
      total: number;
      success: number;
      failed: number;
      limitExceeded: boolean;
      errors: Array<{ lineUid: string; error: string }>;
    } = { total: 0, success: 0, failed: 0, limitExceeded: false, errors: [] };

    if (syncStatus === 'synced' && lineRichMenuId) {
      try {
        // limit + 1 用來偵測「超出上限」場景（撈 101 個 → 知道 ≥ 101）
        const usersSnap = await db.collection('users')
          .where('lang', '==', existing.lang)
          .limit(REBIND_USER_LIMIT + 1)
          .get();

        if (usersSnap.size > REBIND_USER_LIMIT) {
          rebindStats.total = REBIND_USER_LIMIT;
          rebindStats.limitExceeded = true;
          console.warn(`[publish] re-bind skipped: user count for lang=${existing.lang} > ${REBIND_USER_LIMIT}; needs cron job (P50+)`);
        } else {
          rebindStats.total = usersSnap.size;
          for (const userDoc of usersSnap.docs) {
            const lineUid = userDoc.id;
            try {
              await linkRichmenuToUser(existing.channel, lineUid, lineRichMenuId);
              rebindStats.success += 1;
            } catch (err) {
              rebindStats.failed += 1;
              const msg = err instanceof LineApiError
                ? `[${err.statusCode}] ${err.message}`
                : ((err as Error).message ?? 'Unknown');
              // 只記前 10 個 error（避免 audit log payload 過大）
              if (rebindStats.errors.length < 10) {
                rebindStats.errors.push({ lineUid, error: msg });
              }
            }
            await _sleep(REBIND_THROTTLE_MS);
          }
        }
      } catch (err) {
        console.error('[publish] re-bind batch failed:', err);
      }
    }

    // ── 6. 寫回最終狀態 ────────────────────────────────────
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
        lang: existing.lang,
        prevActiveId,
        prevActiveLineId,
        newLineRichMenuId: lineRichMenuId,
        syncStatus,
        syncError,
        rebindStats,
      },
    });

    if (rebindStats.limitExceeded) {
      return {
        data: { id, syncStatus, lineRichMenuId, prevActiveId, rebindStats },
        status: {
          code: 502,
          message: {
            zh_tw: `已發佈成功；但對應 lang user 數超過 ${REBIND_USER_LIMIT}，未自動 re-bind（需 cron job 批次，P50+ 範圍）`,
            en: `Published OK, but user count for this lang exceeded ${REBIND_USER_LIMIT}; batch re-bind requires cron job (P50+)`,
            ja: `発佈成功、しかし該当 lang user 数が ${REBIND_USER_LIMIT} を超えたため自動 re-bind なし（cron job が必要）`,
          },
        },
      };
    }

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
      rebindStats,
    });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/publish] failed:', err);
    return serverError();
  }
});
