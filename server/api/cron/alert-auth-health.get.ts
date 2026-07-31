// GET /api/cron/alert-auth-health — Vercel Cron 主動掃認證健康事件，超門檻→LINE 告警 admin
//
// 乘客「看似登出」根治計畫 P2-1（2026-08-01）：把「等出事再查」升級為「系統自己喊」。
// 查 client_error_logs 近 24h 的 4 個「開啟流程壞掉」事件（auth.roles.slow /
// auth.userdoc.missing / app.chunk-error / auth.line-exchange.bad-status），任一超門檻
// 即由 notifyAdmins 推 LINE 給具 canManageOrders 的 admin（per-admin lang）。
// 沒超門檻回 successResponse 不發訊息（免噪音）。
//
// 排程：vercel.json crons（每小時 "0 * * * *"）。
//
// 保護：與 cleanup-error-logs 同範式 —— 有設 CRON_SECRET 才驗 Authorization: Bearer <secret>
//       （Vercel Cron 觸發時自動注入）。端點唯讀 + 只在越界時推播，即使被觸發風險亦低。
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { notifyAdmins } from '@@/utils/notify-admins';
import {
  tallyAuthHealthEvents,
  evaluateAuthHealth,
  AUTH_HEALTH_THRESHOLDS,
  AUTH_HEALTH_WINDOW_HOURS,
} from '@@/utils/auth-health-alert';

const COLLECTION = 'client_error_logs';
const LOOKBACK_MS = AUTH_HEALTH_WINDOW_HOURS * 60 * 60 * 1000;
const MAX_DOCS = 5000; // 安全上限（常態約數十筆/日，遠低於此）避免 timeout

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
    const cutoff = new Date(Date.now() - LOOKBACK_MS);

    // server admin SDK 支援 Timestamp 比較：where('timestamp','>=', Date) 自動轉 Timestamp。
    // 單一欄位不等式 + orderBy 同欄位，用自動索引，免建複合索引；事件歸類在記憶體做。
    const snap = await db.collection(COLLECTION)
      .where('timestamp', '>=', cutoff)
      .orderBy('timestamp', 'asc')
      .limit(MAX_DOCS)
      .get();

    const events = snap.docs.map((d) => (d.data() as { event?: string }).event);
    const counts = tallyAuthHealthEvents(events);
    const { breached, breaches } = evaluateAuthHealth(counts);

    if (breached) {
      // await（非 fire-and-forget）：serverless 於回應後凍結，需等推播完成
      await notifyAdmins(db, 'adminNotify.authHealthAlert', {
        authHealthWindowH: AUTH_HEALTH_WINDOW_HOURS,
        authHealthRolesSlow: counts.rolesSlow,
        authHealthUserdocMissing: counts.userdocMissing,
        authHealthChunkError: counts.chunkError,
        authHealthLineExchangeBadStatus: counts.lineExchangeBadStatus,
      });
    }

    return successResponse({
      ok: true,
      scanned: snap.size,
      windowHours: AUTH_HEALTH_WINDOW_HOURS,
      counts,
      thresholds: AUTH_HEALTH_THRESHOLDS,
      breached,
      breaches,
      notified: breached,
      cutoff: cutoff.toISOString(),
    });
  } catch (err) {
    console.error('[cron/alert-auth-health] failed:', err);
    return serverError();
  }
});
