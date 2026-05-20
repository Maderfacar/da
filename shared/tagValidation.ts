// 標籤輸入驗證純函式（前後端共用）
//
// 規則：
// - name.zh_tw：required（create 時），trim 後非空，<= 32 字
// - name.en / name.ja：optional，<= 32 字
// - group：必須是 TAG_GROUPS 的 key
// - scope：必須符合 TAG_GROUPS[group].scope
// - surchargeAmount：>= 0
// - sortOrder：integer 或 undefined

import { TAG_GROUPS, type TagGroup, type TagScope } from './tagTaxonomy';

export interface TagInput {
  name?: { zh_tw?: string; en?: string; ja?: string };
  group?: string;
  scope?: string;
  surchargeAmount?: number;
  sortOrder?: number;
}

export type TagValidationCode = 'required' | 'invalid' | 'mismatch' | 'negative' | 'too_long';

export interface TagValidationError {
  field: string;
  code: TagValidationCode;
}

export interface ValidateTagOptions {
  /** update 模式：缺 required 欄位不報錯（partial update 允許僅給部分欄位） */
  isUpdate?: boolean;
}

const NAME_MAX_LEN = 32;

const isValidGroup = (g: unknown): g is TagGroup =>
  typeof g === 'string' && Object.prototype.hasOwnProperty.call(TAG_GROUPS, g);

const isValidScope = (s: unknown): s is TagScope => s === 'driver' || s === 'vehicle';

export function validateTagInput(input: TagInput, options: ValidateTagOptions = {}): TagValidationError[] {
  const errors: TagValidationError[] = [];
  const isUpdate = options.isUpdate === true;

  // name.zh_tw
  const zhRaw = input.name?.zh_tw;
  if (typeof zhRaw === 'string') {
    const trimmed = zhRaw.trim();
    if (trimmed.length === 0) {
      errors.push({ field: 'name.zh_tw', code: 'required' });
    } else if (trimmed.length > NAME_MAX_LEN) {
      errors.push({ field: 'name.zh_tw', code: 'too_long' });
    }
  } else if (!isUpdate) {
    errors.push({ field: 'name.zh_tw', code: 'required' });
  }

  // name.en / name.ja（optional；只檢長度）
  for (const lang of ['en', 'ja'] as const) {
    const v = input.name?.[lang];
    if (typeof v === 'string' && v.trim().length > NAME_MAX_LEN) {
      errors.push({ field: `name.${lang}`, code: 'too_long' });
    }
  }

  // group
  let resolvedGroup: TagGroup | null = null;
  if (input.group !== undefined) {
    if (isValidGroup(input.group)) {
      resolvedGroup = input.group;
    } else {
      errors.push({ field: 'group', code: 'invalid' });
    }
  } else if (!isUpdate) {
    errors.push({ field: 'group', code: 'required' });
  }

  // scope（必須與 group 對應）
  if (input.scope !== undefined) {
    if (!isValidScope(input.scope)) {
      errors.push({ field: 'scope', code: 'invalid' });
    } else if (resolvedGroup && TAG_GROUPS[resolvedGroup].scope !== input.scope) {
      errors.push({ field: 'scope', code: 'mismatch' });
    }
  } else if (!isUpdate) {
    errors.push({ field: 'scope', code: 'required' });
  }

  // surchargeAmount
  if (input.surchargeAmount !== undefined) {
    if (typeof input.surchargeAmount !== 'number' || Number.isNaN(input.surchargeAmount)) {
      errors.push({ field: 'surchargeAmount', code: 'invalid' });
    } else if (input.surchargeAmount < 0) {
      errors.push({ field: 'surchargeAmount', code: 'negative' });
    }
  } else if (!isUpdate) {
    errors.push({ field: 'surchargeAmount', code: 'required' });
  }

  // sortOrder（optional 都通用）
  if (input.sortOrder !== undefined) {
    if (
      typeof input.sortOrder !== 'number'
      || Number.isNaN(input.sortOrder)
      || !Number.isInteger(input.sortOrder)
      || input.sortOrder < 0
    ) {
      errors.push({ field: 'sortOrder', code: 'invalid' });
    }
  }

  return errors;
}
