/**
 * 推薦獎勵機制 — referral domain util
 *
 * 設計：openspec/changes/2026-05-20-referral-share-reward/design.md
 *
 * 本檔涵蓋（Phase 1 — 資料模型基礎）：
 *   - referralCode 產生與全 users 唯一性檢查
 *   - users 推薦相關欄位型別 / 預設
 *   - referrals 帳本 doc 型別
 *   - referral_campaign/config 活動設定型別 / 預設 / 讀取
 *
 * 歸因綁定、資格判定、防刷檢查於 Phase 2 加入。
 */
import type { Timestamp, Firestore } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';

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
