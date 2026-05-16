/**
 * 折扣碼（陽春版）— 型別、DTO、驗證邏輯共用 util
 *
 * 設計：openspec/changes/2026-05-16-discount-codes/design.md
 *
 * 三層責任：
 *   - 型別 / DTO / admin 輸入驗證器（本段）
 *   - evaluateDiscountCode：純評估函式（Task 3，可單元測試）
 *   - validateDiscountCode / redeemDiscountCode：Firestore 包裝層（Task 4）
 *
 * collection `discount_codes/{code}`，doc id = 大寫折扣碼字串。
 * client 全禁讀寫（firestore.rules）；一律經 server admin SDK。
 */
import type { Timestamp } from 'firebase-admin/firestore';
import { ORDER_TYPES } from '~shared/pricing';

export interface I18nMsg {
  zh_tw: string;
  en: string;
  ja: string;
}

/** 折扣碼格式：3-32 碼大寫英數（doc id 用） */
export const DISCOUNT_CODE_REGEX = /^[A-Z0-9]{3,32}$/;

/** 合法的行程類型值集合（取自 ORDER_TYPES） */
const ORDER_TYPE_VALUES = new Set<string>(ORDER_TYPES.map((t) => t.value));

// ── Firestore Doc ────────────────────────────────────────────────

export interface DiscountCodeDoc {
  code: string;
  discountAmount: number;
  validFrom: Timestamp | null;
  validUntil: Timestamp;
  maxRedemptions: number | null;
  perUserLimit: number | null;
  minFare: number | null;
  allowedOrderTypes: string[] | null;
  enabled: boolean;
  redemptionCount: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
}

// ── DTO（API 回傳：Timestamp → ISO string）────────────────────────

export interface DiscountCodeDto {
  code: string;
  discountAmount: number;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  perUserLimit: number | null;
  minFare: number | null;
  allowedOrderTypes: string[] | null;
  enabled: boolean;
  redemptionCount: number;
  createdBy: string;
  createdAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
}

function tsToIso(v: unknown): string | null {
  const d = (v as { toDate?: () => Date } | null)?.toDate?.();
  return d ? d.toISOString() : null;
}

export function toDiscountCodeDto(data: Partial<DiscountCodeDoc> & { code: string }): DiscountCodeDto {
  return {
    code: data.code,
    discountAmount: typeof data.discountAmount === 'number' ? data.discountAmount : 0,
    validFrom: tsToIso(data.validFrom),
    validUntil: tsToIso(data.validUntil),
    maxRedemptions: typeof data.maxRedemptions === 'number' ? data.maxRedemptions : null,
    perUserLimit: typeof data.perUserLimit === 'number' ? data.perUserLimit : null,
    minFare: typeof data.minFare === 'number' ? data.minFare : null,
    allowedOrderTypes: Array.isArray(data.allowedOrderTypes) ? data.allowedOrderTypes : null,
    enabled: data.enabled === true,
    redemptionCount: typeof data.redemptionCount === 'number' ? data.redemptionCount : 0,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    createdAt: tsToIso(data.createdAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
    updatedAt: tsToIso(data.updatedAt),
  };
}

// ── admin 輸入驗證器 ──────────────────────────────────────────────

/** 驗證通過後的正規化欄位（validFrom/validUntil 轉成 epoch ms 供寫入時轉 Timestamp） */
export interface DiscountCodeInput {
  discountAmount: number;
  validFromMs: number | null;
  validUntilMs: number;
  maxRedemptions: number | null;
  perUserLimit: number | null;
  minFare: number | null;
  allowedOrderTypes: string[] | null;
  enabled: boolean;
}

type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 解析 optional 非負整數欄位：undefined/null/'' → null；其餘須為 >= 0 的有限數字 */
function parseNullableNonNeg(raw: unknown, label: string): ValidateResult<number | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${label} 必須為非負數字` };
  return { ok: true, value: n };
}

/** 解析日期字串 → epoch ms；非法回 error */
function parseDateMs(raw: unknown, label: string): ValidateResult<number> {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: `${label} 為必填` };
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) return { ok: false, error: `${label} 不是合法日期` };
  return { ok: true, value: ms };
}

/**
 * 驗證 admin 建立 / 更新折扣碼的 body（不含 code 本身；code 由各端點自行驗證 / 取 route param）。
 *
 * 規則：
 *   - discountAmount 必填且 > 0
 *   - validUntil 必填且為合法日期
 *   - validFrom 選填；有值須為合法日期且不晚於 validUntil
 *   - maxRedemptions / perUserLimit / minFare 選填，有值須為非負數字
 *   - allowedOrderTypes 選填；有值須為陣列且每個值在 ORDER_TYPES 內（空陣列 → null）
 *   - enabled 選填，預設 true
 */
export function validateDiscountCodeBody(raw: Record<string, unknown>): ValidateResult<DiscountCodeInput> {
  const amount = Number(raw.discountAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'discountAmount 必須為大於 0 的數字' };
  }

  const untilCheck = parseDateMs(raw.validUntil, 'validUntil');
  if (!untilCheck.ok) return untilCheck;

  let validFromMs: number | null = null;
  if (raw.validFrom !== undefined && raw.validFrom !== null && raw.validFrom !== '') {
    const fromCheck = parseDateMs(raw.validFrom, 'validFrom');
    if (!fromCheck.ok) return fromCheck;
    if (fromCheck.value > untilCheck.value) {
      return { ok: false, error: 'validFrom 不可晚於 validUntil' };
    }
    validFromMs = fromCheck.value;
  }

  const maxRed = parseNullableNonNeg(raw.maxRedemptions, 'maxRedemptions');
  if (!maxRed.ok) return maxRed;
  const perUser = parseNullableNonNeg(raw.perUserLimit, 'perUserLimit');
  if (!perUser.ok) return perUser;
  const minFare = parseNullableNonNeg(raw.minFare, 'minFare');
  if (!minFare.ok) return minFare;

  let allowedOrderTypes: string[] | null = null;
  if (raw.allowedOrderTypes !== undefined && raw.allowedOrderTypes !== null) {
    if (!Array.isArray(raw.allowedOrderTypes)) {
      return { ok: false, error: 'allowedOrderTypes 必須為陣列' };
    }
    const arr = raw.allowedOrderTypes.filter((v): v is string => typeof v === 'string');
    for (const v of arr) {
      if (!ORDER_TYPE_VALUES.has(v)) return { ok: false, error: `allowedOrderTypes 含非法值：${v}` };
    }
    allowedOrderTypes = arr.length > 0 ? arr : null;
  }

  return {
    ok: true,
    value: {
      discountAmount: amount,
      validFromMs,
      validUntilMs: untilCheck.value,
      maxRedemptions: maxRed.value,
      perUserLimit: perUser.value,
      minFare: minFare.value,
      allowedOrderTypes,
      enabled: raw.enabled === undefined ? true : raw.enabled === true,
    },
  };
}

/** 正規化並驗證折扣碼字串（轉大寫 + 去空白 + 格式檢查） */
export function normalizeDiscountCode(raw: unknown): ValidateResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'code 為必填字串' };
  const code = raw.trim().toUpperCase();
  if (!DISCOUNT_CODE_REGEX.test(code)) {
    return { ok: false, error: 'code 必須為 3-32 碼英數字' };
  }
  return { ok: true, value: code };
}
