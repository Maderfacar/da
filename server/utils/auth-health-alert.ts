// 認證健康告警 — 純邏輯（P2-1，2026-08-01）
//
// 乘客「看似登出」根治計畫的主動監控層：cron 每小時掃 client_error_logs 近 24h，
// 統計 4 個「開啟流程壞掉」事件的筆數，超門檻即由 cron 呼叫 notifyAdmins 發 LINE。
//
// 本檔只負責「事件歸類 + 門檻判定」純函式，方便單測；Firestore 查詢與推播在
// server/api/cron/alert-auth-health.get.ts。門檻為起步值，Brain AI 事後可調。

/** 被監控的 4 個事件字串（與 store-auth / error-handler 的 logAuth event 對齊） */
export const AUTH_HEALTH_EVENTS = {
  // authResolved 後 2.5s roles 仍空 —— 使用者看到訪客樣、誤判登出（本次事件主因）
  rolesSlow: 'auth.roles.slow',
  // users/{uid} doc 缺失 —— line-exchange 未落地或帳號異常
  userdocMissing: 'auth.userdoc.missing',
  // 舊版 chunk 撞新版 —— 白畫面（P1 已自癒 reload，但仍要監控頻率）
  chunkError: 'app.chunk-error',
  // LINE token 換發回非 200 —— 後端登入鏈路異常
  lineExchangeBadStatus: 'auth.line-exchange.bad-status',
} as const;

export interface AuthHealthCounts {
  rolesSlow: number;
  userdocMissing: number;
  chunkError: number;
  lineExchangeBadStatus: number;
}

/**
 * 告警門檻（起步值，Brain AI 事後可調）。
 * counts[key] >= threshold[key] 即視為該項越界。
 */
export const AUTH_HEALTH_THRESHOLDS: Readonly<AuthHealthCounts> = {
  rolesSlow: 5,
  chunkError: 3,
  userdocMissing: 1,
  lineExchangeBadStatus: 3,
};

/** 統計視窗小時數（供訊息文案顯示；實際 cutoff 由 cron 算） */
export const AUTH_HEALTH_WINDOW_HOURS = 24;

const EMPTY_COUNTS: AuthHealthCounts = {
  rolesSlow: 0,
  userdocMissing: 0,
  chunkError: 0,
  lineExchangeBadStatus: 0,
};

/**
 * 將一批 log 的 event 字串歸類計數。未知 / 空 event 一律略過。
 * @param events client_error_logs 各 doc 的 `event` 欄位（可能 undefined）
 */
export function tallyAuthHealthEvents(events: ReadonlyArray<string | undefined | null>): AuthHealthCounts {
  const counts: AuthHealthCounts = { ...EMPTY_COUNTS };
  for (const e of events) {
    switch (e) {
      case AUTH_HEALTH_EVENTS.rolesSlow: counts.rolesSlow++; break;
      case AUTH_HEALTH_EVENTS.userdocMissing: counts.userdocMissing++; break;
      case AUTH_HEALTH_EVENTS.chunkError: counts.chunkError++; break;
      case AUTH_HEALTH_EVENTS.lineExchangeBadStatus: counts.lineExchangeBadStatus++; break;
      default: break; // 非監控事件略過
    }
  }
  return counts;
}

export interface AuthHealthBreach {
  key: keyof AuthHealthCounts;
  count: number;
  threshold: number;
}

export interface AuthHealthEvaluation {
  breached: boolean;
  breaches: AuthHealthBreach[];
}

/**
 * 依門檻判定是否越界。任一項 count >= threshold 即 breached=true。
 * @param counts 各事件筆數
 * @param thresholds 門檻（預設 AUTH_HEALTH_THRESHOLDS）
 */
export function evaluateAuthHealth(
  counts: AuthHealthCounts,
  thresholds: Readonly<AuthHealthCounts> = AUTH_HEALTH_THRESHOLDS,
): AuthHealthEvaluation {
  const breaches: AuthHealthBreach[] = [];
  (Object.keys(thresholds) as (keyof AuthHealthCounts)[]).forEach((key) => {
    const count = counts[key];
    const threshold = thresholds[key];
    if (count >= threshold) breaches.push({ key, count, threshold });
  });
  return { breached: breaches.length > 0, breaches };
}
