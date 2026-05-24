/**
 * Driver Category（司機分級）server-side util — Wave 2A
 *
 * 規格：DRIVER_CATEGORY / DRIVER_CATEGORY_LABEL / DriverCategory 一律由
 * `~shared/types/driver-category` 直接 import（避免 Nuxt 自動匯入兩處同名符號）。
 * 此檔僅提供 server 端「需要 server 上下文」的 helper（目前 i18n 取 label）。
 *
 * 升級規則 stub（第一版未實作）：
 *  TODO（日後 phase）：依下列 metric 自動升級
 *   - tripCount: 完成趟數 ≥ 50 → 1, ≥ 200 → 2
 *   - distanceKm: 累積里程 ≥ 1000 → 1, ≥ 5000 → 2
 *   - rating: 平均評分 ≥ 4.5 → 至少 1, ≥ 4.8 → 至少 2
 *  - 三 metric 取 AND（同時滿足才升），admin 仍可手動覆寫
 *  - 觸發時機：建議掛在訂單 completed 寫入時的 trigger（function or hot path）
 *  - 第一版 spec：openspec/changes/2026-05-24-admin-orders-dispatch-tiers/specs/driver-dispatch/spec.md
 */
import {
  DRIVER_CATEGORY,
  DRIVER_CATEGORY_LABEL,
  isDriverCategory,
  type DriverCategory,
} from '~shared/types/driver-category';

type Lang = 'zh' | 'en' | 'ja';

/**
 * 取得司機分級的語系顯示名稱
 * @param level 司機分級值（'0' | '1' | '2'；非合法值 fallback 到 NOVICE）
 * @param lang  目標語系（預設繁中）
 */
export function getCategoryLabel(level: string | undefined | null, lang: Lang = 'zh'): string {
  const key: DriverCategory = isDriverCategory(level) ? level : DRIVER_CATEGORY.NOVICE;
  return DRIVER_CATEGORY_LABEL[key][lang];
}
