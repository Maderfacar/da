// 推薦獎勵機制 Phase 3：乘客端推薦 API 型別
// 對齊 server/routes/nuxt-api/referral/me.get.ts 回傳結構

/** 折扣碼來源（對齊 server/utils/discount-code.ts DiscountCodeSource） */
export type ReferralCodeSource = 'admin' | 'referral-welcome' | 'referral-reward';

/** 未用折扣碼清單項目（/referral/me 回傳的精簡 shape） */
export interface ReferralCodeItem {
  code: string;
  discountAmount: number;
  minFare: number | null;
  validUntil: string | null;
  source: ReferralCodeSource;
}

/** 推薦進度 */
export interface ReferralProgress {
  pending: number;
  rewarded: number;
  total: number;
}

/** 分享活動 Flex 卡內容（對齊 server/utils/referral.ts ReferralShareCard） */
export interface ReferralShareCard {
  title: string;
  imageUrl: string;
  body: string;
  ctaLabel: string;
}

/** 推薦活動公開設定（分享頁 / 提示卡用） */
export interface ReferralCampaignPublic {
  enabled: boolean;
  welcomeAmount: number;
  rewardAmount: number;
  shareCard: ReferralShareCard;
}

/** GET /nuxt-api/referral/me 回傳 */
export interface ReferralMeRes {
  referralCode: string;
  progress: ReferralProgress;
  codes: ReferralCodeItem[];
  campaign: ReferralCampaignPublic;
}
