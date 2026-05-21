// 訂單偏好標籤 snapshot 與驗證（前後端共用）— Phase 1D
//
// 設計重點：
//   - server 寫單時把命中標籤的「id + name + surchargeAmount + group + sortOrder」固化進 order doc
//   - 即使日後 admin 改 tag.surchargeAmount 或封存 tag，舊單顯示仍維持寫單瞬間
//   - mutex 檢查（single multiplicity group 不可選 2+ 個）在 shared 層做形狀驗證
//   - 取 max（不取 sum）邏輯沿用 pricing.ts `calcTagSurcharge`

import { TAG_GROUPS, type TagGroup } from './tagTaxonomy';
import {
  calcTagSurcharge,
  buildTagSurchargeIndex,
  type TagSurchargeIndexEntry,
} from './pricing';

export interface OrderPreferenceTagSnapshot {
  id: string;
  /** 三語名稱完整 snapshot（缺者欄位省略，前端 fallback 繁中） */
  name: { zh_tw: string; en?: string; ja?: string };
  group: TagGroup;
  /** 寫單時的加價金額（鎖定，往後 admin 改 surchargeAmount 不影響舊單） */
  surchargeAmount: number;
  sortOrder: number;
}

export interface OrderPreferencesSnapshot {
  /** 乘客原始勾選的 tagId 陣列（含 invalid 也保留，便於除錯／配對 fallback） */
  tagIds: string[];
  /** 解析後的標籤 snapshot（不含 invalid） */
  tagSnapshot: OrderPreferenceTagSnapshot[];
  /** max(snapshot.surchargeAmount)；無命中為 0 */
  tagSurcharge: number;
  /** 寫單瞬間 ISO timestamp（server 端 serverTimestamp 寫入時為 placeholder；client 用作 fallback） */
  snapshotAt: string;
}

export interface OrderPreferencesInput {
  tagIds?: ReadonlyArray<string>;
}

export type OrderPreferencesValidationCode = 'invalid' | 'mutex_violation';

export interface OrderPreferencesValidationError {
  field: string;
  code: OrderPreferencesValidationCode;
}

/** 給 buildPreferencesSnapshot 用的「完整 tag doc 子集」型別 */
export interface FullTagDocForSnapshot extends TagSurchargeIndexEntry {
  name: { zh_tw: string; en?: string; ja?: string };
  sortOrder: number;
}

/**
 * 形狀 + mutex 驗證。
 * 不檢 invalid id（交給 calcTagSurcharge 處理；server 端可選擇是否要硬性拒絕）。
 */
export function validateOrderPreferencesShape(
  input: OrderPreferencesInput,
  tagIndex: ReadonlyMap<string, TagSurchargeIndexEntry>,
): OrderPreferencesValidationError[] {
  const errors: OrderPreferencesValidationError[] = [];
  const tagIds = input.tagIds ?? [];
  if (!Array.isArray(tagIds)) {
    errors.push({ field: 'tagIds', code: 'invalid' });
    return errors;
  }

  const singleGroupSeen = new Map<TagGroup, string>();
  tagIds.forEach((id, idx) => {
    if (typeof id !== 'string' || id.length === 0) {
      errors.push({ field: `tagIds[${idx}]`, code: 'invalid' });
      return;
    }
    const entry = tagIndex.get(id);
    if (!entry) return; // 不存在 → 不算 mutex 錯誤；由 calcTagSurcharge 列入 invalid
    if (entry.scope !== 'vehicle') return;
    const meta = TAG_GROUPS[entry.group];
    if (meta?.multiplicity === 'single') {
      const prev = singleGroupSeen.get(entry.group);
      if (prev && prev !== id) {
        errors.push({ field: `tagIds[${idx}]`, code: 'mutex_violation' });
      } else {
        singleGroupSeen.set(entry.group, id);
      }
    }
  });

  return errors;
}

/**
 * 寫單瞬間打 snapshot。
 *
 * - 過濾 invalid（archived / scope!==vehicle / 不存在）但保留 input.tagIds 原值
 * - tagSnapshot 依 group.sortOrder → tag.sortOrder 升序
 * - tagSurcharge = max(snapshot.surchargeAmount)；無命中為 0
 */
export function buildPreferencesSnapshot(
  input: OrderPreferencesInput,
  tagIndex: ReadonlyMap<string, FullTagDocForSnapshot>,
): OrderPreferencesSnapshot {
  const tagIds = Array.isArray(input.tagIds) ? Array.from(input.tagIds) : [];

  const calc = calcTagSurcharge(tagIds, tagIndex);
  const tagSnapshot: OrderPreferenceTagSnapshot[] = calc.matchedTagIds
    .map((id) => {
      const entry = tagIndex.get(id);
      if (!entry) return null;
      return {
        id: entry.id,
        name: {
          zh_tw: entry.name.zh_tw,
          ...(entry.name.en ? { en: entry.name.en } : {}),
          ...(entry.name.ja ? { ja: entry.name.ja } : {}),
        },
        group: entry.group,
        surchargeAmount: entry.surchargeAmount,
        sortOrder: entry.sortOrder,
      };
    })
    .filter((s): s is OrderPreferenceTagSnapshot => s !== null)
    .sort((a, b) => {
      const ga = TAG_GROUPS[a.group]?.sortOrder ?? 0;
      const gb = TAG_GROUPS[b.group]?.sortOrder ?? 0;
      if (ga !== gb) return ga - gb;
      return a.sortOrder - b.sortOrder;
    });

  return {
    tagIds,
    tagSnapshot,
    tagSurcharge: calc.surcharge,
    snapshotAt: new Date().toISOString(),
  };
}

// 方便 server 端使用：直接從 active tag DTO 陣列 build index map
export { buildTagSurchargeIndex };
