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

/** 計數所需的最小欄位：事件名，以及去重用的 sessionId。 */
export interface AuthHealthTallyEntry {
  event?: string | null;
  context?: { sessionId?: string | null } | null;
}

/**
 * 將一批 log 歸類計數。未知 / 空 event 一律略過。
 *
 * **chunkError 按 session 去重，其餘三項照筆數。**
 * 2026-08-25 prod 實例：一次部署讓單一分頁在 6 秒內寫入 19 筆 chunk 錯誤 ——
 * 兩個收集器（`vite:preloadError` / `app:chunkError`）各記一次，再乘上頁面上多個
 * lazy 元件。實際受影響的是 1 個人、1 次事故，且 P1 自癒立刻重載成功。
 * 門檻 3 對這種形狀毫無鑑別力：它量到的是 log 筆數，不是受影響人數。
 * 去重後語意變成「幾個 session 撞到」，門檻 3 才等於「三個人受影響」。
 * 真正的大規模事故（多人各撞一次）不會因此被漏掉。
 *
 * 其餘三項維持筆數：沒有「一次事故產生大量筆數」的證據，不臆測著改。
 * 缺 sessionId 的 chunk 錯誤無法去重 → 各自獨立計數（寧可多叫，不可靜音）。
 */
export function tallyAuthHealthEvents(entries: ReadonlyArray<AuthHealthTallyEntry>): AuthHealthCounts {
  const counts: AuthHealthCounts = { ...EMPTY_COUNTS };
  const chunkSessions = new Set<string>();
  let chunkWithoutSession = 0;

  for (const entry of entries) {
    switch (entry?.event) {
      case AUTH_HEALTH_EVENTS.rolesSlow: counts.rolesSlow++; break;
      case AUTH_HEALTH_EVENTS.userdocMissing: counts.userdocMissing++; break;
      case AUTH_HEALTH_EVENTS.chunkError: {
        const sid = entry.context?.sessionId;
        if (typeof sid === 'string' && sid !== '') chunkSessions.add(sid);
        else chunkWithoutSession++;
        break;
      }
      case AUTH_HEALTH_EVENTS.lineExchangeBadStatus: counts.lineExchangeBadStatus++; break;
      default: break; // 非監控事件略過
    }
  }

  counts.chunkError = chunkSessions.size + chunkWithoutSession;
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
