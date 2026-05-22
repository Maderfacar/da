// 車廂體積 → SU 換算純函式（前後端共用）
//
// 1 SU = 標準 20 吋登機箱（55×35×25cm = 48,125cm³ ≈ 48L）
// 畸零空間扣除 20%
// derivedLuggageSU = floor(trunkVolumeLiters × 0.8 / 48)

/** 每 SU 對應的標準體積（公升） */
export const SU_LITERS_PER_UNIT = 48;

/** 畸零空間損耗比例 */
export const DEAD_SPACE_RATIO = 0.2;

/**
 * 從車廂體積推算可承載 SU 數
 * @param liters 車廂總體積（公升）；<= 0 回傳 0
 */
export function computeSU(liters: number): number {
  if (!Number.isFinite(liters) || liters <= 0) return 0;
  const effective = liters * (1 - DEAD_SPACE_RATIO);
  return Math.floor(effective / SU_LITERS_PER_UNIT);
}

/** 座椅折疊配置（假七或可折座車型用） */
export interface SeatConfig {
  label: string;              // e.g. "折座模式（3人）"
  passengerCapacity: number;  // 該模式下乘客上限，>= 1
  luggageSU: number;          // 該模式下行李 SU 上限，>= 1
}

/** 驗證 SeatConfig 陣列；回傳第一個錯誤字串，合法回 null */
export function validateSeatConfigs(configs: unknown): string | null {
  if (configs === undefined || configs === null) return null;
  if (!Array.isArray(configs)) return 'seatConfigs 必須是陣列';
  if (configs.length > 3) return 'seatConfigs 最多 3 組';
  for (let i = 0; i < configs.length; i++) {
    const c = configs[i] as Record<string, unknown>;
    if (!c || typeof c !== 'object') return `seatConfigs[${i}] 格式錯誤`;
    if (typeof c.label !== 'string' || c.label.trim().length === 0)
      return `seatConfigs[${i}].label 必填`;
    if (!Number.isInteger(c.passengerCapacity) || (c.passengerCapacity as number) < 1)
      return `seatConfigs[${i}].passengerCapacity 必須是正整數`;
    if (!Number.isInteger(c.luggageSU) || (c.luggageSU as number) < 1)
      return `seatConfigs[${i}].luggageSU 必須是正整數`;
  }
  return null;
}
