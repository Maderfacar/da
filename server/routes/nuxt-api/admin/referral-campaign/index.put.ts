/**
 * PUT /nuxt-api/admin/referral-campaign
 *
 * 更新推薦活動設定（design.md §3.3 / §6）：kill-switch enabled、獎勵參數、
 * pending TTL、異常門檻與分享卡內容。
 *
 * Body：完整 ReferralCampaignConfig（enabled / welcomeAmount / rewardAmount /
 *   welcomeValidityDays / rewardValidityDays / minFare / pendingTtlDays /
 *   anomalyThreshold / shareCard）。數值欄位由 validateReferralCampaignBody 驗證。
 *
 * 權限：canManageFleet
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError, badRequestError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  validateReferralCampaignBody,
  REFERRAL_CAMPAIGN_COLLECTION,
  REFERRAL_CAMPAIGN_DOC_ID,
} from '@@/utils/referral';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({
      zh_tw: '需要車隊管理權限',
      en: 'canManageFleet required',
      ja: '車両管理権限が必要です',
    });
  }

  const body = await readBody<Record<string, unknown>>(event);
  const valid = validateReferralCampaignBody(body ?? {});
  if (!valid.ok) return badRequestError(valid.error);

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection(REFERRAL_CAMPAIGN_COLLECTION).doc(REFERRAL_CAMPAIGN_DOC_ID);
    await ref.set(
      {
        ...valid.value,
        updatedBy: auth.lineUid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return successResponse({ campaign: valid.value });
  } catch (err) {
    console.error('[admin/referral-campaign PUT] failed:', err);
    return serverError();
  }
});
