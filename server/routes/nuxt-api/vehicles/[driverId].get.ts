/**
 * GET /nuxt-api/vehicles/[driverId]
 * 車輛公開檔案頁公開資料端點 — Phase 1C
 *
 * - **無 auth 守則**：passenger / guest 皆可讀
 * - **隔離**：未驗證或不存在 driver → 404，不揭露存在
 * - 嚴守隱私：絕不 echo phone/email/verifiedBy/lineUid 完整/vehicleProfilePending
 *
 * Path param: driverId = lineUid（drivers doc id；去 line: prefix）
 * Query: ?lang=zh_tw|en|ja（可選；預設 zh_tw）
 *
 * Response shape：VehiclePublicDto（見 design §1.1）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { resignGcsUrl } from '@@/utils/signed-url';
import { TAG_GROUPS, localizedTagName, type TagGroup, type TagLang } from '~shared/tagTaxonomy';
import type { TagDoc } from '@@/utils/tag';

interface VehiclePublicTagDto {
  id: string;
  name: string;
  group: TagGroup;
  sortOrder: number;
}

interface VehiclePublicDto {
  driverDisplayName: string;
  completedOrders: number;
  driverSkillTags: VehiclePublicTagDto[];
  vehicleProfile: {
    photos: string[];
    tags: VehiclePublicTagDto[];
    verifiedAt: string;
  };
}

const VALID_LANGS = new Set<TagLang>(['zh_tw', 'en', 'ja']);

const _stripLinePrefix = (id: string): string => (id.startsWith('line:') ? id.slice(5) : id);

const _resolveLang = (raw: unknown): TagLang => {
  if (typeof raw === 'string' && VALID_LANGS.has(raw as TagLang)) return raw as TagLang;
  return 'zh_tw';
};

const _maskDriverName = (displayName: string | undefined, uid: string, lang: TagLang): string => {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed;
  const suffix = uid.slice(-4);
  if (lang === 'en') return `Driver ${suffix}`;
  if (lang === 'ja') return `ドライバー ${suffix}`;
  return `司機 ${suffix}`;
};

const _tsToIso = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const t = v as { toDate?: () => Date };
  return t.toDate?.()?.toISOString?.() ?? null;
};

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server not configured', ja: 'サーバー設定不完全' });
  }

  const rawId = getRouterParam(event, 'driverId');
  if (!rawId) {
    return notFoundError({ zh_tw: '找不到車輛', en: 'Vehicle not found', ja: '車両が見つかりません' });
  }
  const driverId = _stripLinePrefix(rawId);

  const query = getQuery(event);
  const lang = _resolveLang(query.lang);

  try {
    const { db, storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);

    const driverSnap = await db.collection('drivers').doc(driverId).get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到車輛', en: 'Vehicle not found', ja: '車両が見つかりません' });
    }
    const data = driverSnap.data() ?? {};

    const vp = data.vehicleProfile as
      | { photos?: string[]; tags?: string[]; updatedAt?: unknown }
      | null
      | undefined;
    const verifiedAtIso = _tsToIso(data.verifiedAt);

    // 隔離：未驗證 → 404（不揭露 driver 存在）
    if (!vp || !verifiedAtIso) {
      return notFoundError({ zh_tw: '找不到車輛', en: 'Vehicle not found', ja: '車両が見つかりません' });
    }

    const vehicleTagIds = Array.isArray(vp.tags) ? (vp.tags as string[]) : [];
    const driverTagIds = Array.isArray(data.tags) ? (data.tags as string[]) : [];
    const allTagIds = Array.from(new Set([...vehicleTagIds, ...driverTagIds]));

    // 批次讀 active tags（一次 query，client 端後過濾）
    const tagsSnap = await db.collection('tags').where('status', '==', 'active').get();
    const tagMap = new Map<string, { id: string; group: TagGroup; sortOrder: number; name: string }>();
    tagsSnap.forEach((doc) => {
      const d = doc.data() as Partial<TagDoc>;
      if (!d.group) return;
      if (!allTagIds.includes(doc.id)) return;
      tagMap.set(doc.id, {
        id: doc.id,
        group: d.group as TagGroup,
        sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 0,
        name: localizedTagName({ name: d.name ?? { zh_tw: '' } }, lang),
      });
    });

    // 排序 helper：group.sortOrder 升 → tag.sortOrder 升
    const sortTags = (ids: string[]): VehiclePublicTagDto[] =>
      ids
        .map((id) => tagMap.get(id))
        .filter((t): t is NonNullable<typeof t> => t !== undefined)
        .sort((a, b) => {
          const ga = TAG_GROUPS[a.group]?.sortOrder ?? 0;
          const gb = TAG_GROUPS[b.group]?.sortOrder ?? 0;
          if (ga !== gb) return ga - gb;
          return a.sortOrder - b.sortOrder;
        });

    // vehicle vs driver scope 分流（用 tag.group 對應 TAG_GROUPS.scope）
    const vehicleTagsResolved = sortTags(vehicleTagIds).filter(
      (t) => TAG_GROUPS[t.group]?.scope === 'vehicle',
    );
    const driverTagsResolved = sortTags(driverTagIds).filter(
      (t) => TAG_GROUPS[t.group]?.scope === 'driver',
    );

    // 重簽 photos（TTL 4h；非 GCS URL 直接 fallback）
    const rawPhotos = Array.isArray(vp.photos) ? (vp.photos as string[]) : [];
    const photos = await Promise.all(rawPhotos.map((u) => resignGcsUrl(storage, u)));

    const dto: VehiclePublicDto = {
      driverDisplayName: _maskDriverName(data.displayName as string | undefined, driverId, lang),
      completedOrders: typeof data.completedOrders === 'number' ? data.completedOrders : 0,
      driverSkillTags: driverTagsResolved,
      vehicleProfile: {
        photos,
        tags: vehicleTagsResolved,
        verifiedAt: verifiedAtIso,
      },
    };

    return successResponse(dto);
  } catch (err) {
    console.error('[vehicles/[driverId].get] failed:', err);
    return serverError();
  }
});
