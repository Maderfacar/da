// Fare V2 可調規則 — Firestore fare_rules/v1 讀取、驗證與 in-memory 快取。
//
//   - getFareRules()：回傳目前生效規則；5 分鐘 TTL 快取；doc 不存在/格式錯 → DEFAULT_FARE_RULES
//   - validateFareRules()：嚴格驗證一份規則物件（admin PATCH 與讀取共用）
//   - invalidateFareRulesCache()：admin 改完規則後手動清快取
//
// 驗證採手寫（與 fleet-config.ts / legal-pages.ts 等既有 endpoint 一致，專案未引入 zod）。
//
// Fare V2 — Phase 2.4。

import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import {
  DEFAULT_FARE_RULES,
  type CharterRule,
  type DistanceTier,
  type FareRules,
  type MountainTier,
  type OrderType,
  type PeakWindow,
  type PromoWindow,
  type SurchargeWindow,
  type Weekday,
  type WeekendJamMode,
} from '~shared/pricing';

export const FARE_RULES_COLLECTION = 'fare_rules';
export const FARE_RULES_DOC_ID = 'v1';

// 30 秒：admin 改規則後最多等 30 秒，prod 各 serverless instance 即可自動拿到新規則。
// 設計取捨：Vercel serverless instance 各自有 module-level 快取，admin invalidateFareRulesCache
// 只清「處理該 PATCH 請求的 instance」，其他 instance 仍需等 TTL 才會重讀 Firestore。
// 短 TTL 讓校準時的驗證體驗大幅改善；Firestore 讀取每次 ~10ms / $0.000006，年成本可忽略。
const CACHE_TTL_MS = 30 * 1000;

const VALID_WEEKDAYS: ReadonlySet<string> = new Set(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
const VALID_WEEKEND_MODES: ReadonlySet<string> = new Set(['OFF', 'ALL_DAY', 'EVENING_ONLY']);
const VALID_ORDER_TYPES: ReadonlySet<string> = new Set([
  'airport-pickup',
  'airport-dropoff',
  'charter',
  'transfer',
]);
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ValidateResult =
  | { ok: true; value: FareRules }
  | { ok: false; error: string };

// ── 驗證 primitives ──────────────────────────────────────────────────────────

/**
 * 驗證 window 的 orderTypes 欄位（行程過濾）。
 * undefined → 回 undefined（合法，= 套用全部行程）；陣列含無效值 → 回錯誤字串。
 */
function parseOrderTypes(raw: unknown): OrderType[] | string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((o) => typeof o === 'string' && VALID_ORDER_TYPES.has(o))) {
    return 'window.orderTypes 含無效行程類型';
  }
  return raw as OrderType[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonNegNum = (v: unknown): v is number => isNum(v) && v >= 0;
const isPosNum = (v: unknown): v is number => isNum(v) && v > 0;

function validateMountainTiers(raw: unknown): MountainTier[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'mountain.tiers 必須是非空陣列';
  const tiers: MountainTier[] = [];
  for (const t of raw) {
    if (!isObj(t)) return 'mountain.tiers 元素必須是物件';
    if (!Number.isInteger(t.minScore) || (t.minScore as number) < 0) return 'tier.minScore 必須是非負整數';
    if (!isPosNum(t.multiplier)) return 'tier.multiplier 必須是正數';
    tiers.push({ minScore: t.minScore as number, multiplier: t.multiplier });
  }
  return tiers;
}

/**
 * Charter 山區階梯驗證：minScore 限制在 0-3 整數（三訊號最大分數為 3）。
 * 與 fare-v2 validateMountainTiers 共用相同 multiplier 約束，但 minScore 加上界。
 */
function validateCharterMountainTiers(raw: unknown): MountainTier[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'charter.mountain.tiers 必須是非空陣列';
  const tiers: MountainTier[] = [];
  for (const t of raw) {
    if (!isObj(t)) return 'charter.mountain.tiers 元素必須是物件';
    if (
      !Number.isInteger(t.minScore) ||
      (t.minScore as number) < 0 ||
      (t.minScore as number) > 3
    ) {
      return 'charter.mountain.tier.minScore 必須是 0-3 整數';
    }
    if (!isPosNum(t.multiplier)) return 'charter.mountain.tier.multiplier 必須是正數';
    tiers.push({ minScore: t.minScore as number, multiplier: t.multiplier });
  }
  return tiers;
}

function validatePeakWindows(raw: unknown): PeakWindow[] | string {
  if (!Array.isArray(raw)) return 'trafficJam.peakWindows 必須是陣列';
  const windows: PeakWindow[] = [];
  for (const w of raw) {
    if (!isObj(w)) return 'peakWindow 必須是物件';
    if (!Array.isArray(w.days) || w.days.length === 0) return 'peakWindow.days 必須是非空陣列';
    if (!w.days.every((d) => isStr(d) && VALID_WEEKDAYS.has(d))) return 'peakWindow.days 含無效星期代碼';
    if (!isStr(w.start) || !HHMM_RE.test(w.start)) return 'peakWindow.start 必須是 HH:MM';
    if (!isStr(w.end) || !HHMM_RE.test(w.end)) return 'peakWindow.end 必須是 HH:MM';
    if (w.start >= w.end) return 'peakWindow.start 必須早於 end';
    if (w.ntdPerMinute !== undefined && !isNonNegNum(w.ntdPerMinute)) {
      return 'peakWindow.ntdPerMinute 必須 ≥ 0';
    }
    const peakOrderTypes = parseOrderTypes(w.orderTypes);
    if (typeof peakOrderTypes === 'string') return peakOrderTypes;
    const pw: PeakWindow = {
      days: w.days as Weekday[],
      start: w.start,
      end: w.end,
    };
    if (w.ntdPerMinute !== undefined) pw.ntdPerMinute = w.ntdPerMinute as number;
    if (peakOrderTypes !== undefined) pw.orderTypes = peakOrderTypes;
    windows.push(pw);
  }
  return windows;
}

function validatePromoWindows(raw: unknown): PromoWindow[] | string {
  if (!Array.isArray(raw)) return 'promo.windows 必須是陣列';
  const windows: PromoWindow[] = [];
  for (const w of raw) {
    if (!isObj(w)) return 'promoWindow 必須是物件';
    if (!Array.isArray(w.days) || w.days.length === 0) return 'promoWindow.days 必須是非空陣列';
    if (!w.days.every((d) => isStr(d) && VALID_WEEKDAYS.has(d))) return 'promoWindow.days 含無效星期代碼';
    if (!isStr(w.start) || !HHMM_RE.test(w.start)) return 'promoWindow.start 必須是 HH:MM';
    if (!isStr(w.end) || !HHMM_RE.test(w.end)) return 'promoWindow.end 必須是 HH:MM';
    if (w.start >= w.end) return 'promoWindow.start 必須早於 end';
    if (w.discountNtd !== undefined && !isNonNegNum(w.discountNtd)) {
      return 'promoWindow.discountNtd 必須 ≥ 0';
    }
    const promoOrderTypes = parseOrderTypes(w.orderTypes);
    if (typeof promoOrderTypes === 'string') return promoOrderTypes;
    const pw: PromoWindow = {
      days: w.days as Weekday[],
      start: w.start,
      end: w.end,
    };
    if (w.discountNtd !== undefined) pw.discountNtd = w.discountNtd as number;
    if (promoOrderTypes !== undefined) pw.orderTypes = promoOrderTypes;
    windows.push(pw);
  }
  return windows;
}

function validateDistanceTiers(raw: unknown): DistanceTier[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'distanceTier.tiers 必須是非空陣列';
  const tiers: DistanceTier[] = [];
  for (const t of raw) {
    if (!isObj(t)) return 'distanceTier.tiers 元素必須是物件';
    if (!isNonNegNum(t.fromKm)) return 'distanceTier.tier.fromKm 必須 ≥ 0';
    if (!isNum(t.discountPct) || (t.discountPct as number) < 0 || (t.discountPct as number) > 100) {
      return 'distanceTier.tier.discountPct 必須是 0-100';
    }
    tiers.push({ fromKm: t.fromKm as number, discountPct: t.discountPct as number });
  }
  // 首段 fromKm 必為 0；fromKm 必須嚴格遞增
  tiers.sort((a, b) => a.fromKm - b.fromKm);
  if (tiers[0]!.fromKm !== 0) return 'distanceTier 第一段 fromKm 必須為 0';
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.fromKm <= tiers[i - 1]!.fromKm) {
      return 'distanceTier.tiers fromKm 必須嚴格遞增';
    }
  }
  return tiers;
}

function validateSurchargeWindows(raw: unknown): SurchargeWindow[] | string {
  if (!Array.isArray(raw)) return 'surcharge.windows 必須是陣列';
  const windows: SurchargeWindow[] = [];
  for (const w of raw) {
    if (!isObj(w)) return 'surchargeWindow 必須是物件';
    if (!Array.isArray(w.days) || w.days.length === 0) return 'surchargeWindow.days 必須是非空陣列';
    if (!w.days.every((d) => isStr(d) && VALID_WEEKDAYS.has(d))) return 'surchargeWindow.days 含無效星期代碼';
    if (!isStr(w.start) || !HHMM_RE.test(w.start)) return 'surchargeWindow.start 必須是 HH:MM';
    if (!isStr(w.end) || !HHMM_RE.test(w.end)) return 'surchargeWindow.end 必須是 HH:MM';
    if (w.start >= w.end) return 'surchargeWindow.start 必須早於 end';
    if (w.surchargeNtd !== undefined && !isNonNegNum(w.surchargeNtd)) {
      return 'surchargeWindow.surchargeNtd 必須 ≥ 0';
    }
    const surchargeOrderTypes = parseOrderTypes(w.orderTypes);
    if (typeof surchargeOrderTypes === 'string') return surchargeOrderTypes;
    const sw: SurchargeWindow = {
      days: w.days as Weekday[],
      start: w.start,
      end: w.end,
    };
    if (w.surchargeNtd !== undefined) sw.surchargeNtd = w.surchargeNtd as number;
    if (surchargeOrderTypes !== undefined) sw.orderTypes = surchargeOrderTypes;
    windows.push(sw);
  }
  return windows;
}

/** 嚴格驗證一份 fare rules 物件；成功回標準化 FareRules（剔除 Firestore meta 欄位）。 */
export function validateFareRules(raw: unknown): ValidateResult {
  if (!isObj(raw)) return { ok: false, error: '規則必須是物件' };

  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
    return { ok: false, error: 'version 必須是正整數' };
  }
  if (!isStr(raw.currency) || raw.currency.length === 0) {
    return { ok: false, error: 'currency 必須是非空字串' };
  }
  if (!isPosNum(raw.rounding)) return { ok: false, error: 'rounding 必須是正數' };

  // mountain
  const m = raw.mountain;
  if (!isObj(m)) return { ok: false, error: 'mountain 缺失' };
  if (!isBool(m.enabled)) return { ok: false, error: 'mountain.enabled 必須是 boolean' };
  if (!isPosNum(m.thresholdElevationDiffM)) return { ok: false, error: 'mountain.thresholdElevationDiffM 必須是正數' };
  if (!isPosNum(m.thresholdSinuosity)) return { ok: false, error: 'mountain.thresholdSinuosity 必須是正數' };
  if (!isPosNum(m.thresholdFreeFlowKmh)) return { ok: false, error: 'mountain.thresholdFreeFlowKmh 必須是正數' };
  const tiers = validateMountainTiers(m.tiers);
  if (typeof tiers === 'string') return { ok: false, error: tiers };

  // crossCounty
  const c = raw.crossCounty;
  if (!isObj(c)) return { ok: false, error: 'crossCounty 缺失' };
  if (!isBool(c.enabled)) return { ok: false, error: 'crossCounty.enabled 必須是 boolean' };
  if (!Array.isArray(c.tieredNtd) || c.tieredNtd.length === 0 || !c.tieredNtd.every(isNonNegNum)) {
    return { ok: false, error: 'crossCounty.tieredNtd 必須是非空的非負數陣列' };
  }
  if (!isBool(c.excludeTpeNtpeTyn)) return { ok: false, error: 'crossCounty.excludeTpeNtpeTyn 必須是 boolean' };

  // trafficJam
  const j = raw.trafficJam;
  if (!isObj(j)) return { ok: false, error: 'trafficJam 缺失' };
  if (!isBool(j.enabled)) return { ok: false, error: 'trafficJam.enabled 必須是 boolean' };
  if (!isStr(j.weekendMode) || !VALID_WEEKEND_MODES.has(j.weekendMode)) {
    return { ok: false, error: 'trafficJam.weekendMode 必須是 OFF / ALL_DAY / EVENING_ONLY' };
  }
  if (!isNonNegNum(j.defaultNtdPerMinute)) return { ok: false, error: 'trafficJam.defaultNtdPerMinute 必須 ≥ 0' };
  const windows = validatePeakWindows(j.peakWindows);
  if (typeof windows === 'string') return { ok: false, error: windows };

  // freeway
  const f = raw.freeway;
  if (!isObj(f)) return { ok: false, error: 'freeway 缺失' };
  if (!isBool(f.enabled)) return { ok: false, error: 'freeway.enabled 必須是 boolean' };
  if (!isNonNegNum(f.freeKm)) return { ok: false, error: 'freeway.freeKm 必須 ≥ 0' };
  if (!isNonNegNum(f.ntdPerKm)) return { ok: false, error: 'freeway.ntdPerKm 必須 ≥ 0' };
  if (!isPosNum(f.dailyCapKm)) return { ok: false, error: 'freeway.dailyCapKm 必須是正數' };
  if (!isNum(f.dailyCapDiscountPct) || f.dailyCapDiscountPct < 0 || f.dailyCapDiscountPct > 100) {
    return { ok: false, error: 'freeway.dailyCapDiscountPct 必須是 0-100' };
  }

  // promo（向後相容：舊 fare_rules/v1 doc 無此欄位 → 套預設，不視為格式錯誤）
  let promo = DEFAULT_FARE_RULES.promo;
  if (raw.promo !== undefined) {
    const p = raw.promo;
    if (!isObj(p)) return { ok: false, error: 'promo 缺失' };
    if (!isBool(p.enabled)) return { ok: false, error: 'promo.enabled 必須是 boolean' };
    if (!isStr(p.weekendMode) || !VALID_WEEKEND_MODES.has(p.weekendMode)) {
      return { ok: false, error: 'promo.weekendMode 必須是 OFF / ALL_DAY / EVENING_ONLY' };
    }
    if (!isNonNegNum(p.defaultDiscountNtd)) return { ok: false, error: 'promo.defaultDiscountNtd 必須 ≥ 0' };
    const promoWindows = validatePromoWindows(p.windows);
    if (typeof promoWindows === 'string') return { ok: false, error: promoWindows };
    promo = {
      enabled: p.enabled,
      windows: promoWindows,
      weekendMode: p.weekendMode as WeekendJamMode,
      defaultDiscountNtd: p.defaultDiscountNtd,
    };
  }

  // surcharge（向後相容：舊 fare_rules/v1 doc 無此欄位 → 套預設，不視為格式錯誤）
  let surcharge = DEFAULT_FARE_RULES.surcharge;
  if (raw.surcharge !== undefined) {
    const s = raw.surcharge;
    if (!isObj(s)) return { ok: false, error: 'surcharge 缺失' };
    if (!isBool(s.enabled)) return { ok: false, error: 'surcharge.enabled 必須是 boolean' };
    if (!isStr(s.weekendMode) || !VALID_WEEKEND_MODES.has(s.weekendMode)) {
      return { ok: false, error: 'surcharge.weekendMode 必須是 OFF / ALL_DAY / EVENING_ONLY' };
    }
    if (!isNonNegNum(s.defaultSurchargeNtd)) return { ok: false, error: 'surcharge.defaultSurchargeNtd 必須 ≥ 0' };
    const surchargeWindows = validateSurchargeWindows(s.windows);
    if (typeof surchargeWindows === 'string') return { ok: false, error: surchargeWindows };
    surcharge = {
      enabled: s.enabled,
      windows: surchargeWindows,
      weekendMode: s.weekendMode as WeekendJamMode,
      defaultSurchargeNtd: s.defaultSurchargeNtd,
    };
  }

  // distanceTier（向後相容：舊 fare_rules/v1 doc 無此欄位 → 套預設，不視為格式錯誤）
  let distanceTier = DEFAULT_FARE_RULES.distanceTier;
  if (raw.distanceTier !== undefined) {
    const d = raw.distanceTier;
    if (!isObj(d)) return { ok: false, error: 'distanceTier 缺失' };
    if (!isBool(d.enabled)) return { ok: false, error: 'distanceTier.enabled 必須是 boolean' };
    const distanceTierTiers = validateDistanceTiers(d.tiers);
    if (typeof distanceTierTiers === 'string') return { ok: false, error: distanceTierTiers };
    distanceTier = { enabled: d.enabled, tiers: distanceTierTiers };
  }

  // charter（Charter Fare V1 W3：admin UI 已上完整 PATCH 編輯路徑，本驗證為完整模式。
  // 向後相容：舊 fare_rules/v1 doc 無此欄位 → fallback DEFAULT_FARE_RULES.charter；
  // raw.charter 存在但欄位錯 → 回 error（W3 新增加嚴格）。
  // 完整驗證：rounding 正整數、grace 0-60、mountain tier minScore 整數 0-3。）
  let charter: CharterRule = DEFAULT_FARE_RULES.charter;
  if (raw.charter !== undefined) {
    const ch = raw.charter;
    if (!isObj(ch)) return { ok: false, error: 'charter 必須是物件' };
    if (!isBool(ch.enabled)) return { ok: false, error: 'charter.enabled 必須是 boolean' };
    if (!Number.isInteger(ch.rounding) || (ch.rounding as number) < 1) {
      return { ok: false, error: 'charter.rounding 必須是正整數' };
    }
    if (
      !isNum(ch.overtimeGraceMin) ||
      (ch.overtimeGraceMin as number) < 0 ||
      (ch.overtimeGraceMin as number) > 60
    ) {
      return { ok: false, error: 'charter.overtimeGraceMin 必須是 0-60' };
    }
    if (!isNonNegNum(ch.roundTripFlatFee)) return { ok: false, error: 'charter.roundTripFlatFee 必須 ≥ 0' };
    if (!isNonNegNum(ch.roundTripBufferKm)) return { ok: false, error: 'charter.roundTripBufferKm 必須 ≥ 0' };
    if (!isNonNegNum(ch.roundTripOverShootMaxKm)) return { ok: false, error: 'charter.roundTripOverShootMaxKm 必須 ≥ 0' };
    if (!isNonNegNum(ch.overnightFlatFee)) return { ok: false, error: 'charter.overnightFlatFee 必須 ≥ 0' };
    if (!isBool(ch.applySurchargeWindows)) return { ok: false, error: 'charter.applySurchargeWindows 必須是 boolean' };
    if (!isBool(ch.applyPromoWindows)) return { ok: false, error: 'charter.applyPromoWindows 必須是 boolean' };
    const cm = ch.mountain;
    if (!isObj(cm)) return { ok: false, error: 'charter.mountain 缺失' };
    if (!isBool(cm.enabled)) return { ok: false, error: 'charter.mountain.enabled 必須是 boolean' };
    const charterTiers = validateCharterMountainTiers(cm.tiers);
    if (typeof charterTiers === 'string') return { ok: false, error: charterTiers };
    charter = {
      enabled: ch.enabled,
      rounding: ch.rounding as number,
      overtimeGraceMin: ch.overtimeGraceMin as number,
      roundTripFlatFee: ch.roundTripFlatFee,
      roundTripBufferKm: ch.roundTripBufferKm,
      roundTripOverShootMaxKm: ch.roundTripOverShootMaxKm,
      overnightFlatFee: ch.overnightFlatFee,
      mountain: { enabled: cm.enabled, tiers: charterTiers },
      applySurchargeWindows: ch.applySurchargeWindows,
      applyPromoWindows: ch.applyPromoWindows,
    };
  }

  return {
    ok: true,
    value: {
      version: raw.version as number,
      currency: raw.currency,
      rounding: raw.rounding,
      mountain: {
        enabled: m.enabled,
        thresholdElevationDiffM: m.thresholdElevationDiffM,
        thresholdSinuosity: m.thresholdSinuosity,
        thresholdFreeFlowKmh: m.thresholdFreeFlowKmh,
        tiers,
      },
      crossCounty: {
        enabled: c.enabled,
        tieredNtd: c.tieredNtd as number[],
        excludeTpeNtpeTyn: c.excludeTpeNtpeTyn,
      },
      trafficJam: {
        enabled: j.enabled,
        peakWindows: windows,
        weekendMode: j.weekendMode as WeekendJamMode,
        defaultNtdPerMinute: j.defaultNtdPerMinute,
      },
      freeway: {
        enabled: f.enabled,
        freeKm: f.freeKm,
        ntdPerKm: f.ntdPerKm,
        dailyCapKm: f.dailyCapKm,
        dailyCapDiscountPct: f.dailyCapDiscountPct,
      },
      promo,
      surcharge,
      distanceTier,
      charter,
    },
  };
}

// ── In-memory 快取 ───────────────────────────────────────────────────────────

let cached: FareRules | null = null;
let cachedAt = 0;

/**
 * 取得目前生效的 fare rules。5 分鐘 TTL；doc 不存在 / 格式錯 / 讀取失敗一律 fallback
 * DEFAULT_FARE_RULES（並快取避免每次估價重打 Firestore）。
 */
export async function getFareRules(): Promise<FareRules> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  try {
    const { firebaseServiceAccountJson } = useRuntimeConfig();
    if (firebaseServiceAccountJson) {
      const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
      const snap = await db.collection(FARE_RULES_COLLECTION).doc(FARE_RULES_DOC_ID).get();
      if (snap.exists) {
        const parsed = validateFareRules(snap.data());
        if (parsed.ok) {
          cached = parsed.value;
          cachedAt = now;
          return cached;
        }
        console.error('[fare-rules] fare_rules/v1 格式錯誤，改用預設：', parsed.error);
      }
    }
  } catch (err) {
    console.error('[fare-rules] 載入失敗，改用預設：', err);
  }

  cached = DEFAULT_FARE_RULES;
  cachedAt = now;
  return cached;
}

// epoch：每次規則失效 +1，供下游（如 /api/maps/route 的 LRU 快取）作為 key 一部分，
// 規則一改即讓所有舊估價快取自然失效。
let rulesEpoch = 0;

/** admin 改完 fare_rules 後呼叫，下次 getFareRules 立即重讀。 */
export function invalidateFareRulesCache(): void {
  cached = null;
  cachedAt = 0;
  rulesEpoch++;
}

/** 規則 epoch — 規則每次變更即遞增。 */
export function getFareRulesEpoch(): number {
  return rulesEpoch;
}
