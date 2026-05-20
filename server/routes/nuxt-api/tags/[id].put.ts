/**
 * PUT /nuxt-api/tags/[id]
 *
 * 更新標籤（partial update）。group 不允許改（改群組等同砍掉重建）。
 * Body: 任一 subset of { name, scope, surchargeAmount, sortOrder }
 * 權限：canManageFleet
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { TAG_GROUPS } from '~shared/tagTaxonomy';
import { validateTagInput } from '~shared/tagValidation';
import { writeTagAuditLog, type TagDoc } from '@@/utils/tag';

interface PutRes {
  id: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要車隊管理權限', en: 'canManageFleet required', ja: 'フリート管理権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: '缺少標籤 ID', en: 'Tag id required', ja: 'タグ ID が必要です' });
  }

  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  if (body.group !== undefined) {
    return badRequestError({
      zh_tw: '不允許修改 group（如需變更群組請封存後新增）',
      en: 'group cannot be changed (archive and recreate instead)',
      ja: 'グループは変更できません',
    });
  }

  const nameRaw = (body.name && typeof body.name === 'object') ? body.name as Record<string, unknown> : null;
  const input = {
    ...(nameRaw ? {
      name: {
        zh_tw: typeof nameRaw.zh_tw === 'string' ? nameRaw.zh_tw : undefined,
        en: typeof nameRaw.en === 'string' ? nameRaw.en : undefined,
        ja: typeof nameRaw.ja === 'string' ? nameRaw.ja : undefined,
      },
    } : {}),
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    surchargeAmount: typeof body.surchargeAmount === 'number' ? body.surchargeAmount : undefined,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
  };

  const errors = validateTagInput(input, { isUpdate: true });
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
    const ref = db.collection('tags').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '標籤不存在', en: 'Tag not found', ja: 'タグが見つかりません' });
    }

    const before = snap.data() as Partial<TagDoc>;

    // 若 scope 給了，必須符合既有 group
    if (input.scope !== undefined && before.group && TAG_GROUPS[before.group].scope !== input.scope) {
      return badRequestError({
        zh_tw: 'scope 與 group 不符',
        en: 'scope does not match group',
        ja: 'scope と group が一致しません',
      });
    }

    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.lineUid,
    };
    if (input.name) {
      const nextName: Record<string, string> = {};
      if (input.name.zh_tw !== undefined) nextName.zh_tw = input.name.zh_tw.trim();
      if (input.name.en !== undefined) nextName.en = input.name.en.trim();
      if (input.name.ja !== undefined) nextName.ja = input.name.ja.trim();
      // 合併既有 name 子欄位
      update.name = { ...(before.name ?? {}), ...nextName };
    }
    if (input.scope !== undefined) update.scope = input.scope;
    if (input.surchargeAmount !== undefined) update.surchargeAmount = input.surchargeAmount;
    if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;

    await ref.set(update, { merge: true });

    const beforeSnapshot: Partial<TagDoc> = {
      ...(before.name ? { name: before.name } : {}),
      ...(before.scope ? { scope: before.scope } : {}),
      ...(typeof before.surchargeAmount === 'number' ? { surchargeAmount: before.surchargeAmount } : {}),
      ...(typeof before.sortOrder === 'number' ? { sortOrder: before.sortOrder } : {}),
    };
    const afterSnapshot: Partial<TagDoc> = {
      ...(update.name ? { name: update.name as TagDoc['name'] } : {}),
      ...(input.scope !== undefined ? { scope: input.scope as TagDoc['scope'] } : {}),
      ...(input.surchargeAmount !== undefined ? { surchargeAmount: input.surchargeAmount } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    };
    await writeTagAuditLog({
      db,
      tagId: id,
      action: 'update',
      before: beforeSnapshot,
      after: afterSnapshot,
      performedBy: auth.lineUid,
    });

    return successResponse<PutRes>({ id });
  } catch (err) {
    console.error('[tags PUT] failed:', err);
    return serverError();
  }
});
