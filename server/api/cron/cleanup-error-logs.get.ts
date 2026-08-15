// GET /api/cron/cleanup-error-logs — Vercel Cron 每日 janitor
//
// 每日清理兩類會無上限成長的 collection：
//   1. client_error_logs：刪 timestamp 早於保留邊界（現在 - 7 天）的舊 log
//   2. line_login_states：刪已過期的 server OAuth 登入 state（consume 成功即刪，但「按了
//      登入卻沒走完 callback」的殘留 doc 會累積）— 認證根治 P3.6-FU2
// 兩者皆分批 commit、單次執行上限避免 serverless timeout，剩餘留隔日續清（冪等）。
//
// ⚠️ line_login_states 清理刻意併進本 cron 呼叫、不新增 vercel.json cron 條目：
//    Vercel Hobby 方案 cron 上限 2 個，本專案已有 cleanup-error-logs + alert-auth-health 兩個。
//
// 排程：vercel.json crons（每日一次）。
// 保護：若設環境變數 CRON_SECRET，要求 Authorization: Bearer <CRON_SECRET>
//       （Vercel Cron 於觸發時會自動以該值注入此標頭）。未設則放行（out-of-box 可跑）。
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getErrorLogRetentionCutoff, ERROR_LOG_RETENTION_DAYS } from '@@/utils/error-log-retention';
import { purgeExpiredLoginStates } from '@@/utils/line-login-state';

const COLLECTION = 'client_error_logs';
const BATCH_SIZE = 400;          // Firestore WriteBatch 上限 500，留餘裕
const MAX_BATCHES_PER_RUN = 25;  // 單次最多刪 ~10k，避免 timeout；剩餘留隔日

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  // 保護：有設 secret 才驗（Vercel Cron 自動注入 Bearer <CRON_SECRET>）
  const secret = (config as { cronSecret?: string }).cronSecret;
  if (secret) {
    const authz = getHeader(event, 'authorization') ?? '';
    if (authz !== `Bearer ${secret}`) {
      return { data: {}, status: { code: 401, message: { zh_tw: '未授權', en: 'Unauthorized', ja: '未承認' } } };
    }
  }

  if (!config.firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const cutoff = getErrorLogRetentionCutoff(new Date());
    const col = db.collection(COLLECTION);

    let deleted = 0;
    let batches = 0;
    for (; batches < MAX_BATCHES_PER_RUN; batches++) {
      const snap = await col
        .where('timestamp', '<', cutoff)
        .orderBy('timestamp', 'asc')
        .limit(BATCH_SIZE)
        .get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;

      if (snap.size < BATCH_SIZE) break; // 最後一批
    }

    // 順帶清過期 line_login_states（併進本 janitor，見檔頭；失敗不影響 error-log 清理結果）
    let loginStates = { deleted: 0, batches: 0, hasMore: false };
    try {
      loginStates = await purgeExpiredLoginStates(db);
    } catch (err) {
      console.error('[cron/cleanup-error-logs] purgeExpiredLoginStates failed (non-fatal):', err);
    }

    return successResponse({
      ok: true,
      deleted,
      batches,
      retentionDays: ERROR_LOG_RETENTION_DAYS,
      cutoff: cutoff.toISOString(),
      hasMore: batches >= MAX_BATCHES_PER_RUN, // 達單次上限，仍有殘餘，隔日續清
      loginStates, // { deleted, batches, hasMore } — 過期登入 state 清理結果
    });
  } catch (err) {
    console.error('[cron/cleanup-error-logs] failed:', err);
    return serverError();
  }
});
