/**
 * GET /nuxt-api/admin/referral-campaign
 *
 * 讀取推薦活動設定（design.md §3.3 / §6）。
 * doc 不存在時 getReferralCampaign 會以預設值 get-or-create。
 *
 * 權限：canManageFleet
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { getReferralCampaign } from '@@/utils/referral';

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

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const campaign = await getReferralCampaign(db);
    return successResponse({ campaign });
  } catch (err) {
    console.error('[admin/referral-campaign GET] failed:', err);
    return serverError();
  }
});
