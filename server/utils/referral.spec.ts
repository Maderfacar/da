import { describe, it, expect } from 'vitest';
import {
  generateReferralCode,
  normalizeReferralCampaign,
  DEFAULT_REFERRAL_CAMPAIGN,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_REGEX,
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
