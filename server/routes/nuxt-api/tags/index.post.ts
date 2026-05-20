/**
 * POST /nuxt-api/tags
 *
 * 建立標籤。sortOrder 未指定時自動取同 group max+1。
 * Body: { name: { zh_tw, en?, ja? }, group, scope, surchargeAmount, sortOrder? }
 * 權限：canManageFleet
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { TAG_GROUPS, type TagGroup, type TagScope } from '~shared/tagTaxonomy';
import { validateTagInput } from '~shared/tagValidation';
import { getNextSortOrderForGroup, writeTagAuditLog, type TagDoc } from '@@/utils/tag';

interface PostRes {
  id: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要車隊管理權限', en: 'canManageFleet required', ja: 'フリート管理権限が必要です' });
  }

  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const nameRaw = (body.name && typeof body.name === 'object') ? body.name as Record<string, unknown> : {};
  const input = {
    name: {
      zh_tw: typeof nameRaw.zh_tw === 'string' ? nameRaw.zh_tw : undefined,
      en: typeof nameRaw.en === 'string' ? nameRaw.en : undefined,
      ja: typeof nameRaw.ja === 'string' ? nameRaw.ja : undefined,
    },
    group: typeof body.group === 'string' ? body.group : undefined,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    surchargeAmount: typeof body.surchargeAmount === 'number' ? body.surchargeAmount : undefined,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
  };

  const errors = validateTagInput(input);
  if (errors.length > 0) {
    const summary = errors.map((e) => `${e.field}:${e.code}`).join(', ');
    return badRequestError({
      zh_tw: `欄位驗證失敗：${summary}`,
      en: `Validation failed: ${summary}`,
      ja: `バリデーションエラー：${summary}`,
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const group = input.group as TagGroup;
    const scope = input.scope as TagScope;

    // scope 與 group 已通過 validation，但保險再次比對 TAG_GROUPS 常數
    if (TAG_GROUPS[group].scope !== scope) {
      return badRequestError({
        zh_tw: 'scope 與 group 不符',
        en: 'scope does not match group',
        ja: 'scope と group が一致しません',
      });
    }

    const sortOrder = input.sortOrder ?? await getNextSortOrderForGroup(db, group);

    const docRef = db.collection('tags').doc();
    const after: Omit<TagDoc, 'createdAt' | 'updatedAt'> & {
      createdAt: FirebaseFirestore.FieldValue;
      updatedAt: FirebaseFirestore.FieldValue;
    } = {
      name: {
        zh_tw: input.name.zh_tw!.trim(),
        ...(input.name.en?.trim() ? { en: input.name.en.trim() } : {}),
        ...(input.name.ja?.trim() ? { ja: input.name.ja.trim() } : {}),
      },
      group,
      scope,
      surchargeAmount: input.surchargeAmount ?? 0,
      status: 'active',
      sortOrder,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.lineUid,
    };
    await docRef.set(after);

    await writeTagAuditLog({
      db,
      tagId: docRef.id,
      action: 'create',
      before: null,
      after: {
        name: after.name,
        group,
        scope,
        surchargeAmount: after.surchargeAmount,
        status: 'active',
        sortOrder,
      },
      performedBy: auth.lineUid,
    });

    return successResponse<PostRes>({ id: docRef.id });
  } catch (err) {
    console.error('[tags POST] failed:', err);
    return serverError();
  }
});
