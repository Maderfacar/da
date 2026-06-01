/**
 * Order dispatch / bidding server-side helpers — Phase 1E
 *
 * 設計：
 *   - 所有狀態都在 `orders/{orderId}` doc 內（不開新 collection）
 *   - bids 為 append-only 陣列；撤回靠 `withdrawnAt` mark，保留歷史
 *   - 多 driver 同時 bid 或 admin 同時 assign 都用 firestore transaction 守
 *   - matchCount 不存進 bid，admin 看 bids 時即時讀 driver doc 計算
 *
 * 訂單欄位（top-level）：
 *   dispatchAt?: Timestamp        // admin 發單時間（null = 未派發）
 *   dispatchedBy?: string         // admin lineUid（去 prefix）
 *   bids?: OrderBidEntry[]        // append-only
 *   assignedAt?: Timestamp
 *   assignedBy?: string
 *
 * bid 結構：
 *   { driverId: string,           // lineUid（無 'line:' prefix）
 *     driverDisplayName: string,  // snapshot at bid time
 *     bidAt: Timestamp,
 *     withdrawnAt?: Timestamp }
 */
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { computeDriverMatch, type DispatchTagIndexEntry, type DriverMatchResult } from '~shared/orderDispatch';
import type { TagLang } from '~shared/tagTaxonomy';
import { DRIVER_CATEGORY, type DriverCategory } from '~shared/types/driver-category';
import {
  isDispatchLevel,
  type DispatchLevel,
  type DispatchLevelChangeReason,
} from '~shared/types/dispatch-visibility';
import { nextLowerLevel } from '@@/utils/dispatch-duration';

export interface OrderBidEntry {
  driverId: string;
  driverDisplayName: string;
  bidAt: Timestamp | null;
  withdrawnAt?: Timestamp | null;
}

export interface OrderBidEntryDto {
  driverId: string;
  driverDisplayName: string;
  bidAt: string | null;
  withdrawnAt: string | null;
}

export interface ActiveDriverInfo {
  /** users.lineUserId（= LINE userId；passenger/driver OA push 用） */
  lineUserId: string;
  /** users doc id（= 去 prefix 的 lineUid） */
  lineUid: string;
  displayName: string;
}

const _tsToIso = (ts: Timestamp | null | undefined): string | null =>
  ts ? ts.toDate().toISOString() : null;

const _stripLinePrefix = (id: string): string => (id.startsWith('line:') ? id.slice(5) : id);

/**
 * 把 Firestore 內 raw bids 序列化成 DTO（Timestamp → ISO）。
 */
export function serializeBids(rawBids: unknown): OrderBidEntryDto[] {
  if (!Array.isArray(rawBids)) return [];
  return rawBids.map((b) => {
    const bid = b as Partial<OrderBidEntry>;
    return {
      driverId: bid.driverId ?? '',
      driverDisplayName: bid.driverDisplayName ?? '',
      bidAt: _tsToIso(bid.bidAt ?? null),
      withdrawnAt: _tsToIso(bid.withdrawnAt ?? null),
    };
  });
}

/**
 * 列出所有「approved=true & roles 含 driver」的司機 — 給 dispatch 推播 / admin 看 bids 用。
 *
 * Wave 2B+2C：opts.minCategory 設定後，會以 `drivers/{uid}.driverCategory >= minCategory`
 *  進一步過濾；缺 drivers doc 視為 NOVICE='0'。讀法：先撈 users，再 batch getAll drivers。
 *  不傳 minCategory 等價於舊行為（全 approved driver）。
 *
 * 注意：撈 users collection（drivers collection 主要存 stats / category）；用 users.approved 判斷。
 */
export interface LoadActiveDriversOptions {
  /** 最低 driverCategory；未傳 / '0' 等價於不過濾 */
  minCategory?: DispatchLevel;
}

export async function loadActiveDrivers(
  db: Firestore,
  opts?: LoadActiveDriversOptions,
): Promise<ActiveDriverInfo[]> {
  const snap = await db.collection('users')
    .where('roles', 'array-contains', 'driver')
    .get();
  const list: ActiveDriverInfo[] = [];
  snap.docs.forEach((doc) => {
    const d = doc.data();
    if (d.approved !== true) return;
    const lineUserId = (d.lineUserId as string | undefined) ?? '';
    if (!lineUserId) return;
    list.push({
      lineUserId,
      lineUid: doc.id,
      displayName: (d.displayName as string | undefined) ?? '',
    });
  });

  const minCategory = opts?.minCategory;
  if (!minCategory || minCategory === DRIVER_CATEGORY.NOVICE) {
    // '0' = 全開，無需 join drivers doc
    return list;
  }

  if (list.length === 0) return list;
  const refs = list.map((d) => db.collection('drivers').doc(d.lineUid));
  let categoryByUid = new Map<string, DriverCategory>();
  try {
    const snaps = await db.getAll(...refs);
    snaps.forEach((s) => {
      const raw = s.exists ? (s.data()?.driverCategory as unknown) : undefined;
      const cat: DriverCategory = (raw === '1' || raw === '2') ? raw : '0';
      categoryByUid.set(s.id, cat);
    });
  } catch (err) {
    // 取不到 driverCategory：safety = 全部當 '0' 過濾掉（不誤推給未驗證司機）
    console.warn('[order-dispatch] batch read drivers.driverCategory failed:', err);
    categoryByUid = new Map();
  }

  return list.filter((d) => {
    const cat = categoryByUid.get(d.lineUid) ?? '0';
    return cat >= minCategory; // 字串比較 '0'/'1'/'2' 字典序 OK
  });
}

/** 撈單一 driver 的 displayName（給 bid snapshot 用；不存在回空字串） */
export async function loadDriverDisplayName(db: Firestore, lineUid: string): Promise<string> {
  try {
    const snap = await db.collection('users').doc(lineUid).get();
    if (!snap.exists) return '';
    return (snap.data()?.displayName as string | undefined) ?? '';
  } catch (err) {
    console.warn('[order-dispatch] loadDriverDisplayName failed:', err);
    return '';
  }
}

/**
 * 撈單一 driver 的 driverCategory（給 server-side filter / bid 守則用）。
 *
 * Wave 2B+2C：drivers/{uid}.driverCategory，舊資料或 doc 不存在皆 fallback '0' NOVICE。
 *  - 任何讀取失敗也回 '0'，避免 NOVICE 司機因 drivers doc bug 看不到任何訂單。
 *  - 副作用：搬到 server-side 後不再 client filter（client UI 根本拿不到資料 → 無 toast UX）。
 */
export async function loadDriverCategory(db: Firestore, lineUid: string): Promise<DriverCategory> {
  try {
    const snap = await db.collection('drivers').doc(lineUid).get();
    if (!snap.exists) return DRIVER_CATEGORY.NOVICE;
    const raw = snap.data()?.driverCategory as unknown;
    return (raw === '1' || raw === '2') ? raw : DRIVER_CATEGORY.NOVICE;
  } catch (err) {
    console.warn('[order-dispatch] loadDriverCategory failed:', err);
    return DRIVER_CATEGORY.NOVICE;
  }
}

export type DispatchGuardCode =
  | 'order_not_found'
  | 'invalid_status'
  | 'already_dispatched'
  | 'already_assigned'
  | 'driver_already_bid'
  | 'bid_not_found'
  | 'driver_not_in_bids'
  | 'level_mismatch'
  | 'already_at_lowest_level'
  | 'level_changed';

export class DispatchGuardError extends Error {
  constructor(public code: DispatchGuardCode) {
    super(code);
  }
}

/**
 * Admin 發單 — transaction 守 status='pending' && dispatchAt 為 null。
 *
 * 寫入：
 *  - dispatchAt = serverTimestamp + dispatchedBy = adminLineUid
 *  - Wave 2B+2C：dispatchVisibility = { startLevel, currentLevel=startLevel, openedAt, history[init] }
 *
 * 注意 array 內不可帶 serverTimestamp，levelHistory 用 client time 寫入（與 bids 同策略）。
 *
 * 失敗 throw DispatchGuardError。
 */
export async function dispatchOrder(
  db: Firestore,
  orderId: string,
  adminLineUid: string,
  startLevel: DispatchLevel = '0',
): Promise<void> {
  const ref = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'pending') throw new DispatchGuardError('invalid_status');
    if (d.dispatchAt) throw new DispatchGuardError('already_dispatched');
    const now = new Date();
    tx.update(ref, {
      dispatchAt: FieldValue.serverTimestamp(),
      dispatchedBy: adminLineUid,
      dispatchVisibility: {
        startLevel,
        currentLevel: startLevel,
        openedAt: FieldValue.serverTimestamp(),
        levelHistory: [{
          level: startLevel,
          openedAt: now,
          openedBy: adminLineUid,
          reason: 'init',
        }],
      },
    });
  });
}

/**
 * Driver 喊單 — transaction 守訂單仍為 pending、已 dispatched、未指派、自己沒未撤回 bid。
 *
 * Wave 2B+2C：driverCategory 必須 >= order.dispatchVisibility.currentLevel
 *  正常 client UI 取不到該訂單 → 走到此分支表示直打 API；throw level_mismatch
 *  讓 endpoint 寫 anomaly log + 回 403。caller 在進 transaction 前讀 driverCategory，
 *  避免在 transaction 內額外讀 drivers/{uid} 增加 contention。
 */
export async function appendBid(
  db: Firestore,
  orderId: string,
  driverLineUid: string,
  driverDisplayName: string,
  driverCategory: DriverCategory,
): Promise<void> {
  const ref = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'pending') throw new DispatchGuardError('invalid_status');
    if (!d.dispatchAt) throw new DispatchGuardError('invalid_status');
    if (d.assignedDriverId) throw new DispatchGuardError('already_assigned');

    const vis = (d.dispatchVisibility ?? null) as { currentLevel?: unknown } | null;
    const currentLevel: DispatchLevel =
      typeof vis?.currentLevel === 'string' && (vis!.currentLevel === '0' || vis!.currentLevel === '1' || vis!.currentLevel === '2')
        ? vis!.currentLevel
        : '0';
    if (driverCategory < currentLevel) {
      throw new DispatchGuardError('level_mismatch');
    }

    const bids = (Array.isArray(d.bids) ? d.bids : []) as OrderBidEntry[];
    const hasActive = bids.some((b) => b.driverId === driverLineUid && !b.withdrawnAt);
    if (hasActive) throw new DispatchGuardError('driver_already_bid');

    const newBid: OrderBidEntry = {
      driverId: driverLineUid,
      driverDisplayName,
      // 注意：array union 內不能含 serverTimestamp，改用 client 時間（Date.now()）
      bidAt: new Date() as unknown as Timestamp,
    };
    tx.update(ref, { bids: [...bids, newBid] });
  });
}

/**
 * Driver 撤回喊單 — 把對應的 active bid 加上 withdrawnAt。
 */
export async function withdrawBid(
  db: Firestore,
  orderId: string,
  driverLineUid: string,
): Promise<void> {
  const ref = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'pending') throw new DispatchGuardError('invalid_status');
    if (d.assignedDriverId) throw new DispatchGuardError('already_assigned');

    const bids = (Array.isArray(d.bids) ? d.bids : []) as OrderBidEntry[];
    const idx = bids.findIndex((b) => b.driverId === driverLineUid && !b.withdrawnAt);
    if (idx < 0) throw new DispatchGuardError('bid_not_found');

    const newBids = bids.map((b, i) =>
      i === idx
        ? { ...b, withdrawnAt: new Date() as unknown as Timestamp }
        : b,
    );
    tx.update(ref, { bids: newBids });
  });
}

/**
 * Admin 指派司機 — transaction 守訂單未指派、driverId 在 bids 內且未撤回。
 *
 * 寫入 `assignedDriverId`（強制 'line:Uxxx' 格式，與既有訂單流程一致）、
 * `orderStatus='confirmed'`、`assignedAt`、`assignedBy`、`statusHistory.confirmedAt`。
 */
export async function assignDriver(
  db: Firestore,
  orderId: string,
  driverLineUid: string,
  adminLineUid: string,
): Promise<void> {
  const ref = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'pending') throw new DispatchGuardError('invalid_status');
    if (!d.dispatchAt) throw new DispatchGuardError('invalid_status');
    if (d.assignedDriverId) throw new DispatchGuardError('already_assigned');

    const bids = (Array.isArray(d.bids) ? d.bids : []) as OrderBidEntry[];
    const target = bids.find((b) => b.driverId === driverLineUid && !b.withdrawnAt);
    if (!target) throw new DispatchGuardError('driver_not_in_bids');

    tx.update(ref, {
      assignedDriverId: `line:${driverLineUid}`,
      orderStatus: 'confirmed',
      assignedAt: FieldValue.serverTimestamp(),
      assignedBy: adminLineUid,
      'statusHistory.confirmedAt': FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Wave 2D：分級派單降級 transaction。
 *
 * 三種觸發共用同一段 atomic update：
 *   - mode='downgrade'      → admin 立即降一級（actor=adminLineUid，reason='manual-downgrade'）
 *   - mode='force-open'     → admin 全開放（actor=adminLineUid，reason='force-open-all'）
 *   - mode='auto-downgrade' → driver GET lazy 觸發（actor='system'，reason='auto-downgrade'）
 *
 * 守則：
 *   - 訂單必須存在、status='pending'、已 dispatched、未指派 driver
 *   - currentLevel !== '0'（否則 already_at_lowest_level）
 *   - 'auto-downgrade' 模式需傳 expectedLevel；若 fresh read 後 currentLevel 已變 → level_changed（避免兩司機同時 GET 重複降級）
 *
 * 寫入：
 *   - dispatchVisibility.currentLevel = newLevel
 *   - dispatchVisibility.openedAt = serverTimestamp
 *   - dispatchVisibility.levelHistory append 一筆 entry（array 內用 client Date；與 bids 同策略）
 *
 * @returns { previousLevel, newLevel } — 給 caller 寫 audit log + 觸發 multicast
 */
export type DowngradeMode = 'downgrade' | 'force-open' | 'auto-downgrade';

const _modeToReason = (mode: DowngradeMode): DispatchLevelChangeReason => {
  if (mode === 'force-open') return 'force-open-all';
  if (mode === 'auto-downgrade') return 'auto-downgrade';
  return 'manual-downgrade';
};

export interface DowngradeResult {
  previousLevel: DispatchLevel;
  newLevel: DispatchLevel;
}

export async function downgradeDispatchLevel(
  db: Firestore,
  orderId: string,
  options: {
    mode: DowngradeMode;
    /** adminLineUid（manual / force-open）；'system'（auto-downgrade） */
    actor: string;
    /** 'auto-downgrade' 必傳 — race condition 守則：與 fresh read 比對 currentLevel 是否變動 */
    expectedLevel?: DispatchLevel;
  },
): Promise<DowngradeResult> {
  const ref = db.collection('orders').doc(orderId);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'pending') throw new DispatchGuardError('invalid_status');
    if (!d.dispatchAt) throw new DispatchGuardError('invalid_status');
    if (d.assignedDriverId) throw new DispatchGuardError('already_assigned');

    const vis = (d.dispatchVisibility ?? null) as
      | { currentLevel?: unknown; levelHistory?: unknown[] }
      | null;
    const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';

    // lazy auto-downgrade 防 race：若被另一 request 降過則 skip（caller 不視為錯誤）
    if (options.mode === 'auto-downgrade') {
      if (!options.expectedLevel) {
        throw new Error('downgradeDispatchLevel: auto-downgrade mode requires expectedLevel');
      }
      if (currentLevel !== options.expectedLevel) {
        throw new DispatchGuardError('level_changed');
      }
    }

    if (currentLevel === '0') throw new DispatchGuardError('already_at_lowest_level');

    // 計算新等級：force-open 直降 '0'；downgrade / auto-downgrade 降一級
    let newLevel: DispatchLevel;
    if (options.mode === 'force-open') {
      newLevel = '0';
    } else {
      const next = nextLowerLevel(currentLevel);
      if (!next) throw new DispatchGuardError('already_at_lowest_level');
      newLevel = next;
    }

    const prevHistory = Array.isArray(vis?.levelHistory)
      ? (vis!.levelHistory as Array<Record<string, unknown>>)
      : [];
    const now = new Date();
    tx.update(ref, {
      'dispatchVisibility.currentLevel': newLevel,
      'dispatchVisibility.openedAt': FieldValue.serverTimestamp(),
      'dispatchVisibility.levelHistory': [
        ...prevHistory,
        {
          level: newLevel,
          openedAt: now,
          openedBy: options.actor,
          reason: _modeToReason(options.mode),
        },
      ],
    });
    return { previousLevel: currentLevel, newLevel };
  });
}

export interface BidWithMatchInfo {
  driverId: string;
  driverDisplayName: string;
  bidAt: string | null;
  withdrawnAt: string | null;
  matchCount: number;
  matchedTagNames: string[];
  preferenceCount: number;
  completedOrders: number;
  verifiedAt: string | null;
  /** admin 審核司機背書用：vehicleCapacity.trunkPhotoUrl 對應車型描述（airport-calibration wave 後取代 SU 顯示） */
  trunkPhotoUrl: string | null;
}

/**
 * 給 admin GET /bids endpoint 用 — 載 order doc + 每個 bid 對應的 driver 資訊並計算 match。
 *
 * 規則：
 *   - 撤回的 bid 仍 echo（前端用 withdrawnAt 灰掉）
 *   - matchCount 即時算（讀 drivers/{lineUid}.vehicleProfile.tags + tags）
 *   - completedOrders 來自 drivers/{lineUid}.totalTrips（既有 P18 statsfield）
 *   - verifiedAt 來自 drivers/{lineUid}.verifiedAt
 */
export async function loadBidsWithDriverInfo(
  db: Firestore,
  orderId: string,
  tagIndex: ReadonlyMap<string, DispatchTagIndexEntry>,
  lang: TagLang,
): Promise<{ orderExists: boolean; preferenceTagIds: string[]; bids: BidWithMatchInfo[] }> {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { orderExists: false, preferenceTagIds: [], bids: [] };

  const order = orderSnap.data() ?? {};
  const rawBids = (Array.isArray(order.bids) ? order.bids : []) as OrderBidEntry[];
  const preferences = order.preferences as { tagIds?: unknown } | undefined;
  const preferenceTagIds = Array.isArray(preferences?.tagIds) ? (preferences!.tagIds as string[]) : [];

  if (rawBids.length === 0) {
    return { orderExists: true, preferenceTagIds, bids: [] };
  }

  // 批次讀 drivers doc（每個獨立 bid 對應一個 driver；同 driver 多筆 bid 撤回後重 bid 罕見）
  const driverIds = Array.from(new Set(rawBids.map((b) => b.driverId).filter(Boolean)));
  type DriverEntry = {
    vehicleProfileTags: string[];
    driverScopeTags: string[];
    completedOrders: number;
    verifiedAt: string | null;
    trunkPhotoUrl: string | null;
  };
  const driverDataMap = new Map<string, DriverEntry>();

  if (driverIds.length > 0) {
    const refs = driverIds.map((id) => db.collection('drivers').doc(id));
    try {
      const snaps = await db.getAll(...refs);
      snaps.forEach((s) => {
        if (!s.exists) {
          driverDataMap.set(s.id, { vehicleProfileTags: [], driverScopeTags: [], completedOrders: 0, verifiedAt: null, trunkPhotoUrl: null });
          return;
        }
        const data = s.data() ?? {};
        const vp = (data.vehicleProfile as { tags?: unknown } | undefined) ?? null;
        const vehicleProfileTags = Array.isArray(vp?.tags) ? (vp!.tags as string[]) : [];
        const driverScopeTags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
        const completedOrders = typeof data.totalTrips === 'number' ? data.totalTrips : 0;
        const verifiedAt = _tsToIso(data.verifiedAt as Timestamp | null | undefined);
        const vc = (data.vehicleCapacity as { trunkPhotoUrl?: unknown } | undefined) ?? null;
        const trunkPhotoUrl = typeof vc?.trunkPhotoUrl === 'string' ? vc.trunkPhotoUrl : null;
        driverDataMap.set(s.id, { vehicleProfileTags, driverScopeTags, completedOrders, verifiedAt, trunkPhotoUrl });
      });
    } catch (err) {
      console.error('[order-dispatch] batch read drivers failed:', err);
    }
  }

  const bids: BidWithMatchInfo[] = rawBids.map((b) => {
    const driver = driverDataMap.get(b.driverId) ?? { vehicleProfileTags: [], driverScopeTags: [], completedOrders: 0, verifiedAt: null, trunkPhotoUrl: null };
    const match: DriverMatchResult = computeDriverMatch(
      preferenceTagIds,
      {
        driverId: b.driverId,
        vehicleProfileTags: driver.vehicleProfileTags,
        driverScopeTags: driver.driverScopeTags,
      },
      tagIndex,
      lang,
    );
    return {
      driverId: b.driverId,
      driverDisplayName: b.driverDisplayName,
      bidAt: _tsToIso(b.bidAt ?? null),
      withdrawnAt: _tsToIso(b.withdrawnAt ?? null),
      matchCount: match.matchCount,
      matchedTagNames: match.matched.map((m) => m.name),
      preferenceCount: match.preferenceCount,
      completedOrders: driver.completedOrders,
      verifiedAt: driver.verifiedAt,
      trunkPhotoUrl: driver.trunkPhotoUrl,
    };
  });

  return { orderExists: true, preferenceTagIds, bids };
}

/** 取出某筆訂單目前所有「未撤回」bid 的 driverId（去前綴的 lineUid） */
export function activeBidderLineUids(rawBids: unknown): string[] {
  if (!Array.isArray(rawBids)) return [];
  return (rawBids as OrderBidEntry[])
    .filter((b) => b && b.driverId && !b.withdrawnAt)
    .map((b) => b.driverId)
    .filter((id, i, arr) => arr.indexOf(id) === i);
}

export { _stripLinePrefix };
