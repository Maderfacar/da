/**
 * driver/trip 推進按鈕的時間 gate（Phase 3）。
 * - 客上 (`arrived_pickup` → `in_transit`)：now >= pickupDateTime - 60min
 * - 客下 (`in_transit` → `completed`)：now >= pickupDateTime + estimatedTime - 20min
 * - 其他狀態轉換：純序列限制，無時間 gate
 *
 * pickupDateTime 無時區資訊時視為台灣時間 (+08:00)。
 */

export const PICKUP_GATE_OFFSET_MS = 60 * 60 * 1000; // 上車前 60 分鐘可執行
export const DROPOFF_GATE_OFFSET_MS = 20 * 60 * 1000; // 預估抵達 -20 分鐘容差

export type TimeGateCode = 'too_early_pickup' | 'too_early_dropoff';

export type TimeGateResult =
  | { ok: true }
  | { ok: false; code: TimeGateCode; readyAt: Date; remainingMs: number };

interface CheckTimeGateInput {
  currentStatus: string;
  nextStatus: string;
  pickupDateTime: string | undefined | null;
  /** 預估行程時間（分鐘）— 客下 gate 用 */
  estimatedTimeMin?: number | null;
  now: Date;
}

/**
 * 將 booking 端的字串視為台灣時間（無時區資訊時補 +08:00）。
 * 與 server/routes/nuxt-api/orders/index.post.ts 的 parseTaiwanTime 同邏輯，
 * 抽出供 patch endpoint / 前端 SSR-safe util 共用。
 */
export function parseTaiwanTime(raw: string): Date {
  const hasZone = /z$/i.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(hasZone ? iso : `${iso}+08:00`);
  return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
}

export function checkTimeGate(input: CheckTimeGateInput): TimeGateResult {
  const { currentStatus, nextStatus, pickupDateTime, estimatedTimeMin, now } = input;

  // 客上：arrived_pickup → in_transit
  if (currentStatus === 'arrived_pickup' && nextStatus === 'in_transit') {
    if (!pickupDateTime) return { ok: true };
    const pickup = parseTaiwanTime(pickupDateTime);
    if (Number.isNaN(pickup.getTime())) return { ok: true };
    const readyAt = new Date(pickup.getTime() - PICKUP_GATE_OFFSET_MS);
    const remainingMs = readyAt.getTime() - now.getTime();
    if (remainingMs <= 0) return { ok: true };
    return { ok: false, code: 'too_early_pickup', readyAt, remainingMs };
  }

  // 客下：in_transit → completed
  if (currentStatus === 'in_transit' && nextStatus === 'completed') {
    if (!pickupDateTime) return { ok: true };
    const pickup = parseTaiwanTime(pickupDateTime);
    if (Number.isNaN(pickup.getTime())) return { ok: true };
    const est = typeof estimatedTimeMin === 'number' && Number.isFinite(estimatedTimeMin) && estimatedTimeMin > 0
      ? estimatedTimeMin
      : 0;
    const readyAt = new Date(pickup.getTime() + est * 60 * 1000 - DROPOFF_GATE_OFFSET_MS);
    const remainingMs = readyAt.getTime() - now.getTime();
    if (remainingMs <= 0) return { ok: true };
    return { ok: false, code: 'too_early_dropoff', readyAt, remainingMs };
  }

  return { ok: true };
}

/** 倒數格式化：例 "1 小時 23 分鐘" / "23 分鐘" / "45 秒"（remainingMs > 0） */
export function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return '0 秒';
  const totalSec = Math.ceil(remainingMs / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const totalMin = Math.ceil(remainingMs / (60 * 1000));
  if (totalMin < 60) return `${totalMin} 分鐘`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins === 0 ? `${hours} 小時` : `${hours} 小時 ${mins} 分鐘`;
}
