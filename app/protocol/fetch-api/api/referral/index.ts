// 推薦獎勵機制 Phase 3：乘客端推薦 API
import methods from '@/protocol/fetch-api/methods';
import type { ReferralMeRes } from './type.d';

export type {
  ReferralMeRes,
  ReferralProgress,
  ReferralCodeItem,
  ReferralCodeSource,
  ReferralShareCard,
  ReferralCampaignPublic,
} from './type.d';

/** 取得自己的推薦碼、推薦進度、未用折扣碼與分享活動設定 */
export const GetReferralMe = () => methods.get<ReferralMeRes>('/nuxt-api/referral/me');
