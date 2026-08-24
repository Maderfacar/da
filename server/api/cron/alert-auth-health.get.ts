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
import { notifyAdmins, type AdminNotifyResult } from '@@/utils/notify-admins';
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
  formatTaipei,
  type LoginHealthLogEntry,
} from '@@/utils/login-health';
import {
  buildAlertFingerprint,
  decideAlertDispatch,
  summarizeNotifyResults,
  shouldPersistDispatch,
  type AlertDispatchState,
} from '@@/utils/alert-dedup';

const COLLECTION = 'client_error_logs';
const MAX_DOCS = 5000; // 安全上限（常態約數十筆/日，遠低於此）避免 timeout
/** 去重狀態存放處：記錄上次推播的內容指紋與時間 */
const STATE_DOC = 'system_state/alert-auth-health';

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

    const docs = snap.docs.map((d) => d.data() as LoginHealthLogEntry & {
      event?: string;
      context?: { sessionId?: string | null } | null;
    });

    // ── 規則組 1（既有）：四個具名事件的筆數門檻 ───────────────────────
    // 傳整份 doc（而非只有 event 名）：chunkError 需要 context.sessionId 才能按事故去重
    const counts = tallyAuthHealthEvents(docs);
    const { breached, breaches } = evaluateAuthHealth(counts);

    // ── 規則組 2（新）：分路徑登入成功率 ─────────────────────────────
    // 低流量路徑 100% 失敗打不到任何筆數門檻，這是 2026-08-19 事故躲了 5 天的直接原因。
    const loginTally = tallyLoginOutcomes(docs);
    const loginBreaches = evaluateLoginSuccessRate(loginTally);

    // ── 規則組 3（新）：deny-by-default 未知錯誤事件 ──────────────────
    const unknownEvents = detectUnknownEvents(docs);

    // 帶入掃描區間：告警訊息要能讓收訊者分辨「同一批重複報」與「又壞一次」，
    // 而視窗重疊是重複報的來源，所以視窗本身也要寫在訊息裡（見 buildLoginHealthSummary 註解）。
    const scannedAt = new Date();
    const loginSummary = buildLoginHealthSummary(loginBreaches, unknownEvents, 5, {
      from: cutoff,
      to: scannedAt,
    });
    const loginBreached = loginSummary.length > 0;

    // ── 去重：同一批不重複推播 ───────────────────────────────────
    // 視窗重疊會讓同一批事件連報三到四次。過去這被當成「吵」，實際代價是
    // LINE 每月推播額度（按收件人計），2026-08-24 因此被打爆連累客人通知。
    // 掃描維持每小時（早點發現），但推播只在內容真的改變時發出。
    const fingerprint = buildAlertFingerprint(loginBreaches, unknownEvents);
    const stateRef = db.doc(STATE_DOC);
    let prevState: AlertDispatchState | null = null;
    try {
      const snapState = await stateRef.get();
      prevState = snapState.exists ? (snapState.data() as AlertDispatchState) : null;
    } catch (err) {
      // 讀不到狀態一律當作沒有紀錄 → 照常推播。寧可多叫，不可因基礎設施故障而靜音
      console.error('[cron/alert-auth-health] 讀取去重狀態失敗，改為照常推播:', err);
    }
    const anyBreached = breached || loginBreached;
    const dispatch = decideAlertDispatch(prevState, fingerprint, scannedAt.getTime());
    const shouldNotify = anyBreached && dispatch.send;

    // await（非 fire-and-forget）：serverless 於回應後凍結，需等推播完成
    // audience: 'super' —— 系統告警只送 super，把每月額度留給客人與司機通知
    const attempts: AdminNotifyResult[] = [];
    if (breached && shouldNotify) {
      attempts.push(await notifyAdmins(db, 'adminNotify.authHealthAlert', {
        authHealthWindowH: windowHours,
        authHealthRolesSlow: counts.rolesSlow,
        authHealthUserdocMissing: counts.userdocMissing,
        authHealthChunkError: counts.chunkError,
        authHealthLineExchangeBadStatus: counts.lineExchangeBadStatus,
      }, { audience: 'super' }));
    }
    if (loginBreached && shouldNotify) {
      attempts.push(await notifyAdmins(db, 'adminNotify.loginHealthAlert', {
        loginHealthWindowH: windowHours,
        loginHealthSummary: loginSummary,
      }, { audience: 'super' }));
    }
    const delivery = summarizeNotifyResults(attempts);
    // 只有**真的送達**才更新狀態 —— 記了狀態等於同一批 24 小時內不再發。
    // 2026-08-25 admin 通知改走 email 後，「決定要發」與「發出去了」不再是同一件事
    // （管道未設定時只留一行 warn），因此這裡必須看 notifyAdmins 的回報，不能看 shouldNotify。
    if (shouldPersistDispatch(shouldNotify, attempts)) {
      try {
        await stateRef.set({ fingerprint, lastSentAt: scannedAt.getTime() });
      } catch (err) {
        console.error('[cron/alert-auth-health] 寫入去重狀態失敗:', err);
      }
    }

    // 未授權（prod 未設 CRON_SECRET）時只回最小資訊：工作照跑、告警照發，但不外洩遙測明細
    if (!detailed) {
      return successResponse({
        ok: true,
        notified: shouldNotify,
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
      notified: shouldNotify,
      // 有越界但被去重抑制時 notified=false —— 這兩個欄位讓 Actions log 能分辨
      // 「沒事」與「有事但沒推播」，否則又會變成無法區分的 0
      suppressed: anyBreached && !dispatch.send,
      dispatchReason: dispatch.reason,
      // notified 只代表「決定要發」。送達與否要看這兩個 ——
      // email 管道未設定時 delivered=false / deliveryReason='no-key'，
      // 這是 Actions log 上唯一能看出「告警其實沒送出去」的地方。
      delivered: delivery.delivered,
      deliveryReason: delivery.reason,
      // 沒有告警的那些輪次不會有 delivery 可看，管道是否就緒仍要能一眼判斷：
      // 只回報「有沒有設」，不回報值（與設定健檢同一原則）。
      alertChannel: { emailConfigured: Boolean(config.resendApiKey || process.env.NUXT_RESEND_API_KEY) },
      fingerprint,
      cutoff: cutoff.toISOString(),
      // 台北時間版本：這份 JSON 會被 GitHub Actions 印進 log 供人事後回翻，
      // UTC 與台灣時間差 8 小時，逐次心算是判讀時最容易出錯的一步。
      windowTaipei: `${formatTaipei(cutoff)}–${formatTaipei(scannedAt)}`,
    });
  } catch (err) {
    console.error('[cron/alert-auth-health] failed:', err);
    return serverError();
  }
});
