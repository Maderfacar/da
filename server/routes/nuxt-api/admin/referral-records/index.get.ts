/**
 * GET /nuxt-api/admin/referral-records
 *
 * 列出推薦紀錄（design.md §5 D3 / §6）。
 *
 * 每列：
 *   - 套 effectiveReferralStatus lazy 過期換算（pending 已過 expiresAt → expired）。
 *   - 計算該 referrerUid 的「effective rewarded 數」；超過活動設定 anomalyThreshold
 *     即標 anomaly flag（design §5：不擋綁定，僅標記供 admin 紅字提示）。
 *
 * 排序：createdAt DESC（最新在前）。
 * referrals collection 全量讀取（單人 rewarded 數需跨全集合統計）。
 *
 * 權限：canManageFleet
 */
import type { Timestamp } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  getReferralCampaign,
  effectiveReferralStatus,
  type ReferralStatus,
  type ReferralDoc,
} from '@@/utils/referral';

interface ReferralRecordDto {
  refereeUid: string;
  referrerUid: string;
  referrerCode: string;
  /** 有效狀態（已套 lazy 過期換算）。 */
  status: ReferralStatus;
  welcomeCodeId: string | null;
  rewardCodeId: string | null;
  createdAt: number | null;
  qualifiedAt: number | null;
  expiresAt: number | null;
  /** 該推薦人的 effective rewarded 數。 */
  referrerRewardedCount: number;
  /** rewarded 數超過 anomalyThreshold。 */
  anomaly: boolean;
}

const _tsMs = (v: unknown): number | null => (v as Timestamp | undefined)?.toMillis?.() ?? null;

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
    const snap = await db.collection('referrals').get();
    const now = Date.now();

    interface Row {
      refereeUid: string;
      data: Partial<ReferralDoc>;
      effective: ReferralStatus;
    }

    // 第一輪：套 lazy 過期 + 統計每位 referrer 的 effective rewarded 數
    const rewardedCount = new Map<string, number>();
    const rows: Row[] = snap.docs.map((doc) => {
      const data = doc.data() as Partial<ReferralDoc>;
      const status = (data.status as ReferralStatus | undefined) ?? 'pending';
      const expiresAtMs = _tsMs(data.expiresAt) ?? 0;
      const effective = effectiveReferralStatus(status, expiresAtMs, now);
      if (effective === 'rewarded' && typeof data.referrerUid === 'string') {
        rewardedCount.set(data.referrerUid, (rewardedCount.get(data.referrerUid) ?? 0) + 1);
      }
      return { refereeUid: doc.id, data, effective };
    });

    // 第二輪：組 DTO + anomaly flag
    const items: ReferralRecordDto[] = rows
      .map((r) => {
        const referrerUid = typeof r.data.referrerUid === 'string' ? r.data.referrerUid : '';
        const count = referrerUid ? (rewardedCount.get(referrerUid) ?? 0) : 0;
        return {
          refereeUid: r.refereeUid,
          referrerUid,
          referrerCode: typeof r.data.referrerCode === 'string' ? r.data.referrerCode : '',
          status: r.effective,
          welcomeCodeId: typeof r.data.welcomeCodeId === 'string' ? r.data.welcomeCodeId : null,
          rewardCodeId: typeof r.data.rewardCodeId === 'string' ? r.data.rewardCodeId : null,
          createdAt: _tsMs(r.data.createdAt),
          qualifiedAt: _tsMs(r.data.qualifiedAt),
          expiresAt: _tsMs(r.data.expiresAt),
          referrerRewardedCount: count,
          anomaly: count > campaign.anomalyThreshold,
        };
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    return successResponse({ items, anomalyThreshold: campaign.anomalyThreshold });
  } catch (err) {
    console.error('[admin/referral-records GET] failed:', err);
    return serverError();
  }
});
