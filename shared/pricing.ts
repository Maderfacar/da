/** 共用計價公式 — 前後端共享，無任何框架依賴 */

export const VEHICLE_CONFIG = {
  sedan:   { label: '轎車',   baseFare: 400,  perKm: 30, seats: 4, luggage: 2 },
  suv:     { label: 'SUV',    baseFare: 600,  perKm: 35, seats: 6, luggage: 4 },
  van:     { label: '廂型車', baseFare: 800,  perKm: 40, seats: 8, luggage: 6 },
  premium: { label: '豪華車', baseFare: 1200, perKm: 50, seats: 4, luggage: 2 },
} as const;

export type VehicleType = keyof typeof VEHICLE_CONFIG;

/** 每項額外服務費用（元） */
export const EXTRA_SERVICE_PRICE = 200;

/** 無條件進位單位（元） */
const ROUND_UP_TO = 50;

/**
 * 計算車資
 * @param distanceKm    行程總距離（公里）
 * @param vehicleType   車種
 * @param extraCount    勾選的額外服務數量
 * @returns             無條件進位至 50 元整的總車資
 */
export function calculateFare(distanceKm: number, vehicleType: VehicleType, extraCount: number): number {
  const { baseFare, perKm } = VEHICLE_CONFIG[vehicleType];
  const raw = baseFare + perKm * distanceKm + extraCount * EXTRA_SERVICE_PRICE;
  return Math.ceil(raw / ROUND_UP_TO) * ROUND_UP_TO;
}
