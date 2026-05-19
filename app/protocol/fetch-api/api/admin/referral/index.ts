// 推薦獎勵機制 Phase 4：admin 推薦活動 API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  ReferralCampaignConfig,
  ReferralCampaignRes,
  ReferralRecordsRes,
} from './type.d';

export type {
  ReferralCampaignConfig,
  ReferralCampaignRes,
  ReferralRecordItem,
  ReferralRecordStatus,
  ReferralRecordsRes,
  ReferralShareCard,
} from './type.d';

/** 讀取推薦活動設定（kill-switch + 獎勵參數 + 分享卡） */
export const GetAdminReferralCampaign = () =>
  methods.get<ReferralCampaignRes>('/nuxt-api/admin/referral-campaign');

/** 更新推薦活動設定 */
export const PutAdminReferralCampaign = (body: ReferralCampaignConfig) =>
  methods.put<ReferralCampaignRes>(
    '/nuxt-api/admin/referral-campaign',
    body as unknown as Record<string, unknown>,
  );

/** 列推薦紀錄（含 effective status 與 anomaly flag） */
export const GetAdminReferralRecords = () =>
  methods.get<ReferralRecordsRes>('/nuxt-api/admin/referral-records');
