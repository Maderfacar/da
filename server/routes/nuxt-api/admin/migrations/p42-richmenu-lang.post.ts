/**
 * POST /nuxt-api/admin/migrations/p42-richmenu-lang
 *
 * P42 一次性 migration：把所有 line_richmenus doc 內 lang 為 null / undefined / 非合法值的
 * grandfather 為 'zh_tw'（Q7=7a 拍板）。
 *
 * - 冪等：已有合法 lang 的 doc 不動
 * - dry-run mode（`?dryRun=1` 或 body.dryRun=true）：列出影響 doc 但不寫入
 * - 一次跑完所有 doc（不分批，line_richmenus 文件數不多）
 *
 * 權限：**super only**（一次性 ops 任務）
 *
 * 副作用：audit log `line.richmenu.migrate.lang`（含 affected ids + dryRun flag）
 *
 * Response：
 *   { dryRun, total, affected, skipped, ids: { affected: string[], skipped: string[] } }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  RICHMENU_VALID_LANGS,
  type LineRichmenuDoc,
} from '@@/utils/line-richmenu-doc';

interface PostBody {
  dryRun?: boolean;
}

const FALLBACK_LANG = 'zh_tw' as const;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (auth.level !== 'super') {
    return forbiddenError({ zh_tw: '需要 super 管理員權限', en: 'super only', ja: 'super 権限が必要' });
  }

  const query = getQuery(event);
  const body = await readBody<PostBody>(event).catch(() => ({} as PostBody));
  const dryRun = body?.dryRun === true || query.dryRun === '1' || query.dryRun === 'true';

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('line_richmenus').get();

    const affectedIds: string[] = [];
    const skippedIds: string[] = [];
    const validLangs = RICHMENU_VALID_LANGS as readonly string[];

    snap.docs.forEach((doc) => {
      const data = doc.data() as Partial<LineRichmenuDoc>;
      const currentLang = data.lang;
      const needsFix = typeof currentLang !== 'string' || !validLangs.includes(currentLang);
      if (needsFix) {
        affectedIds.push(doc.id);
      } else {
        skippedIds.push(doc.id);
      }
    });

    if (!dryRun && affectedIds.length > 0) {
      // 分批 batch write（Firestore batch limit 500；line_richmenus 預期 <100 doc 一個 batch 夠）
      const batch = db.batch();
      affectedIds.forEach((id) => {
        const ref = db.collection('line_richmenus').doc(id);
        batch.update(ref, {
          lang: FALLBACK_LANG,
          updatedBy: auth.lineUid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.migrate.lang',
      targetType: 'line_richmenu',
      targetId: 'p42-batch',
      payload: {
        dryRun,
        total: snap.size,
        affectedCount: affectedIds.length,
        skippedCount: skippedIds.length,
        affectedIds: affectedIds.slice(0, 50),  // payload 限制 50 個避免過大
      },
    });

    return successResponse({
      dryRun,
      total: snap.size,
      affected: affectedIds.length,
      skipped: skippedIds.length,
      ids: {
        affected: affectedIds,
        skipped: skippedIds,
      },
    });
  } catch (err) {
    console.error('[admin/migrations/p42-richmenu-lang] failed:', err);
    return serverError();
  }
});
