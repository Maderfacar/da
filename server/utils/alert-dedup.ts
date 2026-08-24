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
