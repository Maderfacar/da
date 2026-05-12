/**
 * Firestore `flight_registry` CRUD（Layer 1 Local Cache）
 *
 * 設計原則（依 spec 2026-05-10）：
 *   - doc id = flightNo（大寫，例 'JX801'）
 *   - 每個 doc 存「航班的靜態特徵」：airline / 航廈 / 起降機場 / 最後狀態
 *   - 額外擴充 `schedules` map：以 'YYYY-MM-DD__direction' 為 key 快取每日排程
 *     讓「秒渲染」即使在 API 暫時失敗時也能直接取最近一次完整 FlightInfo
 *   - TTL：static 部分用 lastUpdated（預設 60 天）；dynamic schedule 用各自的 fetchedAtMillis
 *
 * 寫入失敗一律 silent log，不影響當次請求回應（per spec Q5 default）。
 */

import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

const COLLECTION = 'flight_registry';

/** 靜態特徵 TTL（天） */
export const REGISTRY_STATIC_TTL_DAYS = 60;

/** 動態 schedule 視為「秒渲染可用」的最大年齡（毫秒）— 超過則仍可顯示但會嘗試 API 刷新 */
export const REGISTRY_SCHEDULE_FRESH_MS = 30 * 60 * 1000; // 30 min

export type FlightDirection = 'arrival' | 'departure';

/** 寫入 / 讀出時用的 schedule 快取格式 */
export interface FlightRegistrySchedule {
  scheduledTime: string;
  estimatedTime: string;
  status: string;
  terminal: string;
  departureIata: string;
  departureCity: string;
  arrivalIata: string;
  arrivalCity: string;
  fetchedAtMillis: number;
}

/** Firestore doc shape（讀出時 lastUpdated 為 Timestamp，寫入時用 FieldValue.serverTimestamp） */
export interface FlightRegistryDoc {
  flightNo: string;
  airlineCode: string;
  airlineName: string;
  /** 該航班最常見的出發機場（首次學習自 API；後續以最新 API 結果覆蓋） */
  departureAirport: string;
  arrivalAirport: string;
  /** TPE 端的航廈（'1' / '2'） */
  terminal: string;
  /** 最後一次見到的 status */
  status: string;
  lastUpdated: Timestamp | null;
  /** Per-date schedule cache，key 由 makeScheduleKey() 產生 */
  schedules?: Record<string, FlightRegistrySchedule>;
  /** TDX schedule 子物件（本 spec 2026-05-12 新增，獨立於 Aviation Edge schedules）*/
  tdx?: FlightRegistryTdxBlock;
  /** 手動 fallback schedule（spec 2026-05-12 manual-fallback-ui；key 同 schedules）*/
  manualSchedules?: Record<string, FlightRegistryManualSchedule>;
}

/** TDX schedule 子物件（GeneralSchedule API 回傳的「週期性排程」） */
export interface FlightRegistryTdxBlock {
  isDomestic: boolean;
  departureAirport: string;
  arrivalAirport: string;
  /** TPE 端對應 direction 的航廈（國內線可能為 ''） */
  terminal: string;
  scheduledDeparture: string;        // 'HH:mm'
  scheduledArrival: string;
  weekDays: number[];                // [1,3,5] (1=週一, 7=週日)
  effectiveStart: string | null;     // 'YYYY-MM-DD'
  effectiveEnd: string | null;
  codeShare: boolean;
  operatingAirlineCode: string | null;
  operatingFlightNumber: string | null;
  /** TDX 撈回時間（毫秒），用於 staleness 判定 */
  fetchedAtMillis: number;
}

/** TDX 子物件視為「秒渲染可用」的最大年齡（毫秒）— booking 階段排程不會分鐘級變動，可放寬 */
export const TDX_FRESH_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * 手動 fallback schedule（spec 2026-05-12 manual-fallback-ui）
 *
 * 設計原則：
 *   - 與 Aviation Edge `schedules` / TDX `tdx` 子物件**獨立**存放，避免 user 填錯污染 API 資料
 *   - per-date + per-direction（key 同 schedules：'YYYY-MM-DD__direction'）
 *   - lookup 順序：TDX > AE schedules > **manual** > stale（user 拍板「TDX 永遠優先」）
 *   - submittedBy 記錄填寫者，方便日後查問題訂單；TTL 同 STATIC_TTL_DAYS（60 天）
 */
export interface FlightRegistryManualSchedule {
  scheduledTime: string;       // ISO 8601 with +08:00
  estimatedTime: string;       // 同 scheduledTime（manual 無 live 資料）
  status: 'scheduled';
  terminal: '1' | '2';
  departureIata: string;       // 缺則填 ''
  departureCity: string;
  arrivalIata: string;
  arrivalCity: string;
  submittedAtMillis: number;
  submittedByLineUid: string;
}

/** Manual schedule 視為有效的最大年齡（毫秒）— 同 static TTL（60 天） */
export const MANUAL_FRESH_MS = REGISTRY_STATIC_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 取一份 Firestore handle；Firebase 未設或 init 失敗則回 null（讓上層走 fallback） */
function _getDb(): Firestore | null {
  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return null;
  try {
    return useFirebaseAdmin(firebaseServiceAccountJson).db;
  } catch (err) {
    console.error('[flight-registry] Firebase Admin init failed:', err);
    return null;
  }
}

/** 'YYYY-MM-DD__arrival' / 'YYYY-MM-DD__departure' */
export const MakeScheduleKey = (date: string, direction: FlightDirection): string =>
  `${date}__${direction}`;

/** 讀 flight_registry/{flightNo} */
export const GetFlightFromRegistry = async (
  flightNo: string,
): Promise<FlightRegistryDoc | null> => {
  const db = _getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(COLLECTION).doc(flightNo).get();
    if (!snap.exists) return null;
    return snap.data() as FlightRegistryDoc;
  } catch (err) {
    console.error(`[flight-registry] read failed (${flightNo}):`, err);
    return null;
  }
};

/** 靜態特徵是否還在 TTL 內 */
export const IsRegistryStaticFresh = (
  doc: FlightRegistryDoc | null,
  ttlDays = REGISTRY_STATIC_TTL_DAYS,
): boolean => {
  if (!doc?.lastUpdated) return false;
  const ageMs = Date.now() - doc.lastUpdated.toMillis();
  return ageMs < ttlDays * 24 * 60 * 60 * 1000;
};

/** 取出指定日期 + 方向的 schedule cache（沒有則 null） */
export const GetCachedSchedule = (
  doc: FlightRegistryDoc | null,
  date: string,
  direction: FlightDirection,
): FlightRegistrySchedule | null => {
  if (!doc?.schedules) return null;
  return doc.schedules[MakeScheduleKey(date, direction)] ?? null;
};

/** schedule 是否在「秒渲染可用」窗口內（< 30 min） */
export const IsScheduleFresh = (schedule: FlightRegistrySchedule): boolean => {
  return Date.now() - schedule.fetchedAtMillis < REGISTRY_SCHEDULE_FRESH_MS;
};

export interface SaveFlightInput {
  flightNo: string;
  airlineCode: string;
  airlineName: string;
  departureAirport: string;
  arrivalAirport: string;
  terminal: string;
  status: string;
  /** 帶上 schedule 會同時寫入該日期 + 方向的快取 */
  schedule?: {
    date: string;
    direction: FlightDirection;
    data: Omit<FlightRegistrySchedule, 'fetchedAtMillis'>;
  };
}

/**
 * 寫入 / 更新 flight_registry doc
 * - 靜態欄位以 set + merge 覆蓋
 * - lastUpdated 用 FieldValue.serverTimestamp()
 * - schedule 嵌套寫到 `schedules.{key}`，fetchedAtMillis 用 Date.now() 數值
 * - 寫入失敗 silent log（不 throw）
 */
export const SaveFlightToRegistry = async (input: SaveFlightInput): Promise<void> => {
  const db = _getDb();
  if (!db) return;
  try {
    const ref = db.collection(COLLECTION).doc(input.flightNo);
    const payload: Record<string, unknown> = {
      flightNo: input.flightNo,
      airlineCode: input.airlineCode,
      airlineName: input.airlineName,
      departureAirport: input.departureAirport,
      arrivalAirport: input.arrivalAirport,
      terminal: input.terminal,
      status: input.status,
      lastUpdated: FieldValue.serverTimestamp(),
    };
    if (input.schedule) {
      const key = MakeScheduleKey(input.schedule.date, input.schedule.direction);
      payload.schedules = {
        [key]: {
          ...input.schedule.data,
          fetchedAtMillis: Date.now(),
        },
      };
    }
    await ref.set(payload, { merge: true });
  } catch (err) {
    console.error(`[flight-registry] write failed (${input.flightNo}):`, err);
  }
};

// ── TDX 子物件 read / write helpers（spec 2026-05-12）──────────────

/** TDX 子物件是否在新鮮窗口內（< 24h） */
export const IsTdxBlockFresh = (tdx: FlightRegistryTdxBlock | undefined): boolean => {
  if (!tdx?.fetchedAtMillis) return false;
  return Date.now() - tdx.fetchedAtMillis < TDX_FRESH_MS;
};

export interface SaveTdxBlockInput {
  flightNo: string;
  airlineCode: string;
  airlineName: string;
  tdx: Omit<FlightRegistryTdxBlock, 'fetchedAtMillis'>;
}

/**
 * 寫入 / 更新 flight_registry doc 的 tdx 子物件 + 共用識別欄位
 * - 不動既有 Aviation Edge 寫入的 schedules / departureAirport / arrivalAirport / terminal / status
 *   （這些欄位由 SaveFlightToRegistry 維護，TDX 寫入時用 dot path 精準寫 tdx.* 子欄位避免覆蓋）
 * - lastUpdated 用 serverTimestamp（任一來源更新都刷）
 * - 寫入失敗 silent log（不 throw）
 */
export const SaveTdxBlockToRegistry = async (input: SaveTdxBlockInput): Promise<void> => {
  const db = _getDb();
  if (!db) return;
  try {
    const ref = db.collection(COLLECTION).doc(input.flightNo);
    // 用 set + merge：tdx 整個物件覆蓋（含 fetchedAtMillis 重置），共用欄位 merge 進去
    await ref.set({
      flightNo: input.flightNo,
      airlineCode: input.airlineCode,
      airlineName: input.airlineName,
      lastUpdated: FieldValue.serverTimestamp(),
      tdx: {
        ...input.tdx,
        fetchedAtMillis: Date.now(),
      },
    }, { merge: true });
  } catch (err) {
    console.error(`[flight-registry] tdx write failed (${input.flightNo}):`, err);
  }
};

// ── Manual schedule read / write helpers（spec 2026-05-12 manual-fallback-ui）──

/** Manual schedule 是否還在 TTL 內（60 天） */
export const IsManualScheduleFresh = (
  schedule: FlightRegistryManualSchedule | undefined,
): boolean => {
  if (!schedule?.submittedAtMillis) return false;
  return Date.now() - schedule.submittedAtMillis < MANUAL_FRESH_MS;
};

/** 取出指定日期 + 方向的 manual schedule（沒有則 null） */
export const GetManualSchedule = (
  doc: FlightRegistryDoc | null,
  date: string,
  direction: FlightDirection,
): FlightRegistryManualSchedule | null => {
  if (!doc?.manualSchedules) return null;
  return doc.manualSchedules[MakeScheduleKey(date, direction)] ?? null;
};

export interface SaveManualScheduleInput {
  flightNo: string;
  airlineCode: string;
  airlineName: string;
  date: string;
  direction: FlightDirection;
  schedule: Omit<FlightRegistryManualSchedule, 'submittedAtMillis'>;
}

/**
 * 寫入 / 更新 flight_registry doc 的 manualSchedules[key] 子物件
 * - 用 dot path 精準寫 manualSchedules.{key}，不動 schedules / tdx 子物件
 * - 共用識別欄位（airlineCode / airlineName / lastUpdated）也 merge 進去
 * - 寫入失敗 silent log（不 throw）
 */
export const SaveManualScheduleToRegistry = async (
  input: SaveManualScheduleInput,
): Promise<void> => {
  const db = _getDb();
  if (!db) return;
  try {
    const ref = db.collection(COLLECTION).doc(input.flightNo);
    const key = MakeScheduleKey(input.date, input.direction);
    await ref.set({
      flightNo: input.flightNo,
      airlineCode: input.airlineCode,
      airlineName: input.airlineName,
      lastUpdated: FieldValue.serverTimestamp(),
      manualSchedules: {
        [key]: {
          ...input.schedule,
          submittedAtMillis: Date.now(),
        },
      },
    }, { merge: true });
  } catch (err) {
    console.error(`[flight-registry] manual write failed (${input.flightNo}):`, err);
  }
};
