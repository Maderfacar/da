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
  RICHMENU_VALID_LANGS,
  type LineRichmenuDoc,
} from '@@/utils/line-richmenu-doc';
import type { Lang } from '@@/utils/i18n-message';

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
      /** P42：每 doc 一個 lang；grandfather 後永遠是 zh_tw / en / ja */
      lang: Lang;
    }
    const docs: LocalDoc[] = snap.docs.map((d) => {
      const data = d.data() as LineRichmenuDoc;
      // grandfather safety: 萬一還有 doc 沒跑過 migration → fallback zh_tw
      const rawLang = data.lang as Lang | undefined;
      const safeLang: Lang = rawLang && (RICHMENU_VALID_LANGS as readonly string[]).includes(rawLang)
        ? rawLang
        : 'zh_tw';
      return {
        id: d.id,
        name: data.name ?? '',
        status: data.status,
        lineRichMenuId: data.lineRichMenuId ?? null,
        lang: safeLang,
      };
    });
    // P42 既有 active 邏輯：以 zh_tw active 為 channel-level「LINE default 對齊基準」
    // （非 zh_tw lang 的 active 由 per-user binding 處理；不參與 LINE default 對齊）
    const activeDoc =
      docs.find((d) => d.status === 'active' && d.lang === 'zh_tw') ?? null;

    // P42：byLang dimension（各 lang 獨立統計，前端 grid 顯示用）
    const byLang: Record<Lang, { activeDoc: LocalDoc | null; docs: LocalDoc[] }> = {
      zh_tw: { activeDoc: null, docs: [] },
      en: { activeDoc: null, docs: [] },
      ja: { activeDoc: null, docs: [] },
    };
    docs.forEach((d) => {
      byLang[d.lang].docs.push(d);
      if (d.status === 'active' && !byLang[d.lang].activeDoc) {
        byLang[d.lang].activeDoc = d;
      }
    });
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
      byLang,
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
