/**
 * Driver Category（司機分級）共用型別 — Wave 2A
 *
 * 三級：
 *  - '0' NOVICE：新註冊預設，未驗證夠多趟
 *  - '1' STANDARD：一般司機
 *  - '2' PRO：高品質司機（評分高 / 趟數多）
 *
 * 對應派單系統 `orders/{orderId}.dispatchVisibility.currentLevel`（Wave 2B+2C 加入）：
 *  - 司機 driverCategory >= order.currentLevel 才看得到該訂單
 *  - 即 PRO 看得到 currentLevel=2 / STANDARD 看 ≤1 / NOVICE 只看 0
 *
 * 升級規則（第一版未實作，由 admin 手動調整）：
 *  TODO（日後 phase）：依下列 metric 自動升級
 *   - tripCount: 完成趟數 ≥ 50 → 1, ≥ 200 → 2
 *   - distanceKm: 累積里程 ≥ 1000 → 1, ≥ 5000 → 2
 *   - rating: 平均評分 ≥ 4.5 → 至少 1, ≥ 4.8 → 至少 2
 *  - 三 metric 取 AND（同時滿足才升），admin 仍可手動覆寫
 *  - 觸發時機：訂單 completed 寫入時掛 trigger
 */

/** 司機分級常數（與 dispatch level 對齊） */
export const DRIVER_CATEGORY = {
  NOVICE: '0',
  STANDARD: '1',
  PRO: '2',
} as const;

/** 司機分級型別 */
export type DriverCategory = typeof DRIVER_CATEGORY[keyof typeof DRIVER_CATEGORY];

/** 三語系名稱（admin 顯示用） */
export const DRIVER_CATEGORY_LABEL: Record<DriverCategory, { zh: string; en: string; ja: string }> = {
  '0': { zh: '新手', en: 'Novice', ja: '新人' },
  '1': { zh: '標準', en: 'Standard', ja: '標準' },
  '2': { zh: '高級', en: 'Pro', ja: 'プロ' },
};

/** 全部合法值（給 array 用 — 例如 select option / runtime validate） */
export const DRIVER_CATEGORY_VALUES: ReadonlyArray<DriverCategory> = ['0', '1', '2'] as const;

/** runtime 驗證：是否為合法 DriverCategory 值 */
export const isDriverCategory = (v: unknown): v is DriverCategory =>
  typeof v === 'string' && (DRIVER_CATEGORY_VALUES as ReadonlyArray<string>).includes(v);
