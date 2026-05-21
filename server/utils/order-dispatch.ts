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
 * 注意：撈 users collection（drivers collection 主要存 stats）；用 users.approved 判斷。
 */
export async function loadActiveDrivers(db: Firestore): Promise<ActiveDriverInfo[]> {
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
  return list;
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

export type DispatchGuardCode =
  | 'order_not_found'
  | 'invalid_status'
  | 'already_dispatched'
  | 'already_assigned'
  | 'driver_already_bid'
  | 'bid_not_found'
  | 'driver_not_in_bids';

export class DispatchGuardError extends Error {
  constructor(public code: DispatchGuardCode) {
    super(code);
  }
}

/**
 * Admin 發單 — transaction 守 status='pending' && dispatchAt 為 null。
 *
 * 寫入：dispatchAt = now（serverTimestamp）+ dispatchedBy = adminLineUid。
 * 失敗 throw DispatchGuardError。
 */
export async function dispatchOrder(
  db: Firestore,
  orderId: string,
  adminLineUid: string,
): Promise<void> {
  const ref = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'pending') throw new DispatchGuardError('invalid_status');
    if (d.dispatchAt) throw new DispatchGuardError('already_dispatched');
    tx.update(ref, {
      dispatchAt: FieldValue.serverTimestamp(),
      dispatchedBy: adminLineUid,
    });
  });
}

/**
 * Driver 喊單 — transaction 守訂單仍為 pending、已 dispatched、未指派、自己沒未撤回 bid。
 */
export async function appendBid(
  db: Firestore,
  orderId: string,
  driverLineUid: string,
  driverDisplayName: string,
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
  const driverDataMap = new Map<string, { vehicleProfileTags: string[]; driverScopeTags: string[]; completedOrders: number; verifiedAt: string | null }>();

  if (driverIds.length > 0) {
    const refs = driverIds.map((id) => db.collection('drivers').doc(id));
    try {
      const snaps = await db.getAll(...refs);
      snaps.forEach((s) => {
        if (!s.exists) {
          driverDataMap.set(s.id, { vehicleProfileTags: [], driverScopeTags: [], completedOrders: 0, verifiedAt: null });
          return;
        }
        const data = s.data() ?? {};
        const vp = (data.vehicleProfile as { tags?: unknown } | undefined) ?? null;
        const vehicleProfileTags = Array.isArray(vp?.tags) ? (vp!.tags as string[]) : [];
        const driverScopeTags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
        const completedOrders = typeof data.totalTrips === 'number' ? data.totalTrips : 0;
        const verifiedAt = _tsToIso(data.verifiedAt as Timestamp | null | undefined);
        driverDataMap.set(s.id, { vehicleProfileTags, driverScopeTags, completedOrders, verifiedAt });
      });
    } catch (err) {
      console.error('[order-dispatch] batch read drivers failed:', err);
    }
  }

  const bids: BidWithMatchInfo[] = rawBids.map((b) => {
    const driver = driverDataMap.get(b.driverId) ?? { vehicleProfileTags: [], driverScopeTags: [], completedOrders: 0, verifiedAt: null };
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
