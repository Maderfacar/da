/**
 * GET /nuxt-api/admin/line-richmenus/sync-overview
 *
 * P40 Phase 3：Diagnostics MVP — 對單 channel 撈本地 doc + LINE listRichmenus / getDefaultRichmenuId
 * 比對一致性，提供 admin Diagnostics tab dashboard 用。
 *
 * Query:
 *   channel: 'passenger' | 'driver'（必填）
 *
 * 回傳:
 *   {
 *     local: {
 *       activeDoc: { id, name, lineRichMenuId } | null,
 *       docs: Array<{ id, name, status, lineRichMenuId }>,  // 所有本地 doc（admin 查狀態用）
 *     },
 *     line: {
 *       defaultRichMenuId: string | null,
 *       allMenus: Array<{ richMenuId, name, size, hasLocalDoc, isDefault }>,
 *     },
 *     match: boolean,           // 本地 active doc 與 LINE default 一致
 *     inconsistencies: string[],
 *     orphans: Array<{ richMenuId, name }>,  // LINE 端有但本地無 doc
 *     stale: Array<{ docId, lineRichMenuId, name }>,  // 本地有但 LINE 端不存在
 *     queryError: string | null,
 *   }
 *
 * 不寫 audit log（純查詢）
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  getDefaultRichmenuId,
  listRichmenus,
  LineApiError,
} from '@@/utils/line-richmenu';
import {
  validateChannel,
  type LineRichmenuDoc,
} from '@@/utils/line-richmenu-doc';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({
      zh_tw: '需要廣播權限',
      en: 'canBroadcast required',
      ja: 'ブロードキャスト権限が必要です',
    });
  }

  const channelRes = validateChannel(getQuery(event).channel);
  if (!channelRes.ok) {
    return badRequestError({
      zh_tw: channelRes.error,
      en: 'channel must be passenger or driver',
      ja: 'channel は passenger または driver',
    });
  }
  const channel = channelRes.value;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db
      .collection('line_richmenus')
      .where('channel', '==', channel)
      .get();

    interface LocalDoc {
      id: string;
      name: string;
      status: LineRichmenuDoc['status'];
      lineRichMenuId: string | null;
    }
    const docs: LocalDoc[] = snap.docs.map((d) => {
      const data = d.data() as LineRichmenuDoc;
      return {
        id: d.id,
        name: data.name ?? '',
        status: data.status,
        lineRichMenuId: data.lineRichMenuId ?? null,
      };
    });
    const activeDoc = docs.find((d) => d.status === 'active') ?? null;
    const localLineIds = new Set(
      docs.filter((d) => d.lineRichMenuId).map((d) => d.lineRichMenuId as string),
    );

    let defaultRichMenuId: string | null = null;
    let lineMenus: Array<{ richMenuId: string; name: string; size: { width: number; height: number } }> = [];
    let queryError: string | null = null;
    try {
      defaultRichMenuId = await getDefaultRichmenuId(channel);
      const remotes = await listRichmenus(channel);
      lineMenus = remotes.map((r) => ({
        richMenuId: r.richMenuId,
        name: r.name,
        size: r.size,
      }));
    } catch (err) {
      queryError = err instanceof LineApiError
        ? `[${err.statusCode}] ${err.message}`
        : ((err as Error).message ?? 'Unknown LINE API error');
      console.error('[admin/line-richmenus/sync-overview] LINE query failed:', err);
    }

    const lineMenuIdSet = new Set(lineMenus.map((m) => m.richMenuId));

    const allMenus = lineMenus.map((m) => ({
      richMenuId: m.richMenuId,
      name: m.name,
      size: m.size,
      hasLocalDoc: localLineIds.has(m.richMenuId),
      isDefault: m.richMenuId === defaultRichMenuId,
    }));

    const orphans = allMenus
      .filter((m) => !m.hasLocalDoc)
      .map((m) => ({ richMenuId: m.richMenuId, name: m.name }));

    const stale = docs
      .filter((d) =>
        d.lineRichMenuId
        && d.status !== 'draft'
        && !lineMenuIdSet.has(d.lineRichMenuId),
      )
      .map((d) => ({
        docId: d.id,
        lineRichMenuId: d.lineRichMenuId as string,
        name: d.name,
      }));

    const match =
      !queryError
      && (activeDoc === null
        ? defaultRichMenuId === null
        : !!activeDoc.lineRichMenuId && activeDoc.lineRichMenuId === defaultRichMenuId);

    const inconsistencies: string[] = [];
    if (queryError) {
      inconsistencies.push(`LINE API 查詢失敗：${queryError}`);
    } else {
      if (activeDoc && (!activeDoc.lineRichMenuId || activeDoc.lineRichMenuId !== defaultRichMenuId)) {
        inconsistencies.push(
          `本地 active doc「${activeDoc.name}」(lineRichMenuId=${activeDoc.lineRichMenuId ?? '無'}) 與 LINE default (${defaultRichMenuId ?? '無'}) 不一致`,
        );
      }
      if (!activeDoc && defaultRichMenuId) {
        inconsistencies.push(`本地無 active doc，但 LINE 端仍有 default 選單 (${defaultRichMenuId})`);
      }
      if (orphans.length > 0) {
        inconsistencies.push(`LINE 端有 ${orphans.length} 個孤兒選單（本地無對應 doc）`);
      }
      if (stale.length > 0) {
        inconsistencies.push(`本地有 ${stale.length} 個 doc 記錄 lineRichMenuId 但 LINE 端不存在（stale）`);
      }
    }

    return successResponse({
      local: { activeDoc, docs },
      line: { defaultRichMenuId, allMenus },
      match,
      inconsistencies,
      orphans,
      stale,
      queryError,
    });
  } catch (err) {
    console.error('[admin/line-richmenus/sync-overview] failed:', err);
    return serverError();
  }
});
