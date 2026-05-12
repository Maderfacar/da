/**
 * Driver Stats Helper — P25-1 today 歸零 + online hours
 *
 * 設計重點：
 * - Lazy reset（方案 B）：不依賴 Vercel Cron。所有 today 系列寫入入口先過 `maybeResetToday`。
 * - 共用 `todayResetAt` 欄位避免雙寫：歸零與 online hours 共用同一個時間戳判斷台北今日。
 * - 共用 `currentOnlineSessionStartAt`：driver online 段起點；offline / busy 設為 null。
 * - 共用 `todayOnlineSeconds / totalOnlineSeconds`：已結束的 online 段累加（busy 不計入）。
 *
 * 對應決策見 docs/decision-log.md 2026-05-13 P25-1 條目。
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TPE_TZ = 'Asia/Taipei';

export interface DriverStatsDoc {
  todayTrips?: number;
  todayEarnings?: number;
  todayOnlineSeconds?: number;
  totalOnlineSeconds?: number;
  currentOnlineSessionStartAt?: { toMillis?: () => number } | null;
  todayResetAt?: { toMillis?: () => number } | null;
  lastActiveAt?: { toMillis?: () => number } | null;
  status?: 'online' | 'busy' | 'offline' | string;
}

/**
 * 判斷是否需歸零今日統計（台北時區跨日）。
 * 跨日 → 回傳 patch（要寫到 drivers doc）；未跨日 → 回 null。
 *
 * 注意：呼叫端應把回傳 patch 併入更新（不要分開兩次寫，避免 race）。
 */
export function maybeResetTodayPatch(data: DriverStatsDoc, nowMs: number = Date.now()): Record<string, unknown> | null {
  const resetMs = data.todayResetAt?.toMillis?.() ?? 0;
  const todayTpe = dayjs(nowMs).tz(TPE_TZ).format('YYYY-MM-DD');
  const resetTpe = resetMs > 0 ? dayjs(resetMs).tz(TPE_TZ).format('YYYY-MM-DD') : '';

  if (resetTpe === todayTpe) return null;

  return {
    todayTrips: 0,
    todayEarnings: 0,
    todayOnlineSeconds: 0,
    todayResetAt: new Date(nowMs),
  };
}

/**
 * 結算當前 online 段 — 若 `currentOnlineSessionStartAt` 不為 null，計算 delta，
 * 回傳要寫到 drivers doc 的 patch（todayOnlineSeconds / totalOnlineSeconds 累加 + 段起點 null）。
 *
 * 若 session 未開（offline / busy）→ 回 null。
 *
 * 注意：呼叫端應「先 maybeResetTodayPatch 再 settleOnlineSessionPatch」順序合併，
 * 否則跨日結算時 todayOnlineSeconds 累加值會被歸零覆蓋（todayResetAt patch 內含 0 重置）。
 * 為避免此 race，請使用 `composeStatusTransitionPatch` 整合呼叫。
 */
export function settleOnlineSessionPatch(data: DriverStatsDoc, nowMs: number = Date.now()): Record<string, unknown> | null {
  const startMs = data.currentOnlineSessionStartAt?.toMillis?.() ?? 0;
  if (startMs <= 0) return null;
  const deltaSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  return {
    todayOnlineSeconds: (data.todayOnlineSeconds ?? 0) + deltaSec,
    totalOnlineSeconds: (data.totalOnlineSeconds ?? 0) + deltaSec,
    currentOnlineSessionStartAt: null,
  };
}

/**
 * 整合 status transition patch — 處理 online ↔ busy ↔ offline 切換時的所有副作用：
 * 1. 跨日歸零（共用 todayResetAt）
 * 2. 結算當前 online 段（若有）
 * 3. 視 newStatus 決定是否重啟 session（offline→online、busy→online）
 *
 * @param data 當前 drivers doc 資料
 * @param newStatus 目標狀態
 * @param nowMs 當前時間（測試用，預設 Date.now()）
 * @returns 要寫入 drivers doc 的完整 patch（已合併歸零 + 結算 + session 重啟）
 */
export function composeStatusTransitionPatch(
  data: DriverStatsDoc,
  newStatus: 'online' | 'busy' | 'offline',
  nowMs: number = Date.now(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: newStatus };

  // 1. 結算當前 online 段（先做，這樣 todayOnlineSeconds 帶有「歸零前」累積值）
  const settle = settleOnlineSessionPatch(data, nowMs);
  if (settle) Object.assign(patch, settle);

  // 2. 跨日歸零（後做，覆蓋 todayOnlineSeconds = 0；歷史 totalOnlineSeconds 已在 settle 累加進 doc）
  //    但 patch 內若已 settle，merge 後 settle 的 todayOnlineSeconds 會被 0 蓋掉，正確！
  //    （歷史那段 onlineSeconds 已寫進 totalOnlineSeconds，今日重新從 0 起算）
  const reset = maybeResetTodayPatch(data, nowMs);
  if (reset) Object.assign(patch, reset);

  // 3. 視目標狀態決定 session 起點
  if (newStatus === 'online') {
    // offline → online / busy → online 都要重啟 session
    patch.currentOnlineSessionStartAt = new Date(nowMs);
  }
  // busy / offline → session 設 null（settle 已做）；若原本就無 session 也維持 null

  return patch;
}

/**
 * 計算 client 顯示用的 ONLINE HRS（今日累積秒數）：
 * - status === 'online' → todayOnlineSeconds + (now - currentOnlineSessionStartAt)
 * - 其他 → todayOnlineSeconds 不再加 live delta
 *
 * 注意：busy 期間不計入 online hours（policy 決議）。
 */
export function computeTodayOnlineSeconds(data: DriverStatsDoc, nowMs: number = Date.now()): number {
  const base = data.todayOnlineSeconds ?? 0;
  if (data.status !== 'online') return base;
  const startMs = data.currentOnlineSessionStartAt?.toMillis?.() ?? 0;
  if (startMs <= 0) return base;
  return base + Math.max(0, Math.floor((nowMs - startMs) / 1000));
}
