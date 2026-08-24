/**
 * 告警去重與降頻 — 純函式
 *
 * 為什麼需要：偵測視窗刻意重疊（每小時掃 3h），同一批事件會連報三到四次。
 * 這在設計時被理解為「人會覺得吵」，實際代價卻是 **LINE 每月推播額度** ——
 * 每則告警乘上收件人數，2026-08-24 直接把乘客 OA 的月額度打爆（429），
 * 連帶客人的訂單通知一起發不出去。偵測頻率與**推播**頻率必須拆開：
 * 掃描可以照樣每小時（早點發現），但同一批只該推一次。
 *
 * **降頻不是消音**（本專案吃過偵測值恆為 0 的虧）：
 *   - 內容有變（新事件種類、最新時間推進）→ 立刻發，不受任何限制
 *   - 內容相同 → 抑制，但超過 ALERT_REMINDER_MS 仍再提醒一次，
 *     否則一個長期未解的問題會在第一次之後永遠消失
 *   - 狀態讀取異常（毀損、時鐘飄移）→ 一律發送。**寧可多叫，不可靜音**
 */
import type { LoginHealthBreach, UnknownEventReport } from '@@/utils/login-health';

/** 同一批告警的重複提醒間隔：24 小時。問題還在就每天提醒一次。 */
export const ALERT_REMINDER_MS = 24 * 60 * 60 * 1000;

export interface AlertDispatchState {
  fingerprint: string;
  lastSentAt: number;
}

export type AlertDispatchReason = 'new' | 'changed' | 'reminder' | 'duplicate';

export interface AlertDispatchDecision {
  send: boolean;
  reason: AlertDispatchReason;
}

/**
 * 產生一批告警的內容指紋。
 *
 * **刻意不納入筆數**：筆數會因舊事件滾出視窗而下降（3 → 2），那是視窗滑動、
 * 不是新故障。納入筆數會讓同一批每次都被判定為「有變」，去重完全失效。
 * 納入的是「有哪些事件種類」與「各自最新一筆的時間」—— 後者推進才代表真的又發生了。
 *
 * 事件先依名稱排序：detectUnknownEvents 的輸出依筆數排序，而筆數會變動，
 * 直接串接會讓順序影響指紋。
 */
export function buildAlertFingerprint(
  breaches: ReadonlyArray<LoginHealthBreach>,
  unknownEvents: ReadonlyArray<UnknownEventReport>,
): string {
  const events = [...unknownEvents]
    .map((u) => `${u.event}@${u.lastAt ?? '-'}`)
    .sort()
    .join(',');
  const rates = [...breaches]
    .map((b) => `${b.route}:${b.level}`)
    .sort()
    .join(',');
  return `e[${events}]r[${rates}]`;
}

/**
 * 決定這批告警要不要推播。
 * @param prev 上次推播的狀態（Firestore 讀出；無紀錄傳 null）
 * @param fingerprint 本次內容指紋
 * @param now 現在時間（epoch ms）
 * @param reminderMs 重複提醒間隔（預設 ALERT_REMINDER_MS）
 */
export function decideAlertDispatch(
  prev: AlertDispatchState | null | undefined,
  fingerprint: string,
  now: number,
  reminderMs: number = ALERT_REMINDER_MS,
): AlertDispatchDecision {
  if (!prev || typeof prev.fingerprint !== 'string') return { send: true, reason: 'new' };
  if (prev.fingerprint !== fingerprint) return { send: true, reason: 'changed' };

  const last = prev.lastSentAt;
  // 狀態毀損或時鐘飄移（未來時間）：寧可多叫一次，也不要因為狀態壞掉而永久靜音
  if (typeof last !== 'number' || !Number.isFinite(last) || last > now) {
    return { send: true, reason: 'reminder' };
  }
  if (now - last >= reminderMs) return { send: true, reason: 'reminder' };
  return { send: false, reason: 'duplicate' };
}

/**
 * 一次推播嘗試的結果。刻意用最小結構型別（不 import notify-admins）——
 * 那支帶 Nuxt 全域（useRuntimeConfig），單元測試載不起來。
 */
export interface NotifyAttempt {
  delivered: boolean;
  reason?: string;
}

export interface DeliverySummary {
  delivered: boolean;
  /** 未送達的原因，供 Actions log 一眼判讀（'not-attempted' = 這輪沒要發） */
  reason?: string;
}

/** 彙整一輪的推播結果。任一封沒送達即視為未送達 —— 見 shouldPersistDispatch。 */
export function summarizeNotifyResults(results: ReadonlyArray<NotifyAttempt>): DeliverySummary {
  if (results.length === 0) return { delivered: false, reason: 'not-attempted' };
  const failed = results.find((r) => !r.delivered);
  if (failed) return { delivered: false, reason: failed.reason ?? 'error' };
  return { delivered: true };
}

/**
 * 決定要不要把這次推播記進去重狀態。
 *
 * **為什麼不能只看「有沒有決定要發」**：去重狀態一旦寫入，同指紋 24 小時內都會被
 * 抑制。若推播其實失敗（例如 email 管道未設定），卻仍記為「已通知」，那批告警就
 * 在收訊者從未看到的情況下被吞掉 —— 而且等管道修好後仍然收不到，因為已被抑制。
 * 2026-08-25 admin 通知改走 email 後 notifyAdmins 不再讓呼叫端知道成敗，
 * 端點原本的註解（「只有真的推播出去才更新狀態」）就此與實作脫節。
 *
 * 沒送達 → 不記狀態 → 下一輪再試。與本檔一貫原則相同：寧可多叫，不可靜音。
 */
export function shouldPersistDispatch(
  shouldNotify: boolean,
  results: ReadonlyArray<NotifyAttempt>,
): boolean {
  if (!shouldNotify) return false;
  return summarizeNotifyResults(results).delivered;
}
