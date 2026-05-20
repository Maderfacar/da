// 車輛 Profile 輸入驗證純函式（前後端共用）
//
// Phase 1B：driver 端送出 vehicleProfile 草稿 / 送審 / admin 審核。
// 本檔只做「形狀」+「群組互斥」驗證；tag id 是否存在 / scope 是否符合
// 由 server 端 vehicle-profile.ts 對 tags collection 查詢比對（避免 shared 層 import firebase）。

import { TAG_GROUPS, type TagGroup, type TagScope } from './tagTaxonomy';

export type VehicleProfileStatus = 'draft' | 'pending_review' | 'rejected';

export interface VehicleProfileInput {
  photos?: unknown;
  tags?: unknown;
}

export type VehicleProfileValidationCode =
  | 'required'
  | 'invalid'
  | 'too_many'
  | 'mismatch'
  | 'mutex_violation';

export interface VehicleProfileValidationError {
  field: string;
  code: VehicleProfileValidationCode;
}

export interface TagIndexLookupEntry {
  group: TagGroup;
  scope: TagScope;
}

export interface ValidateVehicleProfileOptions {
  /** tag id → { group, scope } 映射（server 端從 tags collection 查得後注入） */
  tagIndex?: ReadonlyMap<string, TagIndexLookupEntry>;
}

export const MAX_PHOTOS = 8;

/**
 * 驗證 vehicle profile 輸入。
 *
 * - photos：陣列，長度 <= 8；每項非空字串
 * - tags：陣列；每項非空字串
 *   - 若提供 tagIndex：每個 id 必須存在、scope 必須為 'vehicle'、
 *     不可有兩個同屬 multiplicity='single' group 的 tag id（mutex_violation）
 */
export function validateVehicleProfileShape(
  input: VehicleProfileInput,
  options: ValidateVehicleProfileOptions = {},
): VehicleProfileValidationError[] {
  const errors: VehicleProfileValidationError[] = [];

  // photos
  if (input.photos !== undefined) {
    if (!Array.isArray(input.photos)) {
      errors.push({ field: 'photos', code: 'invalid' });
    } else {
      if (input.photos.length > MAX_PHOTOS) {
        errors.push({ field: 'photos', code: 'too_many' });
      }
      input.photos.forEach((p, idx) => {
        if (typeof p !== 'string' || p.trim().length === 0) {
          errors.push({ field: `photos[${idx}]`, code: 'invalid' });
        }
      });
    }
  }

  // tags
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      errors.push({ field: 'tags', code: 'invalid' });
    } else {
      const tags = input.tags;
      const tagIndex = options.tagIndex;
      const singleGroupSeen = new Map<TagGroup, string>();

      tags.forEach((t, idx) => {
        if (typeof t !== 'string' || t.trim().length === 0) {
          errors.push({ field: `tags[${idx}]`, code: 'invalid' });
          return;
        }
        if (!tagIndex) return;
        const entry = tagIndex.get(t);
        if (!entry) {
          errors.push({ field: `tags[${idx}]`, code: 'invalid' });
          return;
        }
        if (entry.scope !== 'vehicle') {
          errors.push({ field: `tags[${idx}]`, code: 'mismatch' });
          return;
        }
        const meta = TAG_GROUPS[entry.group];
        if (meta?.multiplicity === 'single') {
          const prev = singleGroupSeen.get(entry.group);
          if (prev && prev !== t) {
            errors.push({ field: `tags[${idx}]`, code: 'mutex_violation' });
          } else {
            singleGroupSeen.set(entry.group, t);
          }
        }
      });
    }
  }

  return errors;
}
