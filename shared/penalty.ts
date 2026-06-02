/**
 * 醜點系統 Phase 1（A2）— 純函式工具
 *
 * 規格（鎖死）：
 *   - 24h 前取消 = 免費（不記）
 *   - 24h 內取消 = 記 1 醜
 *   - No-show = 記 2 醜
 *   - 累積 3 醜 → admin 後台手動拉黑（不自動禁、admin 人工判斷）
 *   - 6 個月沒新醜 → 歸零（lazy check：每次累計時判斷）
 *   - 達 2 醜 → 推 LINE「最後警告」flex
 *   - 達 3 醜或被拉黑 → 推 LINE「服務暫停通知」
 *
 * Phase 2 預留：訂金 10%、Brain AI 個人 LINE Pay 收、admin 手動標記入帳
 *   屆時 cancellation policy 會擴充（含 deposit refund 規則），目前不實作。
 */

import { parseTaiwanTime } from './trip-time-gate';

/** 取消類別：免費 / 24h 內遲取消 */
export type CancellationCategory = 'free' | 'late';

/** 醜點觸發類別（no_show 由 admin 後台手動標記） */
export type UglyType = 'late_cancel' | 'no_show';

/** 警告 / 暫停推播類別（達到時應推 LINE） */
export type PenaltyPushType = 'warning' | 'suspended' | null;

export const UGLY_LATE_CANCEL_POINTS = 1;
export const UGLY_NO_SHOW_POINTS = 2;
export const UGLY_WARNING_THRESHOLD = 2;
export const UGLY_SUSPEND_THRESHOLD = 3;
export const LATE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const UGLY_RESET_MONTHS = 6;

interface ClassifyCancellationInput {
  /** 取消當下時間 */
  now: Date;
  /** 訂單原預定上車時間（booking 字串格式；無時區資訊視為 +08:00） */
  pickupDateTime: string | null | undefined;
}

/**
 * 判定此次取消屬 free（24h 前）還是 late（24h 內）。
 *
 * - pickupDateTime 缺失或非法字串 → 視為 'free'（fallback 不誤記醜點，避免資料壞掉打到使用者）
 * - now ≥ pickup - 24h → 'late'
 * - now < pickup - 24h → 'free'
 */
export function classifyCancellation(input: ClassifyCancellationInput): CancellationCategory {
  const { now, pickupDateTime } = input;
  if (!pickupDateTime) return 'free';
  const pickup = parseTaiwanTime(pickupDateTime);
  if (Number.isNaN(pickup.getTime())) return 'free';
  const lateThreshold = pickup.getTime() - LATE_CANCEL_WINDOW_MS;
  return now.getTime() >= lateThreshold ? 'late' : 'free';
}

/** 取得某次醜點事件對應的點數 */
export function computeUglyPoints(type: UglyType): number {
  if (type === 'no_show') return UGLY_NO_SHOW_POINTS;
  return UGLY_LATE_CANCEL_POINTS;
}

/**
 * 判定當下是否應 lazy 歸零醜點。
 *
 * 規則：自 uglyResetAt（最後一次記點時間）起算超過 6 calendar months → 應歸零。
 * uglyResetAt 為 null（從未記過）→ 不需歸零。
 */
export function shouldResetUgly(uglyResetAt: Date | null, now: Date): boolean {
  if (!uglyResetAt) return false;
  if (Number.isNaN(uglyResetAt.getTime())) return false;
  const target = new Date(uglyResetAt.getTime());
  target.setMonth(target.getMonth() + UGLY_RESET_MONTHS);
  return now.getTime() >= target.getTime();
}

/**
 * 累計後判斷此次該推哪種 LINE 通知。
 *
 * - 累計 = warning 門檻（2）→ 推 warning（最後警告）
 * - 累計 ≥ suspend 門檻（3）→ 推 suspended（達 3 醜或被拉黑）
 * - 其他 → null（不推）
 *
 * 注意：suspended 推播本身不代表「自動拉黑」— admin 仍需在後台手動執行 blacklist add。
 */
export function decidePenaltyPush(newUglyCount: number): PenaltyPushType {
  if (newUglyCount >= UGLY_SUSPEND_THRESHOLD) return 'suspended';
  if (newUglyCount >= UGLY_WARNING_THRESHOLD) return 'warning';
  return null;
}
