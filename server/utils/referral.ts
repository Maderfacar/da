/**
 * 推薦獎勵機制 — referral domain util
 *
 * 設計：openspec/changes/2026-05-20-referral-share-reward/design.md
 *
 * 本檔涵蓋：
 *   - referralCode 產生與全 users 唯一性檢查（Phase 1）
 *   - users 推薦相關欄位型別 / 預設（Phase 1）
 *   - referrals 帳本 doc 型別（Phase 1）
 *   - referral_campaign/config 活動設定型別 / 預設 / 讀取（Phase 1）
 *   - 歸因綁定防刷檢查、bindReferral 交易（Phase 2）
 *   - pending lazy 過期、資格判定、processReferralQualification（Phase 2）
 */
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';
import type { I18nMsg } from '@@/utils/response';
import type { Lang } from '@@/utils/i18n-message';
import { mintDiscountCode } from '@@/utils/discount-code';

// ── referralCode 產生 ─────────────────────────────────────────────

/**
 * referralCode 字元集：大寫英數，剔除易混淆字元（0/O、1/I/L）。
 * 推薦碼會經 LINE 訊息分享、由人眼閱讀，故採可讀字元集。
 */
const REFERRAL_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** referralCode 長度：6 碼 */
export const REFERRAL_CODE_LENGTH = 6;

/** referralCode 格式（doc 欄位驗證用）：6 碼大寫英數 */
export const REFERRAL_CODE_REGEX = /^[A-Z0-9]{6}$/;

/** 唯一性檢查的最大重試次數 */
const REFERRAL_CODE_MAX_ATTEMPTS = 5;

/** 產生一組 6 碼隨機 referralCode（純函式，不檢查唯一性）。 */
export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_CHARSET[randomInt(REFERRAL_CODE_CHARSET.length)];
  }
  return code;
}

/**
 * 產生一組在全 users collection 唯一的 referralCode。
 * 以 `users where referralCode == candidate` 偵測碰撞，最多重試 5 次；
 * 全數碰撞則 throw（極低機率，呼叫端須自行 catch 以免阻擋登入）。
 */
export async function generateUniqueReferralCode(db: Firestore): Promise<string> {
  for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt++) {
    const candidate = generateReferralCode();
    const snap = await db
      .collection('users')
      .where('referralCode', '==', candidate)
      .limit(1)
      .get();
    if (snap.empty) return candidate;
  }
  throw new Error('generateUniqueReferralCode: 連續碰撞，無法產生唯一推薦碼');
}

// ── users 推薦相關欄位 ────────────────────────────────────────────

/**
 * users/{lineUid} 推薦相關欄位（design.md §3.1）。
 *   - referralCode：自己的推薦碼，首次建立 user doc 時產生
 *   - referredBy：帶他進來的推薦人 lineUid；write-once，預設 null（寫入點在 Phase 2）
 *   - welcomeRewardClaimed：是否已領歡迎碼，預設 false（寫入點在 Phase 2）
 */
export interface ReferralUserFields {
  referralCode: string;
  referredBy: string | null;
  welcomeRewardClaimed: boolean;
}

/** users 推薦欄位預設值（新建 user doc 時套用 referredBy / welcomeRewardClaimed）。 */
export const DEFAULT_REFERRAL_USER_FIELDS: Omit<ReferralUserFields, 'referralCode'> = {
  referredBy: null,
  welcomeRewardClaimed: false,
};

// ── referrals 帳本 ────────────────────────────────────────────────

/** 推薦生命週期狀態（design.md §3.2）。 */
export type ReferralStatus = 'pending' | 'qualified' | 'rewarded' | 'expired';

/**
 * referrals/{refereeUid} — 推薦帳本 doc。
 * doc id = 被推薦人 lineUid，天然保證一個被推薦人僅一筆推薦紀錄。
 */
export interface ReferralDoc {
  referrerUid: string;
  refereeUid: string;
  referrerCode: string;
  status: ReferralStatus;
  welcomeCodeId: string | null;
  rewardCodeId: string | null;
  createdAt: Timestamp;
  qualifiedAt: Timestamp | null;
  expiresAt: Timestamp;
}

// ── referral_campaign 活動設定 ────────────────────────────────────

export const REFERRAL_CAMPAIGN_COLLECTION = 'referral_campaign';
export const REFERRAL_CAMPAIGN_DOC_ID = 'config';

/** 分享活動 Flex 卡內容（design.md §3.3 shareCard）。 */
export interface ReferralShareCard {
  title: string;
  imageUrl: string;
  body: string;
  ctaLabel: string;
}

/** referral_campaign/config — 推薦活動設定（design.md §3.3）。 */
export interface ReferralCampaignConfig {
  /** kill-switch：false 時 /referral/bind 一律拒、分享卡不顯示 */
  enabled: boolean;
  /** 歡迎碼金額（NT$） */
  welcomeAmount: number;
  /** 推薦獎勵碼金額（NT$） */
  rewardAmount: number;
  /** 歡迎碼效期（天） */
  welcomeValidityDays: number;
  /** 推薦獎勵碼效期（天） */
  rewardValidityDays: number;
  /** 兩碼皆套用的 minFare（NT$） */
  minFare: number;
  /** pending 推薦未完成首單的過期天數 */
  pendingTtlDays: number;
  /** 單人推薦數異常軟門檻（admin 紀錄頁紅字提示用） */
  anomalyThreshold: number;
  /** 分享 Flex 卡內容 */
  shareCard: ReferralShareCard;
}

/** 活動設定預設值（design.md §3.3）。 */
export const DEFAULT_REFERRAL_CAMPAIGN: ReferralCampaignConfig = {
  enabled: false,
  welcomeAmount: 150,
  rewardAmount: 150,
  welcomeValidityDays: 90,
  rewardValidityDays: 60,
  minFare: 500,
  pendingTtlDays: 30,
  anomalyThreshold: 50,
  shareCard: {
    title: '',
    imageUrl: '',
    body: '',
    ctaLabel: '',
  },
};

/** 把 Firestore doc 資料正規化為完整 ReferralCampaignConfig（缺欄位套預設）。 */
export function normalizeReferralCampaign(raw: Record<string, unknown> | undefined): ReferralCampaignConfig {
  const d = raw ?? {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
  const card = (d.shareCard ?? {}) as Record<string, unknown>;
  return {
    enabled: d.enabled === true,
    welcomeAmount: num(d.welcomeAmount, DEFAULT_REFERRAL_CAMPAIGN.welcomeAmount),
    rewardAmount: num(d.rewardAmount, DEFAULT_REFERRAL_CAMPAIGN.rewardAmount),
    welcomeValidityDays: num(d.welcomeValidityDays, DEFAULT_REFERRAL_CAMPAIGN.welcomeValidityDays),
    rewardValidityDays: num(d.rewardValidityDays, DEFAULT_REFERRAL_CAMPAIGN.rewardValidityDays),
    minFare: num(d.minFare, DEFAULT_REFERRAL_CAMPAIGN.minFare),
    pendingTtlDays: num(d.pendingTtlDays, DEFAULT_REFERRAL_CAMPAIGN.pendingTtlDays),
    anomalyThreshold: num(d.anomalyThreshold, DEFAULT_REFERRAL_CAMPAIGN.anomalyThreshold),
    shareCard: {
      title: str(card.title, ''),
      imageUrl: str(card.imageUrl, ''),
      body: str(card.body, ''),
      ctaLabel: str(card.ctaLabel, ''),
    },
  };
}

/**
 * 讀取推薦活動設定。doc 不存在則以預設值建立（get-or-create）並回傳預設；
 * 建立失敗不阻擋流程，仍回傳預設值。
 */
export async function getReferralCampaign(db: Firestore): Promise<ReferralCampaignConfig> {
  const ref = db.collection(REFERRAL_CAMPAIGN_COLLECTION).doc(REFERRAL_CAMPAIGN_DOC_ID);
  const snap = await ref.get();
  if (snap.exists) {
    return normalizeReferralCampaign(snap.data());
  }
  try {
    await ref.create(DEFAULT_REFERRAL_CAMPAIGN);
  } catch (err) {
    // 併發下另一請求可能已建立；非致命，仍回傳預設值
    console.warn('[referral] referral_campaign/config 初始化失敗（非致命）：', err);
  }
  return { ...DEFAULT_REFERRAL_CAMPAIGN };
}

// ── Phase 4：活動設定 PUT 驗證（design.md §6）─────────────────────

/** shareCard 各欄位字數上限（admin PUT 驗證用）。 */
const SHARE_CARD_FIELD_MAX = {
  title: 100,
  imageUrl: 2000,
  body: 1000,
  ctaLabel: 40,
} as const;

/**
 * 活動設定數值欄位規格：min / max（整數，含端點）。
 * 設上限避免 admin 誤填極端值（例：效期填 999999 天）。
 */
const REFERRAL_CAMPAIGN_NUMERIC_FIELDS: Array<{
  key: 'welcomeAmount' | 'rewardAmount' | 'welcomeValidityDays' | 'rewardValidityDays' | 'minFare' | 'pendingTtlDays' | 'anomalyThreshold';
  label: I18nMsg;
  min: number;
  max: number;
}> = [
  { key: 'welcomeAmount', label: { zh_tw: '歡迎碼金額', en: 'Welcome code amount', ja: 'ウェルカムコード金額' }, min: 1, max: 100_000 },
  { key: 'rewardAmount', label: { zh_tw: '推薦獎勵碼金額', en: 'Reward code amount', ja: '紹介報酬コード金額' }, min: 1, max: 100_000 },
  { key: 'welcomeValidityDays', label: { zh_tw: '歡迎碼效期（天）', en: 'Welcome code validity (days)', ja: 'ウェルカムコード有効期間（日）' }, min: 1, max: 3650 },
  { key: 'rewardValidityDays', label: { zh_tw: '推薦獎勵碼效期（天）', en: 'Reward code validity (days)', ja: '紹介報酬コード有効期間（日）' }, min: 1, max: 3650 },
  { key: 'minFare', label: { zh_tw: '最低車資門檻', en: 'Minimum fare', ja: '最低料金' }, min: 0, max: 1_000_000 },
  { key: 'pendingTtlDays', label: { zh_tw: 'pending 過期天數', en: 'Pending TTL (days)', ja: 'pending 期限（日）' }, min: 1, max: 3650 },
  { key: 'anomalyThreshold', label: { zh_tw: '異常偵測門檻', en: 'Anomaly threshold', ja: '異常検知しきい値' }, min: 1, max: 100_000 },
];

export type ValidateReferralCampaignResult =
  | { ok: true; value: ReferralCampaignConfig }
  | { ok: false; error: I18nMsg };

/** 把 raw 值解析為整數（接受 number 或數字字串）；非整數回 null。 */
function parseIntStrict(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

/**
 * 驗證 admin PUT 的活動設定 body（design.md §6）。
 * 數值欄位須為各自範圍內的整數；shareCard 四欄須為字串且不超長。
 * 任一欄位不合法即回三語錯誤訊息；通過則回正規化後的完整 ReferralCampaignConfig。
 */
export function validateReferralCampaignBody(raw: Record<string, unknown>): ValidateReferralCampaignResult {
  if (typeof raw.enabled !== 'boolean') {
    return { ok: false, error: { zh_tw: 'enabled 必須為布林值', en: 'enabled must be a boolean', ja: 'enabled はブール値' } };
  }

  const nums = {} as Record<(typeof REFERRAL_CAMPAIGN_NUMERIC_FIELDS)[number]['key'], number>;
  for (const field of REFERRAL_CAMPAIGN_NUMERIC_FIELDS) {
    const n = parseIntStrict(raw[field.key]);
    if (n === null || n < field.min || n > field.max) {
      return {
        ok: false,
        error: {
          zh_tw: `${field.label.zh_tw} 必須為 ${field.min}–${field.max} 之間的整數`,
          en: `${field.label.en} must be an integer between ${field.min} and ${field.max}`,
          ja: `${field.label.ja} は ${field.min}〜${field.max} の整数`,
        },
      };
    }
    nums[field.key] = n;
  }

  const rawCard = (raw.shareCard ?? {}) as Record<string, unknown>;
  const card = {} as ReferralShareCard;
  for (const [key, max] of Object.entries(SHARE_CARD_FIELD_MAX) as Array<[keyof ReferralShareCard, number]>) {
    const v = rawCard[key];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      return { ok: false, error: { zh_tw: `分享卡 ${key} 必須為字串`, en: `shareCard.${key} must be a string`, ja: `シェアカード ${key} は文字列` } };
    }
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length > max) {
      return {
        ok: false,
        error: {
          zh_tw: `分享卡 ${key} 不可超過 ${max} 字`,
          en: `shareCard.${key} must not exceed ${max} characters`,
          ja: `シェアカード ${key} は ${max} 文字以内`,
        },
      };
    }
    card[key] = s;
  }

  return {
    ok: true,
    value: {
      enabled: raw.enabled,
      welcomeAmount: nums.welcomeAmount,
      rewardAmount: nums.rewardAmount,
      welcomeValidityDays: nums.welcomeValidityDays,
      rewardValidityDays: nums.rewardValidityDays,
      minFare: nums.minFare,
      pendingTtlDays: nums.pendingTtlDays,
      anomalyThreshold: nums.anomalyThreshold,
      shareCard: card,
    },
  };
}

// ── Phase 2：共用常數 ─────────────────────────────────────────────

/** 一天的毫秒數（效期 / pending TTL 換算用）。 */
const MS_PER_DAY = 86_400_000;

// ── Phase 2：歸因綁定防刷檢查（design.md §5）─────────────────────

/**
 * /referral/bind 防刷失敗代碼：
 *   - CAMPAIGN_DISABLED：活動 kill-switch 關閉（§5.1）
 *   - INVALID_REF：ref 對應的 referralCode 查無使用者（§5.2）
 *   - SELF_REFERRAL：推薦人 = 被推薦人（§5.3）
 *   - ALREADY_BOUND：被推薦人已綁定 referredBy（§5.4，write-once）
 *   - NOT_NEW_USER：被推薦人非全新帳號，已有訂單（§5.5）
 */
export type ReferralBindFailCode =
  | 'CAMPAIGN_DISABLED'
  | 'INVALID_REF'
  | 'SELF_REFERRAL'
  | 'ALREADY_BOUND'
  | 'NOT_NEW_USER';

/** checkReferralBindEligibility 消費的純資料（Firestore 查詢結果正規化後）。 */
export interface ReferralBindCheckInput {
  /** 活動 enabled（kill-switch）。 */
  campaignEnabled: boolean;
  /** ref 對應的推薦人 lineUid；null = referralCode 查無。 */
  referrerUid: string | null;
  /** 被推薦人 lineUid。 */
  refereeUid: string;
  /** 被推薦人現有的 referredBy（null = 尚未綁定）。 */
  existingReferredBy: string | null;
  /** 被推薦人是否已有任何訂單。 */
  refereeHasOrders: boolean;
}

export type ReferralBindCheckResult =
  | { ok: true; referrerUid: string }
  | { ok: false; code: ReferralBindFailCode };

/**
 * 推薦綁定防刷檢查（純函式，design.md §5 六項中可純判定的五項）。
 * 逐項檢查，任一失敗即回對應代碼；§5.6 的 transaction 競態保護由 bindReferral 負責。
 */
export function checkReferralBindEligibility(input: ReferralBindCheckInput): ReferralBindCheckResult {
  if (!input.campaignEnabled) return { ok: false, code: 'CAMPAIGN_DISABLED' };
  if (!input.referrerUid) return { ok: false, code: 'INVALID_REF' };
  if (input.referrerUid === input.refereeUid) return { ok: false, code: 'SELF_REFERRAL' };
  if (input.existingReferredBy !== null) return { ok: false, code: 'ALREADY_BOUND' };
  if (input.refereeHasOrders) return { ok: false, code: 'NOT_NEW_USER' };
  return { ok: true, referrerUid: input.referrerUid };
}

// ── Phase 5：推薦 LINE 推播文案 i18n ──────────────────────────

/**
 * 推薦相關 LINE 推播訊息 key：
 *   - referral.welcome：被推薦人綁定後推播其歡迎碼
 *   - referral.reward：被推薦人完成首單後推播推薦人推薦獎勵碼
 */
export type ReferralPushKey = 'referral.welcome' | 'referral.reward';

const REFERRAL_PUSH_VALID_LANGS: Lang[] = ['zh_tw', 'en', 'ja'];

/** 推薦推播訊息表（三語）；{code} 為鑄出的折扣碼。 */
const REFERRAL_PUSH_MESSAGES: Record<ReferralPushKey, Record<Lang, (code: string) => string>> = {
  'referral.welcome': {
    zh_tw: (code) => `👋 歡迎加入！\n您的新人專屬折扣碼：${code}\n首次訂車輸入即可折抵，期待為您服務。`,
    en: (code) => `👋 Welcome aboard!\nYour welcome discount code: ${code}\nApply it on your first booking to enjoy the discount.`,
    ja: (code) => `👋 ようこそ！\n新規限定割引コード：${code}\n初回のご予約でご利用いただけます。`,
  },
  'referral.reward': {
    zh_tw: (code) => `🎉 您推薦的好友已完成首趟行程！\n推薦獎勵碼：${code}\n下次訂車輸入即可折抵，感謝您的推薦。`,
    en: (code) => `🎉 Your referred friend completed their first trip!\nReferral reward code: ${code}\nApply it on your next booking. Thanks for sharing!`,
    ja: (code) => `🎉 ご紹介のお友達が初回送迎を完了しました！\n紹介報酬コード：${code}\n次回のご予約でご利用いただけます。ご紹介ありがとうございます。`,
  },
};

/** 取對應語系的推薦推播文案（lang 缺值 / 非法 → fallback zh_tw）。 */
export function getReferralPushMessage(
  key: ReferralPushKey,
  lang: Lang | string | undefined,
  code: string,
): string {
  const safeLang: Lang = (typeof lang === 'string' && (REFERRAL_PUSH_VALID_LANGS as string[]).includes(lang))
    ? (lang as Lang)
    : 'zh_tw';
  return REFERRAL_PUSH_MESSAGES[key][safeLang](code);
}

/** 各防刷失敗代碼對應的三語訊息（API 回傳用）。 */
export const REFERRAL_BIND_FAIL_MESSAGES: Record<ReferralBindFailCode, I18nMsg> = {
  CAMPAIGN_DISABLED: { zh_tw: '推薦活動目前未開放', en: 'The referral campaign is not currently active', ja: '紹介キャンペーンは現在実施されていません' },
  INVALID_REF: { zh_tw: '推薦碼無效', en: 'Invalid referral code', ja: '紹介コードが無効です' },
  SELF_REFERRAL: { zh_tw: '無法使用自己的推薦碼', en: 'You cannot use your own referral code', ja: '自分の紹介コードは使用できません' },
  ALREADY_BOUND: { zh_tw: '此帳號已完成推薦綁定', en: 'This account has already been referred', ja: 'このアカウントは既に紹介済みです' },
  NOT_NEW_USER: { zh_tw: '此優惠僅限新加入的好友', en: 'This offer is only for newly joined friends', ja: 'この特典は新規のお友達限定です' },
};

// ── Phase 2：pending lazy 過期（design.md §8）────────────────────

/**
 * referrals 狀態的有效值（lazy 過期）：
 * `pending` 且 `nowMs > expiresAtMs` → 視為 `expired`；其餘狀態原樣回傳。
 * 不做排程，由讀取端（資格判定 / /referral/me / admin 紀錄頁）即時換算。
 */
export function effectiveReferralStatus(
  status: ReferralStatus,
  expiresAtMs: number,
  nowMs: number,
): ReferralStatus {
  if (status === 'pending' && nowMs > expiresAtMs) return 'expired';
  return status;
}

// ── Phase 2：推薦資格判定（design.md §4 ④）──────────────────────

export interface ReferralQualifyInput {
  /** referrals/{refereeUid} 的有效狀態（已套 lazy 過期）；null = 無推薦紀錄。 */
  referralStatus: ReferralStatus | null;
  /** 此筆完成訂單是否為被推薦人首筆 completed 訂單。 */
  isFirstCompletedOrder: boolean;
}

/**
 * 被推薦人完成首筆行程 → 推薦人取得獎勵的資格判定（純函式）。
 * 條件：referrals 為 `pending` 且此為被推薦人首筆 completed 訂單。
 */
export function shouldQualifyReferral(input: ReferralQualifyInput): boolean {
  return input.referralStatus === 'pending' && input.isFirstCompletedOrder;
}

// ── Phase 2：bindReferral 交易（design.md §4 ③ / §5）─────────────

/** bindReferral transaction 內用的中止標記（競態 → 回對應失敗代碼）。 */
class ReferralBindAbort extends Error {
  constructor(public failCode: ReferralBindFailCode) {
    super(failCode);
    this.name = 'ReferralBindAbort';
  }
}

export type BindReferralResult =
  | { ok: true; welcomeCode: string; referrerUid: string }
  | { ok: false; failCode: ReferralBindFailCode };

/**
 * 推薦歸因綁定（design.md §4 ③）：
 *   1. 讀活動設定 + ref→referrerUid + 被推薦人現況 + 是否已有訂單。
 *   2. checkReferralBindEligibility 防刷五項檢查。
 *   3. 鑄歡迎碼（mintDiscountCode 自帶碰撞重試）。
 *   4. transaction 寫入：referredBy（write-once）+ welcomeRewardClaimed + 建 referrals doc。
 *
 * transaction 內 re-check referrals doc 與 referredBy，競態落敗時 best-effort
 * 刪除剛鑄的孤兒歡迎碼後回 ALREADY_BOUND。
 */
export async function bindReferral(
  db: Firestore,
  params: { ref: string; refereeUid: string },
): Promise<BindReferralResult> {
  const { ref, refereeUid } = params;

  const campaign = await getReferralCampaign(db);

  // ref → 推薦人 lineUid（referralCode 全 users 唯一，doc id 即 lineUid）
  const refSnap = await db.collection('users').where('referralCode', '==', ref).limit(1).get();
  const referrerUid = refSnap.empty ? null : refSnap.docs[0].id;

  // 被推薦人現況（referredBy）
  const refereeRef = db.collection('users').doc(refereeUid);
  const refereeSnap = await refereeRef.get();
  const existingReferredBy = (refereeSnap.data()?.referredBy as string | null | undefined) ?? null;

  // 被推薦人是否已有任何訂單（全新帳號判定）
  const ordersSnap = await db.collection('orders').where('userId', '==', refereeUid).limit(1).get();

  const check = checkReferralBindEligibility({
    campaignEnabled: campaign.enabled,
    referrerUid,
    refereeUid,
    existingReferredBy,
    refereeHasOrders: !ordersSnap.empty,
  });
  if (!check.ok) return { ok: false, failCode: check.code };

  // 先鑄歡迎碼（mintDiscountCode 自帶碰撞重試）；transaction 競態失敗時再 best-effort 刪除
  const now = Date.now();
  const { code: welcomeCode } = await mintDiscountCode(db, {
    source: 'referral-welcome',
    ownerUid: refereeUid,
    discountAmount: campaign.welcomeAmount,
    validUntilMs: now + campaign.welcomeValidityDays * MS_PER_DAY,
    minFare: campaign.minFare,
    createdBy: 'referral-system',
  });

  const referralRef = db.collection('referrals').doc(refereeUid);
  const expiresAt = Timestamp.fromMillis(now + campaign.pendingTtlDays * MS_PER_DAY);

  try {
    await db.runTransaction(async (tx) => {
      const [rSnap, uSnap] = await Promise.all([tx.get(referralRef), tx.get(refereeRef)]);
      // referrals doc 已存在 / referredBy 已被寫入 → 競態落敗
      if (rSnap.exists) throw new ReferralBindAbort('ALREADY_BOUND');
      if (((uSnap.data()?.referredBy as string | null | undefined) ?? null) !== null) {
        throw new ReferralBindAbort('ALREADY_BOUND');
      }
      tx.set(refereeRef, { referredBy: check.referrerUid, welcomeRewardClaimed: true }, { merge: true });
      tx.create(referralRef, {
        referrerUid: check.referrerUid,
        refereeUid,
        referrerCode: ref,
        status: 'pending',
        welcomeCodeId: welcomeCode,
        rewardCodeId: null,
        createdAt: FieldValue.serverTimestamp(),
        qualifiedAt: null,
        expiresAt,
      });
    });
  } catch (err) {
    // 競態落敗 → best-effort 刪除剛鑄的孤兒歡迎碼（清理失敗非致命）
    await db.collection('discount_codes').doc(welcomeCode).delete().catch(() => { /* 忽略 */ });
    if (err instanceof ReferralBindAbort) return { ok: false, failCode: err.failCode };
    throw err;
  }

  return { ok: true, welcomeCode, referrerUid: check.referrerUid };
}

// ── Phase 2：processReferralQualification（design.md §4 ④）───────

/** processReferralQualification transaction 內用的中止標記（競態 → 略過）。 */
class ReferralQualifyAbort extends Error {
  constructor() {
    super('ReferralQualifyAbort');
    this.name = 'ReferralQualifyAbort';
  }
}

export type QualifyReferralResult =
  | { ok: true; rewardCode: string; referrerUid: string }
  | { ok: false };

/**
 * 被推薦人完成首筆行程後的推薦資格判定（design.md §4 ④）。
 * 由 orders/[orderId].patch.ts 在 status→completed 後以 fire-and-forget 呼叫。
 *
 * 流程：
 *   1. 讀 referrals/{refereeUid}；不存在 → 略過。
 *   2. lazy 過期：pending 已過 expiresAt → 寫回 expired 並略過。
 *   3. 非 pending → 略過（已 rewarded / expired）。
 *   4. 確認此為被推薦人首筆 completed 訂單。
 *   5. 鑄推薦獎勵碼（ownerUid = 推薦人）。
 *   6. transaction re-check status=pending → 轉 rewarded、寫 rewardCodeId / qualifiedAt。
 *      競態落敗時 best-effort 刪除孤兒獎勵碼。
 */
export async function processReferralQualification(
  db: Firestore,
  refereeUid: string,
  completedOrderId: string,
): Promise<QualifyReferralResult> {
  const referralRef = db.collection('referrals').doc(refereeUid);
  const snap = await referralRef.get();
  if (!snap.exists) return { ok: false };

  const data = snap.data() as Partial<ReferralDoc>;
  const status = (data.status as ReferralStatus | undefined) ?? 'pending';
  const expiresAtMs = (data.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  const effective = effectiveReferralStatus(status, expiresAtMs, Date.now());

  // lazy 過期：pending 已過期 → 寫回 expired（清理失敗非致命）
  if (status === 'pending' && effective === 'expired') {
    await referralRef.update({ status: 'expired' }).catch(() => { /* 忽略 */ });
    return { ok: false };
  }
  if (effective !== 'pending') return { ok: false };

  const referrerUid = typeof data.referrerUid === 'string' ? data.referrerUid : '';
  if (!referrerUid) return { ok: false };

  // 首筆 completed 判定：current 訂單已被 patch 寫成 completed，故排除自身後若無其他 completed → 首筆
  const ordersSnap = await db.collection('orders').where('userId', '==', refereeUid).get();
  const hasOtherCompleted = ordersSnap.docs.some(
    (d) => d.id !== completedOrderId && d.data().orderStatus === 'completed',
  );
  if (!shouldQualifyReferral({ referralStatus: 'pending', isFirstCompletedOrder: !hasOtherCompleted })) {
    return { ok: false };
  }

  // 鑄推薦獎勵碼（ownerUid = 推薦人，design.md §4 ④）
  const campaign = await getReferralCampaign(db);
  const { code: rewardCode } = await mintDiscountCode(db, {
    source: 'referral-reward',
    ownerUid: referrerUid,
    discountAmount: campaign.rewardAmount,
    validUntilMs: Date.now() + campaign.rewardValidityDays * MS_PER_DAY,
    minFare: campaign.minFare,
    createdBy: 'referral-system',
  });

  try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(referralRef);
      const freshStatus = (fresh.data()?.status as ReferralStatus | undefined) ?? 'pending';
      if (freshStatus !== 'pending') throw new ReferralQualifyAbort();
      tx.update(referralRef, {
        status: 'rewarded',
        rewardCodeId: rewardCode,
        qualifiedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    // 競態落敗 → best-effort 刪除剛鑄的孤兒獎勵碼（清理失敗非致命）
    await db.collection('discount_codes').doc(rewardCode).delete().catch(() => { /* 忽略 */ });
    if (err instanceof ReferralQualifyAbort) return { ok: false };
    throw err;
  }

  return { ok: true, rewardCode, referrerUid };
}
