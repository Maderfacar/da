/**
 * Order preferences server-side helpers（Phase 1D）
 *
 * - 載 active tags 組 FullTagDocForSnapshot map
 * - 整合 shared validateOrderPreferencesShape + buildPreferencesSnapshot
 * - 失敗（mutex / 空 id / 非陣列）由呼叫方轉成 badRequestError；
 *   invalid id（不存在 / archived / scope!==vehicle）會被 silently 過濾（不報錯）
 */
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  validateOrderPreferencesShape,
  buildPreferencesSnapshot,
  type OrderPreferencesInput,
  type OrderPreferencesValidationError,
  type OrderPreferencesSnapshot,
  type FullTagDocForSnapshot,
} from '~shared/orderPreferences';
import { buildTagSurchargeIndex, type TagSurchargeIndexEntry } from '~shared/pricing';
import type { TagGroup, TagScope } from '~shared/tagTaxonomy';
import type { TagDoc } from '@@/utils/tag';

/**
 * 從 tags collection 拉所有 active tag 並組 full snapshot index map。
 * 給 buildPreferencesSnapshot 用（含 name / sortOrder）。
 */
export async function loadActiveTagsForSnapshot(db: Firestore): Promise<Map<string, FullTagDocForSnapshot>> {
  const snap = await db.collection('tags').where('status', '==', 'active').get();
  const map = new Map<string, FullTagDocForSnapshot>();
  snap.forEach((doc) => {
    const d = doc.data() as Partial<TagDoc>;
    if (!d.group || !d.scope) return;
    map.set(doc.id, {
      id: doc.id,
      name: {
        zh_tw: d.name?.zh_tw ?? '',
        ...(d.name?.en ? { en: d.name.en } : {}),
        ...(d.name?.ja ? { ja: d.name.ja } : {}),
      },
      group: d.group as TagGroup,
      scope: d.scope as TagScope,
      surchargeAmount: typeof d.surchargeAmount === 'number' ? d.surchargeAmount : 0,
      sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 0,
      status: 'active',
    });
  });
  return map;
}

/**
 * 純 surcharge index（無 name / sortOrder）— 供 validateOrderPreferencesShape mutex 檢查。
 */
export function indexFromFullMap(
  full: ReadonlyMap<string, FullTagDocForSnapshot>,
): Map<string, TagSurchargeIndexEntry> {
  return buildTagSurchargeIndex(Array.from(full.values()).map((t) => ({
    id: t.id,
    group: t.group,
    scope: t.scope,
    surchargeAmount: t.surchargeAmount,
    status: t.status,
  })));
}

export interface ValidateAndSnapshotResult {
  errors: OrderPreferencesValidationError[];
  snapshot: OrderPreferencesSnapshot | null;
}

/**
 * 一站式：載 active tags、驗證、打 snapshot。
 * - errors 非空 → 呼叫方應回 badRequestError
 * - errors 空 + snapshot 非 null → 寫進 order doc
 */
export async function validateAndSnapshotPreferences(
  db: Firestore,
  input: OrderPreferencesInput,
): Promise<ValidateAndSnapshotResult> {
  // 無 tagIds 直接回空 snapshot（沒勾就沒勾）
  const tagIds = Array.isArray(input.tagIds) ? input.tagIds : [];
  if (tagIds.length === 0) {
    return {
      errors: [],
      snapshot: {
        tagIds: [],
        tagSnapshot: [],
        tagSurcharge: 0,
        snapshotAt: new Date().toISOString(),
      },
    };
  }

  const fullIndex = await loadActiveTagsForSnapshot(db);
  const surchargeIndex = indexFromFullMap(fullIndex);

  const errors = validateOrderPreferencesShape({ tagIds }, surchargeIndex);
  if (errors.length > 0) {
    return { errors, snapshot: null };
  }

  const snapshot = buildPreferencesSnapshot({ tagIds }, fullIndex);
  return { errors: [], snapshot };
}

/**
 * 把 snapshot 物件轉成 Firestore 寫入用的 shape（snapshotAt 改 Timestamp string —— Firestore 接受 ISO 字串 ok）。
 * 此處保留 ISO；呼叫端若需 serverTimestamp 可自行覆寫此欄位。
 */
export function snapshotForFirestore(
  s: OrderPreferencesSnapshot,
): {
  tagIds: string[];
  tagSnapshot: OrderPreferencesSnapshot['tagSnapshot'];
  tagSurcharge: number;
  snapshotAt: string;
} {
  return {
    tagIds: s.tagIds,
    tagSnapshot: s.tagSnapshot,
    tagSurcharge: s.tagSurcharge,
    snapshotAt: s.snapshotAt,
  };
}

/** 從 Firestore 讀回的 raw preferences 序列化成 DTO（Timestamp → ISO）。 */
export function serializeOrderPreferences(raw: unknown): OrderPreferencesSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.tagSnapshot) && !Array.isArray(r.tagIds)) return null;

  const _tsToIso = (v: unknown): string => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    const t = v as { toDate?: () => Date };
    return t.toDate?.()?.toISOString?.() ?? '';
  };

  return {
    tagIds: Array.isArray(r.tagIds) ? (r.tagIds as string[]) : [],
    tagSnapshot: Array.isArray(r.tagSnapshot)
      ? (r.tagSnapshot as OrderPreferencesSnapshot['tagSnapshot'])
      : [],
    tagSurcharge: typeof r.tagSurcharge === 'number' ? r.tagSurcharge : 0,
    snapshotAt: _tsToIso(r.snapshotAt),
  };
}

// re-export 給 endpoint 用
export type { OrderPreferencesSnapshot, OrderPreferencesInput };
export { Timestamp };
