/**
 * Dispatch Visibility 共用型別 — Wave 2B+2C
 *
 * 對應 `orders/{orderId}.dispatchVisibility`：
 *  - startLevel: admin 發布時選的首發等級（重發時亦重置 currentLevel = startLevel）
 *  - currentLevel: 目前開放等級（含以下；string '0'/'1'/'2' 與 driverCategory 對齊，
 *    可直接字典序比較：`driverCategory >= currentLevel` → 看得到）
 *  - openedAt: 當前等級開放時間（每次降級重置）
 *  - levelHistory: 歷次等級切換的 audit 軌跡
 *
 * 對應 `shared/types/driver-category.ts`：'0' NOVICE / '1' STANDARD / '2' PRO
 *
 * 注意：本檔僅定義「結構」，server 寫入時 openedAt 為 Firestore Timestamp、
 * client 讀出時為 ISO string；DTO 在各 API 邊界各自轉型。
 */

import { DRIVER_CATEGORY_VALUES, type DriverCategory } from './driver-category';

/** 派單可見等級（與 DriverCategory 同字串集合） */
export type DispatchLevel = DriverCategory;

/** 全部合法值（給 select option / runtime validate 用） */
export const DISPATCH_LEVEL_VALUES: ReadonlyArray<DispatchLevel> = DRIVER_CATEGORY_VALUES;

/** runtime 驗證：是否為合法 DispatchLevel 值 */
export const isDispatchLevel = (v: unknown): v is DispatchLevel =>
  typeof v === 'string' && (DISPATCH_LEVEL_VALUES as ReadonlyArray<string>).includes(v);

/** levelHistory 的 reason enum */
export type DispatchLevelChangeReason =
  | 'init'
  | 'auto-downgrade'
  | 'manual-downgrade'
  | 'force-open-all';

/** levelHistory 內每筆 entry（openedAt 為 Timestamp/ISO 視層級而定） */
export interface DispatchLevelHistoryEntry<TTimestamp = string> {
  level: DispatchLevel;
  openedAt: TTimestamp;
  /** 'system' = 自動降級（lazy） / string = adminId */
  openedBy: 'system' | string;
  reason: DispatchLevelChangeReason;
}

/** 訂單派單可見性（generic 對應 server Timestamp / client ISO 兩種） */
export interface DispatchVisibility<TTimestamp = string> {
  startLevel: DispatchLevel;
  currentLevel: DispatchLevel;
  openedAt: TTimestamp;
  levelHistory: Array<DispatchLevelHistoryEntry<TTimestamp>>;
}

/** Client 端 DTO（openedAt 為 ISO string；新欄位皆 optional 防舊單沒有） */
export type DispatchVisibilityDto = DispatchVisibility<string>;
