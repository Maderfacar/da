/**
 * Phase 1F：Soft Match / 重新配對 server-side helpers
 *
 * 設計：
 *   - 所有狀態欄位仍在 `orders/{orderId}` doc 內（不開新 collection）。
 *   - 新欄位：
 *       passengerConfirmationStatus?: 'auto' | 'pending' | 'accepted' | 'declined'
 *       reMatchRound?: number          // default 0；每次 rematch +1
 *       bidHistory?: Array<{ round, bids, endReason, endedAt, endedBy? }>
 *   - 不引入新 status enum；rematch 把 status 從 'confirmed' 重置回 'pending'，
 *     並把當下 bids snapshot 推到 bidHistory，清掉 driverId / assignedAt 等欄位。
 *
 * 兩個觸發點都呼叫 `rematchOrder()`：
 *   1. admin POST /admin/orders/[orderId]/rematch
 *   2. passenger soft-match-decision 選 'wait'
 */
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { OrderBidEntry } from '@@/utils/order-dispatch';
import { DispatchGuardError } from '@@/utils/order-dispatch';
import { isSoftMatch as _isSoftMatch, type DriverMatchResult } from '~shared/orderDispatch';

export type PassengerConfirmationStatus = 'auto' | 'pending' | 'accepted' | 'declined';

export type RematchEndReason =
  | 'assigned'                  // 預留：assign 成功落定（暫不寫；assign 成功不會經 rematchOrder）
  | 'rematched_by_passenger'    // passenger Soft Match 選 wait
  | 'rematched_by_admin';       // admin 強制重新配對

export interface BidHistoryEntry {
  round: number;
  bids: OrderBidEntry[];
  endReason: RematchEndReason;
  endedAt: Timestamp;
  endedBy?: string;             // admin lineUid（rematched_by_admin 時）
}

/**
 * 判定 Soft Match — re-export `~shared/orderDispatch` 的同名純函式，
 * 給呼叫端方便（不必跨 import 邏輯與 server 動作分開）
 */
export const isSoftMatch = _isSoftMatch;

export interface RematchResult {
  /** 被「踢出」的中選 driver lineUid（已從 order.driverId 清掉）；用來推 deselect 通知 */
  prevDriverLineUid: string;
  /** 新的 reMatchRound */
  reMatchRound: number;
}

/**
 * Phase 1F：把 confirmed 訂單「重置」回 pending（觸發新一輪喊單）。
 *
 * 動作（transaction）：
 *   - 守 order.orderStatus === 'confirmed'
 *   - 守 order.assignedDriverId 存在（否則 invalid_status）
 *   - 把目前 { bids, driverId, assignedAt, assignedBy } snapshot 推到 bidHistory
 *   - 清 assignedDriverId / assignedAt / assignedBy / bids / passengerConfirmationStatus
 *   - dispatchAt = serverTimestamp（重新「派發」）
 *   - reMatchRound = (現有 + 1)
 *   - orderStatus = 'pending'
 *
 * @returns 原中選 driver 的 lineUid（去 prefix）+ 新 reMatchRound
 */
export async function rematchOrder(
  db: Firestore,
  orderId: string,
  reason: RematchEndReason,
  adminLineUid?: string,
): Promise<RematchResult> {
  const ref = db.collection('orders').doc(orderId);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'confirmed') throw new DispatchGuardError('invalid_status');
    const assignedRaw = (d.assignedDriverId as string | undefined) ?? '';
    if (!assignedRaw) throw new DispatchGuardError('invalid_status');

    const prevDriverLineUid = assignedRaw.startsWith('line:') ? assignedRaw.slice(5) : assignedRaw;
    const currentRound = typeof d.reMatchRound === 'number' ? d.reMatchRound : 0;
    const nextRound = currentRound + 1;

    const bidsSnapshot = (Array.isArray(d.bids) ? d.bids : []) as OrderBidEntry[];
    const prevHistory = (Array.isArray(d.bidHistory) ? d.bidHistory : []) as BidHistoryEntry[];

    const historyEntry: Record<string, unknown> = {
      round: currentRound,
      bids: bidsSnapshot,
      endReason: reason,
      endedAt: new Date(),
    };
    if (adminLineUid) historyEntry.endedBy = adminLineUid;

    // 用 read-then-write 取代 arrayUnion（同 1E appendBid 慣例；避免 serverTimestamp / 物件相等比對風險）
    const updates: Record<string, unknown> = {
      orderStatus: 'pending',
      assignedDriverId: FieldValue.delete(),
      assignedAt: FieldValue.delete(),
      assignedBy: FieldValue.delete(),
      bids: [],
      passengerConfirmationStatus: FieldValue.delete(),
      dispatchAt: FieldValue.serverTimestamp(),
      reMatchRound: nextRound,
      bidHistory: [...prevHistory, historyEntry],
    };

    tx.update(ref, updates);

    return { prevDriverLineUid, reMatchRound: nextRound };
  });
}

/**
 * Phase 1F：把 confirmed 訂單的 passengerConfirmationStatus 改為 'accepted'
 * （passenger 收 Soft Match Flex 後選「接受此車」）。
 *
 * 守則：
 *   - order.orderStatus === 'confirmed'
 *   - passengerConfirmationStatus === 'pending'
 */
export async function acceptSoftMatch(db: Firestore, orderId: string): Promise<void> {
  const ref = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'confirmed') throw new DispatchGuardError('invalid_status');
    if (d.passengerConfirmationStatus !== 'pending') {
      throw new DispatchGuardError('invalid_status');
    }
    tx.update(ref, { passengerConfirmationStatus: 'accepted' });
  });
}

/**
 * Phase 1F：passenger 收 Soft Match 後選「全額退款 / 取消訂單」
 *
 * 後付政策（拍版 #8）：實際上就是 cancelled，無真實退款動作。
 * 守則：
 *   - order.orderStatus === 'confirmed'
 *   - passengerConfirmationStatus === 'pending'
 *
 * 動作：
 *   - orderStatus = 'cancelled'
 *   - passengerConfirmationStatus = 'declined'
 *   - cancelReason snapshot（給 admin 看為何取消）
 *   - statusHistory.cancelledAt
 *
 * @returns 原中選 driver lineUid（去 prefix），呼叫端用來推 deselect 通知。
 */
export async function declineSoftMatch(
  db: Firestore,
  orderId: string,
  cancelReason: string,
): Promise<{ prevDriverLineUid: string }> {
  const ref = db.collection('orders').doc(orderId);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DispatchGuardError('order_not_found');
    const d = snap.data() ?? {};
    if (d.orderStatus !== 'confirmed') throw new DispatchGuardError('invalid_status');
    if (d.passengerConfirmationStatus !== 'pending') {
      throw new DispatchGuardError('invalid_status');
    }
    const assignedRaw = (d.assignedDriverId as string | undefined) ?? '';
    const prevDriverLineUid = assignedRaw.startsWith('line:') ? assignedRaw.slice(5) : assignedRaw;
    tx.update(ref, {
      orderStatus: 'cancelled',
      passengerConfirmationStatus: 'declined',
      cancelReason,
      'statusHistory.cancelledAt': FieldValue.serverTimestamp(),
    });
    return { prevDriverLineUid };
  });
}

/**
 * 給 admin endpoint 用 — 判 driver match 結果是否 soft，並順便回傳對應的 confirmation status。
 *
 * 用法：
 *   const { isSoft, confirmationStatus } = decideConfirmationStatus(preferenceTagIds, matchResult);
 */
export function decideConfirmationStatus(
  preferenceTagIds: ReadonlyArray<string>,
  match: Pick<DriverMatchResult, 'matchCount'>,
): { isSoft: boolean; confirmationStatus: PassengerConfirmationStatus } {
  const soft = isSoftMatch(preferenceTagIds, match);
  return { isSoft: soft, confirmationStatus: soft ? 'pending' : 'auto' };
}
