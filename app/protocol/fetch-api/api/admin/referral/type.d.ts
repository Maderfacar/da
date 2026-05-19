// 推薦獎勵機制 Phase 4：admin 推薦活動 API 型別
//
// 對齊 server/utils/referral.ts ReferralCampaignConfig / ReferralShareCard
// 與 server/routes/nuxt-api/admin/referral-campaign|referral-records/*

/** 分享活動 Flex 卡內容（design.md §3.3 shareCard） */
export interface ReferralShareCard {
  title: string;
  imageUrl: string;
  body: string;
  ctaLabel: string;
}

/** 推薦活動設定（admin 完整版） */
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
  /** 單人推薦數異常軟門檻（紀錄頁紅字提示用） */
  anomalyThreshold: number;
  /** 分享 Flex 卡內容 */
  shareCard: ReferralShareCard;
}

/** GET / PUT /nuxt-api/admin/referral-campaign 回傳 */
export interface ReferralCampaignRes {
  campaign: ReferralCampaignConfig;
}

/** 推薦生命週期狀態（effective，已套 lazy 過期） */
export type ReferralRecordStatus = 'pending' | 'qualified' | 'rewarded' | 'expired';

/** 推薦紀錄列（時間欄位為 epoch ms） */
export interface ReferralRecordItem {
  refereeUid: string;
  referrerUid: string;
  referrerCode: string;
  status: ReferralRecordStatus;
  welcomeCodeId: string | null;
  rewardCodeId: string | null;
  createdAt: number | null;
  qualifiedAt: number | null;
  expiresAt: number | null;
  /** 該推薦人的 effective rewarded 數 */
  referrerRewardedCount: number;
  /** rewarded 數超過 anomalyThreshold */
  anomaly: boolean;
}

/** GET /nuxt-api/admin/referral-records 回傳 */
export interface ReferralRecordsRes {
  items: ReferralRecordItem[];
  anomalyThreshold: number;
}
