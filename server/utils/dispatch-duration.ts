/**
 * Dispatch Duration Config — Wave 2B+2C
 *
 * 訂單分級派單的「等級間距」設定：每筆訂單依 orderType 決定從 currentLevel
 * 降到下一級需要多久（秒）。
 *
 * 第一版 hard-code；日後若改成 Firestore config doc，只需替換 getNextDowngradeAt
 * 的 lookup 邏輯，consumer signature 不變。
 *
 * 注意：currentLevel='0' 為終態，回 null（不再降）；unknown orderType 同樣回 null
 * 確保不會因為新增 orderType 漏掉 config 就崩。
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { DispatchLevel } from '~shared/types/dispatch-visibility';

/** 等級間距 config key（'2->1' 從 PRO 降到 STANDARD；'1->0' 從 STANDARD 降到 NOVICE） */
type DurationKey = '2->1' | '1->0';

/** 已知 orderType（與 booking flow 共用；任何新 type 必須補進此 config） */
export type DispatchOrderType =
  | 'airport-pickup'
  | 'airport-dropoff'
  | 'transfer'
  | 'charter';

/**
 * 各 orderType 的等級間距（秒）。
 *  - airport-*：3 分 / 5 分（接送機時效短）
 *  - transfer：8 分 / 12 分
 *  - charter：30 分 / 60 分（包車緩衝充裕）
 */
export const DISPATCH_DURATION: Record<DispatchOrderType, Record<DurationKey, number>> = {
  'airport-pickup':  { '2->1': 180,  '1->0': 300 },
  'airport-dropoff': { '2->1': 180,  '1->0': 300 },
  'transfer':        { '2->1': 480,  '1->0': 720 },
  'charter':         { '2->1': 1800, '1->0': 3600 },
};

/** runtime 判斷某 orderType 是否在 config 內（其他值會被當 unknown，回 null） */
export const isDispatchOrderType = (v: unknown): v is DispatchOrderType =>
  typeof v === 'string' && v in DISPATCH_DURATION;

/**
 * 計算「下一次自動降級」的時間。
 *
 * @param orderType  訂單 orderType（airport-pickup / charter 等）
 * @param currentLevel 目前可見等級（'0'/'1'/'2'）
 * @param openedAt   當前等級開放時間（Firestore Timestamp）
 * @returns 下次降級 Timestamp；終態（currentLevel='0'）或 unknown orderType 回 null
 */
export function getNextDowngradeAt(
  orderType: string,
  currentLevel: DispatchLevel,
  openedAt: Timestamp | null | undefined,
): Timestamp | null {
  if (!openedAt) return null;
  if (currentLevel === '0') return null;
  if (!isDispatchOrderType(orderType)) return null;
  const key: DurationKey = currentLevel === '2' ? '2->1' : '1->0';
  const duration = DISPATCH_DURATION[orderType][key];
  return Timestamp.fromMillis(openedAt.toMillis() + duration * 1000);
}

/**
 * 推算下一級（降一級）。'2' → '1'，'1' → '0'，'0' → null（終態）。
 * 純函式，便於 lazy check / manual downgrade 共用。
 */
export function nextLowerLevel(level: DispatchLevel): DispatchLevel | null {
  if (level === '2') return '1';
  if (level === '1') return '0';
  return null;
}
