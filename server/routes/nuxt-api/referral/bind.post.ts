/**
 * POST /nuxt-api/referral/bind — 推薦歸因綁定（推薦獎勵機制 Phase 2）
 *
 * 設計：openspec/changes/2026-05-20-referral-share-reward/design.md §4 ③ / §5 / §6
 *
 * body { ref }：被推薦人帶推薦碼進入平台後呼叫。
 * 防刷六項檢查（§5）通過 → 寫 referredBy（write-once）+ 建 referrals(pending)
 * + 鑄歡迎碼 + welcomeRewardClaimed=true，並推播被推薦人歡迎碼。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, badRequestError, serverError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import {
  bindReferral,
  REFERRAL_BIND_FAIL_MESSAGES,
  REFERRAL_CODE_REGEX,
} from '@@/utils/referral';
import { getUserLang } from '@@/utils/user-lang';
import { sendLinePush } from '@@/utils/line-push';

interface BindReferralBody {
  ref?: string;
}

export default defineEventHandler(async (event) => {
  // require-auth（乘客）：被推薦人須先登入
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const body = await readBody<BindReferralBody>(event);
  const ref = typeof body.ref === 'string' ? body.ref.trim().toUpperCase() : '';
  if (!ref || !REFERRAL_CODE_REGEX.test(ref)) {
    return badRequestError({
      zh_tw: '推薦碼格式錯誤',
      en: 'Invalid referral code format',
      ja: '紹介コードの形式が正しくありません',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError();
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const result = await bindReferral(db, { ref, refereeUid: auth.lineUid });

    if (!result.ok) {
      // 防刷檢查未通過：回對應三語訊息（含「此優惠僅限新加入的好友」§8）
      return badRequestError(REFERRAL_BIND_FAIL_MESSAGES[result.failCode]);
    }

    // 歡迎碼推播（fire-and-forget；失敗不影響綁定成立；依被推薦人語系）
    // W4：getReferralPushMessage 已隨 i18n-message 拔除，hardcoded 三語直寫
    void (async () => {
      try {
        const lang = await getUserLang(db, auth.lineUid);
        const welcomeText =
          lang === 'en'
            ? `👋 Welcome aboard!\nYour welcome discount code: ${result.welcomeCode}\nApply it on your first booking to enjoy the discount.`
            : lang === 'ja'
              ? `👋 ようこそ！\n新規限定割引コード：${result.welcomeCode}\n初回のご予約でご利用いただけます。`
              : `👋 歡迎加入！\n您的新人專屬折扣碼：${result.welcomeCode}\n首次訂車輸入即可折抵，期待為您服務。`;
        await sendLinePush('passenger', auth.lineUid, [{
          type: 'text',
          text: welcomeText,
        }]);
      } catch (err) {
        console.error('[referral/bind] welcome push failed:', err);
      }
    })();

    return successResponse({ bound: true, welcomeCode: result.welcomeCode });
  } catch (err) {
    console.error('[referral/bind] failed:', err);
    return serverError();
  }
});
