// GET /api/cron/alert-auth-health — Vercel Cron 主動掃認證健康事件，超門檻→LINE 告警 admin
//
// 乘客「看似登出」根治計畫 P2-1（2026-08-01）：把「等出事再查」升級為「系統自己喊」。
// 查 client_error_logs 近 24h 的 4 個「開啟流程壞掉」事件（auth.roles.slow /
// auth.userdoc.missing / app.chunk-error / auth.line-exchange.bad-status），任一超門檻
// 即由 notifyAdmins 推 LINE 給具 canManageOrders 的 admin（per-admin lang）。
// 沒超門檻回 successResponse 不發訊息（免噪音）。
//
// 排程：vercel.json crons（每日一次 "0 1 * * *" = 台灣早上 9 點）。
//       Vercel Hobby 方案 cron 每天僅能觸發一次、且上限 2 條，故用每日；每日剛好對到
//       一個完整 24h 窗口，比每小時重複掃同段時間更乾淨（不重複告警）。
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
import {
  tallyLoginOutcomes,
  evaluateLoginSuccessRate,
  detectUnknownEvents,
  buildLoginHealthSummary,
  type LoginHealthLogEntry,
} from '@@/utils/login-health';

const COLLECTION = 'client_error_logs';
const MAX_DOCS = 5000; // 安全上限（常態約數十筆/日，遠低於此）避免 timeout

/**
 * 統計視窗（小時）。Vercel 每日 cron 用預設 24；GitHub Actions 每小時排程帶 ?hours=3
 * （重疊容忍重複告警 —— 本端點寧可多叫，不做去重）。
 */
function resolveWindowHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return AUTH_HEALTH_WINDOW_HOURS;
  return Math.min(n, AUTH_HEALTH_WINDOW_HOURS);
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  // 保護：有設 secret 才驗（Vercel Cron 自動注入 Bearer <CRON_SECRET>）。
  //
  // ⚠️ 這裡刻意「未設 secret 時仍執行」而非 fail-closed：Vercel Cron 在未設 CRON_SECRET 時
  // 不會帶 Authorization，改成 fail-closed 會把每日告警整個關掉 —— 那是唯一還在運作的偵測。
  // 但**回應內容**要分開處理：本端點回傳登入成功率、未知事件名等營運遙測，未授權者不該看到。
  // 因此未授權時照常執行與推播，只回最小資訊（見下方 detailed 判斷）。
  const secret = (config as { cronSecret?: string }).cronSecret;
  const authz = getHeader(event, 'authorization') ?? '';
  if (secret && authz !== `Bearer ${secret}`) {
    return { data: {}, status: { code: 401, message: { zh_tw: '未授權', en: 'Unauthorized', ja: '未承認' } } };
  }
  const detailed = Boolean(secret); // 有設 secret 且通過驗證才給明細

  if (!config.firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const windowHours = resolveWindowHours(getQuery(event).hours);
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    // server admin SDK 支援 Timestamp 比較：where('timestamp','>=', Date) 自動轉 Timestamp。
    // 單一欄位不等式 + orderBy 同欄位，用自動索引，免建複合索引；事件歸類在記憶體做。
    const snap = await db.collection(COLLECTION)
      .where('timestamp', '>=', cutoff)
      .orderBy('timestamp', 'asc')
      .limit(MAX_DOCS)
      .get();

    const docs = snap.docs.map((d) => d.data() as LoginHealthLogEntry & { event?: string });

    // ── 規則組 1（既有）：四個具名事件的筆數門檻 ───────────────────────
    const counts = tallyAuthHealthEvents(docs.map((d) => d.event));
    const { breached, breaches } = evaluateAuthHealth(counts);

    // ── 規則組 2（新）：分路徑登入成功率 ─────────────────────────────
    // 低流量路徑 100% 失敗打不到任何筆數門檻，這是 2026-08-19 事故躲了 5 天的直接原因。
    const loginTally = tallyLoginOutcomes(docs);
    const loginBreaches = evaluateLoginSuccessRate(loginTally);

    // ── 規則組 3（新）：deny-by-default 未知錯誤事件 ──────────────────
    const unknownEvents = detectUnknownEvents(docs);

    const loginSummary = buildLoginHealthSummary(loginBreaches, unknownEvents);
    const loginBreached = loginSummary.length > 0;

    // await（非 fire-and-forget）：serverless 於回應後凍結，需等推播完成
    if (breached) {
      await notifyAdmins(db, 'adminNotify.authHealthAlert', {
        authHealthWindowH: windowHours,
        authHealthRolesSlow: counts.rolesSlow,
        authHealthUserdocMissing: counts.userdocMissing,
        authHealthChunkError: counts.chunkError,
        authHealthLineExchangeBadStatus: counts.lineExchangeBadStatus,
      });
    }
    if (loginBreached) {
      await notifyAdmins(db, 'adminNotify.loginHealthAlert', {
        loginHealthWindowH: windowHours,
        loginHealthSummary: loginSummary,
      });
    }

    // 未授權（prod 未設 CRON_SECRET）時只回最小資訊：工作照跑、告警照發，但不外洩遙測明細
    if (!detailed) {
      return successResponse({
        ok: true,
        notified: breached || loginBreached,
        detail: 'omitted (CRON_SECRET 未設定)',
      });
    }

    return successResponse({
      ok: true,
      scanned: snap.size,
      windowHours,
      counts,
      thresholds: AUTH_HEALTH_THRESHOLDS,
      breached,
      breaches,
      loginTally,
      loginBreaches,
      unknownEvents,
      loginBreached,
      notified: breached || loginBreached,
      cutoff: cutoff.toISOString(),
    });
  } catch (err) {
    console.error('[cron/alert-auth-health] failed:', err);
    return serverError();
  }
});
