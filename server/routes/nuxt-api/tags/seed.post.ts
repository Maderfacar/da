/**
 * POST /nuxt-api/tags/seed
 *
 * Idempotent — 已有任何 tag doc 時 return { seeded: 0 }；否則 batch 寫入預設種子。
 * 權限：canManageFleet
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { TAG_SEEDS, TAG_GROUPS, type TagGroup } from '~shared/tagTaxonomy';

interface SeedRes {
  seeded: number;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要車隊管理權限', en: 'canManageFleet required', ja: 'フリート管理権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const probe = await db.collection('tags').limit(1).get();
    if (!probe.empty) {
      return successResponse<SeedRes>({ seeded: 0 });
    }

    const batch = db.batch();
    const orderByGroup = new Map<TagGroup, number>();
    (Object.keys(TAG_GROUPS) as TagGroup[]).forEach((g) => orderByGroup.set(g, 0));

    for (const seed of TAG_SEEDS) {
      const cur = (orderByGroup.get(seed.group) ?? 0) + 1;
      orderByGroup.set(seed.group, cur);

      const tagRef = db.collection('tags').doc();
      const after = {
        name: seed.name,
        group: seed.group,
        scope: seed.scope,
        surchargeAmount: 0,
        status: 'active' as const,
        sortOrder: cur,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: auth.lineUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.lineUid,
      };
      batch.set(tagRef, after);

      const logRef = db.collection('tag_audit_logs').doc();
      batch.set(logRef, {
        tagId: tagRef.id,
        action: 'create',
        beforeSnapshot: null,
        afterSnapshot: {
          name: seed.name,
          group: seed.group,
          scope: seed.scope,
          surchargeAmount: 0,
          status: 'active',
          sortOrder: cur,
        },
        performedBy: auth.lineUid,
        performedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    return successResponse<SeedRes>({ seeded: TAG_SEEDS.length });
  } catch (err) {
    console.error('[tags seed] failed:', err);
    return serverError();
  }
});
