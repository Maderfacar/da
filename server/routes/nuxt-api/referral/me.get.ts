/**
 * GET /nuxt-api/referral/me — 乘客自己的推薦資訊（推薦獎勵機制 Phase 3）
 *
 * 設計：openspec/changes/2026-05-20-referral-share-reward/design.md §6 / §C4
 *
 * require-auth（乘客）。回傳：
 *   - referralCode：自己的推薦碼
 *   - progress：推薦進度（我為 referrer 的 referrals，pending 套 lazy 過期換算）
 *   - codes：未用完且未過期的折扣碼清單（discount_codes where ownerUid == 我）
 *   - campaign：活動 enabled / 雙邊金額 / shareCard（分享頁組 Flex 用）
 *
 * pending lazy 過期：讀到 `pending && expiresAt<now` 視為 expired，best-effort 寫回。
 */
import type { Timestamp } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { effectiveReferralStatus, getReferralCampaign, type ReferralStatus } from '@@/utils/referral';
import type { DiscountCodeDoc } from '@@/utils/discount-code';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const nowMs = Date.now();

    // 自己的 referralCode（users doc）
    const userSnap = await db.collection('users').doc(auth.lineUid).get();
    const rawCode = userSnap.data()?.referralCode;
    const referralCode = typeof rawCode === 'string' ? rawCode : '';

    // 推薦進度：referrals where referrerUid == 我（單欄查詢，免 composite index）
    const referralsSnap = await db
      .collection('referrals')
      .where('referrerUid', '==', auth.lineUid)
      .get();

    let pending = 0;
    let rewarded = 0;
    const expiredWriteBacks: Promise<unknown>[] = [];
    for (const doc of referralsSnap.docs) {
      const data = doc.data();
      const status = (data.status as ReferralStatus | undefined) ?? 'pending';
      const expiresAtMs = (data.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      const effective = effectiveReferralStatus(status, expiresAtMs, nowMs);
      if (effective === 'pending') pending++;
      else if (effective === 'rewarded') rewarded++;
      // lazy 過期：順手寫回（best-effort，失敗非致命）
      if (status === 'pending' && effective === 'expired') {
        expiredWriteBacks.push(doc.ref.update({ status: 'expired' }).catch(() => undefined));
      }
    }
    if (expiredWriteBacks.length > 0) await Promise.all(expiredWriteBacks);

    // 未用折扣碼：discount_codes where ownerUid == 我（admin 碼無 ownerUid，不會 match）
    const codesSnap = await db
      .collection('discount_codes')
      .where('ownerUid', '==', auth.lineUid)
      .get();

    const codes = codesSnap.docs
      .map((d) => d.data() as Partial<DiscountCodeDoc>)
      .filter((c) => {
        if (c.enabled !== true) return false;
        const validUntilMs = (c.validUntil as Timestamp | undefined)?.toMillis?.() ?? 0;
        if (nowMs > validUntilMs) return false; // 已過期
        const max = typeof c.maxRedemptions === 'number' ? c.maxRedemptions : null;
        const used = typeof c.redemptionCount === 'number' ? c.redemptionCount : 0;
        if (max !== null && used >= max) return false; // 已用完
        return true;
      })
      .map((c) => ({
        code: typeof c.code === 'string' ? c.code : '',
        discountAmount: typeof c.discountAmount === 'number' ? c.discountAmount : 0,
        minFare: typeof c.minFare === 'number' ? c.minFare : null,
        validUntil: (c.validUntil as Timestamp | undefined)?.toDate?.()?.toISOString?.() ?? null,
        source:
          c.source === 'referral-welcome' || c.source === 'referral-reward'
            ? c.source
            : 'admin',
      }))
      // 即將到期者排前面
      .sort((a, b) => (a.validUntil ?? '').localeCompare(b.validUntil ?? ''));

    const campaign = await getReferralCampaign(db);

    return successResponse({
      referralCode,
      progress: { pending, rewarded, total: referralsSnap.size },
      codes,
      campaign: {
        enabled: campaign.enabled,
        welcomeAmount: campaign.welcomeAmount,
        rewardAmount: campaign.rewardAmount,
        shareCard: campaign.shareCard,
      },
    });
  } catch (err) {
    console.error('[referral/me GET] failed:', err);
    return serverError();
  }
});
