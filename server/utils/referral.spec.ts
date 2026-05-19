import { describe, it, expect } from 'vitest';
import {
  generateReferralCode,
  normalizeReferralCampaign,
  DEFAULT_REFERRAL_CAMPAIGN,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_REGEX,
  checkReferralBindEligibility,
  effectiveReferralStatus,
  shouldQualifyReferral,
  type ReferralBindCheckInput,
} from './referral';

describe('generateReferralCode', () => {
  it('產生 6 碼大寫英數字串', () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(REFERRAL_CODE_REGEX.test(code)).toBe(true);
  });

  it('不含易混淆字元（0/O/1/I/L）', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateReferralCode()).not.toMatch(/[01OIL]/);
    }
  });
});

describe('normalizeReferralCampaign', () => {
  it('undefined 回完整預設值', () => {
    expect(normalizeReferralCampaign(undefined)).toEqual(DEFAULT_REFERRAL_CAMPAIGN);
  });

  it('缺漏欄位以預設值補齊', () => {
    const r = normalizeReferralCampaign({ welcomeAmount: 300 });
    expect(r.welcomeAmount).toBe(300);
    expect(r.rewardAmount).toBe(DEFAULT_REFERRAL_CAMPAIGN.rewardAmount);
    expect(r.minFare).toBe(DEFAULT_REFERRAL_CAMPAIGN.minFare);
  });

  it('enabled 僅在嚴格 true 時為 true', () => {
    expect(normalizeReferralCampaign({ enabled: true }).enabled).toBe(true);
    expect(normalizeReferralCampaign({ enabled: 'true' }).enabled).toBe(false);
    expect(normalizeReferralCampaign({}).enabled).toBe(false);
  });

  it('非數字欄位 fallback 預設值', () => {
    const r = normalizeReferralCampaign({ rewardAmount: 'abc', pendingTtlDays: null });
    expect(r.rewardAmount).toBe(DEFAULT_REFERRAL_CAMPAIGN.rewardAmount);
    expect(r.pendingTtlDays).toBe(DEFAULT_REFERRAL_CAMPAIGN.pendingTtlDays);
  });

  it('shareCard 缺漏欄位補空字串', () => {
    const r = normalizeReferralCampaign({ shareCard: { title: '邀你同行' } });
    expect(r.shareCard.title).toBe('邀你同行');
    expect(r.shareCard.imageUrl).toBe('');
    expect(r.shareCard.body).toBe('');
    expect(r.shareCard.ctaLabel).toBe('');
  });
});

describe('checkReferralBindEligibility', () => {
  const base: ReferralBindCheckInput = {
    campaignEnabled: true,
    referrerUid: 'Uref',
    refereeUid: 'Unew',
    existingReferredBy: null,
    refereeHasOrders: false,
  };

  it('五項皆通過 → ok 並回 referrerUid', () => {
    expect(checkReferralBindEligibility(base)).toEqual({ ok: true, referrerUid: 'Uref' });
  });

  it('活動未開放 → CAMPAIGN_DISABLED', () => {
    const r = checkReferralBindEligibility({ ...base, campaignEnabled: false });
    expect(r).toEqual({ ok: false, code: 'CAMPAIGN_DISABLED' });
  });

  it('推薦碼查無使用者 → INVALID_REF', () => {
    const r = checkReferralBindEligibility({ ...base, referrerUid: null });
    expect(r).toEqual({ ok: false, code: 'INVALID_REF' });
  });

  it('推薦自己 → SELF_REFERRAL', () => {
    const r = checkReferralBindEligibility({ ...base, referrerUid: 'Unew' });
    expect(r).toEqual({ ok: false, code: 'SELF_REFERRAL' });
  });

  it('已綁定過 referredBy → ALREADY_BOUND', () => {
    const r = checkReferralBindEligibility({ ...base, existingReferredBy: 'Uother' });
    expect(r).toEqual({ ok: false, code: 'ALREADY_BOUND' });
  });

  it('被推薦人已有訂單（非全新帳號）→ NOT_NEW_USER', () => {
    const r = checkReferralBindEligibility({ ...base, refereeHasOrders: true });
    expect(r).toEqual({ ok: false, code: 'NOT_NEW_USER' });
  });

  it('檢查順序：活動未開放優先於其他失敗', () => {
    const r = checkReferralBindEligibility({
      campaignEnabled: false,
      referrerUid: null,
      refereeUid: 'Unew',
      existingReferredBy: 'Uother',
      refereeHasOrders: true,
    });
    expect(r).toEqual({ ok: false, code: 'CAMPAIGN_DISABLED' });
  });
});

describe('effectiveReferralStatus', () => {
  const NOW = Date.UTC(2026, 4, 20, 0, 0, 0);
  const DAY = 86_400_000;

  it('pending 未過期 → pending', () => {
    expect(effectiveReferralStatus('pending', NOW + DAY, NOW)).toBe('pending');
  });

  it('pending 已過期 → expired', () => {
    expect(effectiveReferralStatus('pending', NOW - DAY, NOW)).toBe('expired');
  });

  it('pending 恰在 expiresAt 邊界（now == expiresAt）→ 仍 pending', () => {
    expect(effectiveReferralStatus('pending', NOW, NOW)).toBe('pending');
  });

  it('rewarded 不受過期影響', () => {
    expect(effectiveReferralStatus('rewarded', NOW - DAY, NOW)).toBe('rewarded');
  });

  it('已是 expired 原樣回傳', () => {
    expect(effectiveReferralStatus('expired', NOW - DAY, NOW)).toBe('expired');
  });

  it('qualified 不受過期影響', () => {
    expect(effectiveReferralStatus('qualified', NOW - DAY, NOW)).toBe('qualified');
  });
});

describe('shouldQualifyReferral', () => {
  it('pending + 首筆 completed → true', () => {
    expect(shouldQualifyReferral({ referralStatus: 'pending', isFirstCompletedOrder: true })).toBe(true);
  });

  it('pending 但非首筆 completed → false', () => {
    expect(shouldQualifyReferral({ referralStatus: 'pending', isFirstCompletedOrder: false })).toBe(false);
  });

  it('無推薦紀錄（null）→ false', () => {
    expect(shouldQualifyReferral({ referralStatus: null, isFirstCompletedOrder: true })).toBe(false);
  });

  it('已 rewarded → false（避免重複發碼）', () => {
    expect(shouldQualifyReferral({ referralStatus: 'rewarded', isFirstCompletedOrder: true })).toBe(false);
  });

  it('已 expired → false', () => {
    expect(shouldQualifyReferral({ referralStatus: 'expired', isFirstCompletedOrder: true })).toBe(false);
  });
});
