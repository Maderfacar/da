// Booking v2 批次 2：人數拆大人 / 兒童的純函式 helper（前後端共用）
//
// 規則（與 server/routes/nuxt-api/orders/index.post.ts 對齊）：
//   - 大人 ≥ 1（至少一位大人）
//   - 兒童 ≥ 0（兒童佔 1 座位）
//   - 大人 + 兒童 ≥ 1 && ≤ 20
//   - 若給 vehicleCapacity → 大人 + 兒童 ≤ vehicleCapacity（兒童不打折）
//
// Backward-compat：未帶 adultCount 時 fallback：adultCount = passengerCount, childCount = 0

export interface PassengerSplitInput {
  adultCount?: number;
  childCount?: number;
  /** 向後相容；批次 1 以前的客戶端只帶這個欄位 */
  passengerCount?: number;
}

export interface PassengerSplitResolved {
  adultCount: number;
  childCount: number;
  totalPassengers: number;
}

export type PassengerSplitErrorCode =
  | 'adult_invalid'
  | 'child_invalid'
  | 'total_invalid'
  | 'capacity_exceeded';

export interface PassengerSplitError {
  ok: false;
  code: PassengerSplitErrorCode;
  reason: string;
  context: { adultCount?: number; childCount?: number; total?: number; capacity?: number };
}

export interface PassengerSplitOk extends PassengerSplitResolved {
  ok: true;
}

export type PassengerSplitResult = PassengerSplitOk | PassengerSplitError;

/**
 * 解析 booking input 為 adult / child，向後相容舊客戶端：
 * 若 input 帶 adultCount → 直接用；否則 fallback adultCount = passengerCount, childCount = 0
 */
export function resolvePassengerSplit(input: PassengerSplitInput): PassengerSplitResolved {
  const hasAdult = Number.isInteger(input.adultCount);
  const adultCount = hasAdult ? (input.adultCount as number) : (input.passengerCount ?? 0);
  const childCount = Number.isInteger(input.childCount) ? (input.childCount as number) : 0;
  return { adultCount, childCount, totalPassengers: adultCount + childCount };
}

/**
 * 完整校驗：adult ≥ 1、child ≥ 0、total ∈ [1,20]，若 vehicleCapacity 提供則 total ≤ capacity。
 * 兒童佔 1 座位（與 design.md 拍板：「兒童佔 1 座位」）。
 */
export function validatePassengerSplit(
  input: PassengerSplitInput,
  vehicleCapacity?: number,
): PassengerSplitResult {
  const resolved = resolvePassengerSplit(input);
  const { adultCount, childCount, totalPassengers } = resolved;

  if (!Number.isInteger(adultCount) || adultCount < 1 || adultCount > 20) {
    return {
      ok: false,
      code: 'adult_invalid',
      reason: 'Adult count must be integer between 1 and 20',
      context: { adultCount },
    };
  }
  if (!Number.isInteger(childCount) || childCount < 0 || childCount > 20) {
    return {
      ok: false,
      code: 'child_invalid',
      reason: 'Child count must be integer between 0 and 20',
      context: { childCount },
    };
  }
  if (totalPassengers < 1 || totalPassengers > 20) {
    return {
      ok: false,
      code: 'total_invalid',
      reason: 'Total passengers must be between 1 and 20',
      context: { total: totalPassengers },
    };
  }
  if (vehicleCapacity !== undefined && totalPassengers > vehicleCapacity) {
    return {
      ok: false,
      code: 'capacity_exceeded',
      reason: `Total ${totalPassengers} exceeds vehicle capacity ${vehicleCapacity}`,
      context: { total: totalPassengers, capacity: vehicleCapacity },
    };
  }
  return { ok: true, adultCount, childCount, totalPassengers };
}
