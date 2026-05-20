/**
 * PATCH /nuxt-api/drivers/me/tags
 * 司機自編 driver-scope tags（driverSkill group）— Phase 1B
 *
 * 流程：
 *   1. driver 自己更新 drivers/{lineUid}.tags = body.tags
 *   2. 驗證：每個 tag id 必須存在於 active tags、scope='driver'
 *   3. 寫 audit log driver.tags_update（payload = { before, after }，名稱快照含中文）
 *
 * 認證：require driver self（auth.roles 含 'driver'）
 *
 * Body: { tags: string[] }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import { buildTagIndex, validateDriverTags, tagIdsToNames } from '@@/utils/vehicle-profile';

interface PatchBody {
  tags?: unknown;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body || !Array.isArray(body.tags)) {
    return badRequestError({ zh_tw: '請提供 tags 陣列', en: 'tags array required', ja: 'tags 配列が必要です' });
  }

  const tags = body.tags as unknown[];
  if (!tags.every((t) => typeof t === 'string')) {
    return badRequestError({ zh_tw: 'tags 內每項需為字串', en: 'tags items must be strings', ja: 'tags の各要素は文字列が必要です' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);

    // 驗證：每個 id 必須是 scope=driver 的 active tag
    const index = await buildTagIndex(db);
    const validationErr = validateDriverTags(tags as string[], index);
    if (validationErr) {
      return badRequestError({
        zh_tw: `標籤驗證失敗：${validationErr}`,
        en: `Tag validation failed: ${validationErr}`,
        ja: `タグバリデーション失敗：${validationErr}`,
      });
    }

    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const before = (driverSnap.data()?.tags as string[] | undefined) ?? [];
    const after = tags as string[];

    await driverRef.update({ tags: after });

    await writeAuditLog({
      event,
      auth,
      action: 'driver.tags_update',
      targetType: 'driver',
      targetId: auth.lineUid,
      payload: {
        before,
        after,
        beforeNames: tagIdsToNames(before, index),
        afterNames: tagIdsToNames(after, index),
      },
    });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[drivers/me/tags.patch] failed:', err);
    return serverError();
  }
});
