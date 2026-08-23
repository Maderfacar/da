/**
 * 登入健康判定 — 純函式（login-health-observability Phase B）
 *
 * 取代「列舉幾種錯誤、數筆數」的判定方式，改為兩條規則：
 *
 *   1. **分路徑成功率**：ok ÷ (ok + fail)，依 metadata.route 分組。
 *      2026-08-19 事故 5 天只有 11 次嘗試、100% 失敗，卻打不到任何一個「錯誤筆數 >= 3~5」的門檻
 *      —— 低流量路徑徹底壞掉在筆數型監控下是結構性隱形的，而新上線的入口恰好流量最低。
 *      因此改判成功率，並刻意把 critical 門檻壓到「3 次嘗試全滅」。
 *
 *   2. **deny-by-default 未知事件**：維護「已知良性事件」清單，非清單內的 error/warn 事件一律告警。
 *      現況 auth-health-alert.ts 是反過來的（列舉要告警的四個事件名，其餘 default: break 略過），
 *      所以後來新增的埋點永遠不會觸發告警。方向一翻，漏列一項的後果就從「漏叫」變成「多叫一次」，
 *      而多叫一次就會被補進清單 —— 系統會自我收斂。
 *
 * 兩條規則與既有 auth-health-alert 的四項規則並存，任一越界即告警。
 */

/** 判定所需的 log 形狀（只取用得到的欄位，方便單測餵假資料）。 */
export interface LoginHealthLogEntry {
  event?: string | null;
  severity?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Firestore Timestamp / Date / ISO 字串 / epoch 毫秒皆可（由 toLogDate 正規化） */
  timestamp?: unknown;
}

/**
 * 把 log 的 timestamp 正規化為 Date。無法解析一律回 null（不猜、不用「現在」頂替
 * —— 用現在頂替會讓一筆沒有時間的舊紀錄看起來像剛剛才發生，比沒有時間更糟）。
 */
export function toLogDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // Firestore Timestamp：admin SDK 回傳的物件帶 toDate()
  const maybe = value as { toDate?: unknown };
  if (typeof maybe.toDate === 'function') {
    const d = (maybe as { toDate: () => unknown }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * 台北時區固定 UTC+8 —— 台灣自 1979 年起不再實施日光節約時間，故直接位移即可，
 * 不依賴 Intl/ICU（serverless runtime 的 ICU 完整度不保證，時區資料缺失時
 * Intl 會靜默回退成 UTC，那正是「看起來有換算、其實沒換」的無聲錯誤）。
 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 格式化為台北時間字串。
 * @param value 任何 toLogDate 能解析的值
 * @param withDate true（預設）→ `MM/DD HH:mm`；false → `HH:mm`
 * @returns 無法解析時回空字串（caller 據此省略時間欄位）
 */
export function formatTaipei(value: unknown, withDate = true): string {
  const d = toLogDate(value);
  if (!d) return '';
  const t = new Date(d.getTime() + TAIPEI_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hm = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return withDate ? `${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ${hm}` : hm;
}

export interface RouteTally {
  ok: number;
  fail: number;
  attempts: number;
  /** attempts 為 0 時為 null（沒人用 ≠ 壞掉，不可判定） */
  successRate: number | null;
}

export type LoginTally = Record<string, RouteTally>;

export const LOGIN_EVENT_OK = 'auth.login.ok';
export const LOGIN_EVENT_FAIL = 'auth.login.fail';

/** 3 次嘗試全滅即 critical —— 低流量路徑必須能觸發，這是本次事故被漏掉的直接原因。 */
export const CRITICAL_MIN_ATTEMPTS = 3;
/** 部分失敗的觀察門檻：樣本夠多才判，避免少量偶發誤報。 */
export const WARN_MIN_ATTEMPTS = 10;
export const WARN_RATE_THRESHOLD = 0.5;

/**
 * 依 metadata.route 分組統計登入成敗。
 * 無 route 或 route 非字串的紀錄一律歸入 `unknown` —— 不丟棄，否則新入口忘了標 route 會靜默消失。
 */
export function tallyLoginOutcomes(logs: ReadonlyArray<LoginHealthLogEntry>): LoginTally {
  const tally: LoginTally = {};
  const bump = (route: string, key: 'ok' | 'fail'): void => {
    const row = tally[route] ?? { ok: 0, fail: 0, attempts: 0, successRate: null };
    row[key] += 1;
    row.attempts = row.ok + row.fail;
    row.successRate = row.attempts > 0 ? row.ok / row.attempts : null;
    tally[route] = row;
  };

  for (const log of logs) {
    if (log?.event !== LOGIN_EVENT_OK && log?.event !== LOGIN_EVENT_FAIL) continue;
    const rawRoute = log.metadata?.route;
    const route = typeof rawRoute === 'string' && rawRoute ? rawRoute : 'unknown';
    bump(route, log.event === LOGIN_EVENT_OK ? 'ok' : 'fail');
  }
  return tally;
}

export interface LoginHealthBreach {
  route: string;
  level: 'critical' | 'warn';
  ok: number;
  fail: number;
  attempts: number;
  successRate: number;
}

/**
 * 依成功率判定各路徑健康。
 * - attempts >= 3 且 successRate === 0 → critical
 * - attempts >= 10 且 successRate < 0.5 → warn
 * - attempts === 0 → 不判定（沒人用不等於壞掉，避免半夜誤報）
 */
export function evaluateLoginSuccessRate(tally: LoginTally): LoginHealthBreach[] {
  const breaches: LoginHealthBreach[] = [];
  for (const [route, row] of Object.entries(tally)) {
    if (row.attempts === 0 || row.successRate === null) continue;
    const shared = { route, ok: row.ok, fail: row.fail, attempts: row.attempts, successRate: row.successRate };
    if (row.attempts >= CRITICAL_MIN_ATTEMPTS && row.successRate === 0) {
      breaches.push({ ...shared, level: 'critical' });
      continue;
    }
    if (row.attempts >= WARN_MIN_ATTEMPTS && row.successRate < WARN_RATE_THRESHOLD) {
      breaches.push({ ...shared, level: 'warn' });
    }
  }
  return breaches;
}

/**
 * 已知良性事件（deny-by-default 的反向清單）。
 *
 * 收錄兩種：① 正常運作時的高頻事件；② 已被其他規則涵蓋的事件（避免同一件事叫兩次）。
 * **漏列一項只會多叫一次告警，不會少叫** —— 這正是相對現況白名單的關鍵差異。
 * 收到誤報時把事件名補進來即可，不要反過來改成列舉需告警的事件。
 */
export const KNOWN_BENIGN_EVENTS: ReadonlySet<string> = new Set([
  // 正常導向與狀態還原（部分歷史埋點的 severity 是 error，但屬正常決策而非故障）
  'route.navigate',
  'auth.resolved.snapshot',
  'auth.session-cookie.seeded',
  'auth.liff.init.retry', // 換下一個 LIFF ID 重試，會自癒；真正失敗有 auth.liff.init.failed
  // 已被登入成功率規則涵蓋
  'auth.login.fail',
  // 已被 auth-health-alert 四項規則涵蓋
  'auth.roles.slow',
  'auth.userdoc.missing',
  'app.chunk-error',
  'auth.line-exchange.bad-status',
]);

/**
 * 良性事件前綴：導向決策本身不是故障（真正的登入失敗由成功率規則涵蓋），
 * 但歷史埋點把 middleware.redirect.* 記為 severity=error，不排除會每天誤報。
 */
export const KNOWN_BENIGN_PREFIXES: readonly string[] = ['middleware.redirect.'];

export interface UnknownEventReport {
  event: string;
  count: number;
  sampleMessage: string;
  /** 該事件最早 / 最新一筆的發生時間（ISO）。log 無 timestamp 時為 null。 */
  firstAt: string | null;
  lastAt: string | null;
}

/** 事件是否已知良性（精確比對 + 前綴比對）。 */
export function isBenignEvent(event: string): boolean {
  if (KNOWN_BENIGN_EVENTS.has(event)) return true;
  return KNOWN_BENIGN_PREFIXES.some((prefix) => event.startsWith(prefix));
}

/**
 * 找出所有「不在良性清單內」的 error / warn 事件型別。
 * 回傳依筆數由多到少排序，附一則樣本訊息供判讀。
 */
export function detectUnknownEvents(logs: ReadonlyArray<LoginHealthLogEntry>): UnknownEventReport[] {
  const acc = new Map<string, UnknownEventReport>();
  for (const log of logs) {
    const severity = log?.severity;
    if (severity !== 'error' && severity !== 'warn') continue;
    const event = typeof log.event === 'string' ? log.event : '';
    if (!event || isBenignEvent(event)) continue;
    const at = toLogDate(log.timestamp);
    const existing = acc.get(event);
    if (existing) {
      existing.count += 1;
      // 明確取 min/max，不假設輸入已排序 —— caller 換個 orderBy 就會靜默取錯頭尾
      if (at) {
        if (!existing.firstAt || at.toISOString() < existing.firstAt) existing.firstAt = at.toISOString();
        if (!existing.lastAt || at.toISOString() > existing.lastAt) existing.lastAt = at.toISOString();
      }
      continue;
    }
    acc.set(event, {
      event,
      count: 1,
      sampleMessage: String(log.message ?? '').slice(0, 200),
      firstAt: at ? at.toISOString() : null,
      lastAt: at ? at.toISOString() : null,
    });
  }
  return [...acc.values()].sort((a, b) => b.count - a.count);
}

/**
 * 把越界項目組成一段可讀摘要（放進 LINE 告警訊息）。
 * 純函式：路徑名與數字是技術識別碼，不做語系化；語系化的抬頭由 admin-notify-message 負責。
 * 回空字串代表沒有任何越界 —— caller 應據此判斷不發訊息。
 *
 * **時間為什麼一定要印**：掃描視窗刻意重疊（每小時掃 3h），同一批事件會連報約三次。
 * 訊息若只有事件名與筆數，「重複報」與「又壞一次」在收訊端完全無法分辨 —— 收訊者
 * 只能靠記憶比對筆數，而筆數會因舊事件滾出視窗而下降，看起來反而像新的一批。
 * 印出「最新一筆發生時間」後，判別規則變成單純一句話：**時間沒往前推進就是同一批**。
 *
 * @param window 掃描區間（選填），顯示於結尾，讓人知道這則告警涵蓋哪段時間
 */
export function buildLoginHealthSummary(
  breaches: ReadonlyArray<LoginHealthBreach>,
  unknownEvents: ReadonlyArray<UnknownEventReport>,
  maxUnknownListed = 5,
  window?: { from?: unknown; to?: unknown },
): string {
  const lines: string[] = [];

  for (const b of breaches) {
    const pct = Math.round(b.successRate * 100);
    const mark = b.level === 'critical' ? '🔴' : '🟠';
    lines.push(`${mark} ${b.route} 成功率 ${pct}%（${b.ok}/${b.attempts}）`);
  }

  if (unknownEvents.length > 0) {
    const listed = unknownEvents.slice(0, maxUnknownListed);
    lines.push(`❓ 未知錯誤事件 ${unknownEvents.length} 種：`);
    for (const u of listed) {
      lines.push(`  · ${u.event} ×${u.count}`);
      const timeLine = formatEventTimeRange(u);
      if (timeLine) lines.push(`    ${timeLine}`);
    }
    const rest = unknownEvents.length - listed.length;
    if (rest > 0) lines.push(`  · …另 ${rest} 種`);
  }

  if (lines.length === 0) return '';

  const windowLine = formatWindow(window);
  if (windowLine) lines.push(windowLine);

  return lines.join('\n');
}

/**
 * 單一事件的時間範圍行。最早與最新落在同一分鐘時只印一個時間
 * （多數告警是同一次故障的連續數筆，印成「16:53 → 16:53」只是雜訊）。
 */
function formatEventTimeRange(u: UnknownEventReport): string {
  const first = formatTaipei(u.firstAt);
  const last = formatTaipei(u.lastAt);
  if (!last) return '';
  if (!first || first === last) return `⏱ ${last}`;
  return `⏱ ${first} → ${last}`;
}

/** 掃描區間行。同一天時省略第二個日期。 */
function formatWindow(window?: { from?: unknown; to?: unknown }): string {
  if (!window) return '';
  const from = formatTaipei(window.from);
  const to = formatTaipei(window.to);
  if (!from || !to) return '';
  const sameDay = from.slice(0, 5) === to.slice(0, 5);
  return `🕐 掃描區間 ${from}–${sameDay ? to.slice(6) : to}（台北）`;
}
