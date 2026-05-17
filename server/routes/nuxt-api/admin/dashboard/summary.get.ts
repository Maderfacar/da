/**
 * GET /nuxt-api/admin/dashboard/summary
 *
 * Admin Dashboard 總覽資料（admin-auto-notify-dashboard 變更 + 後續強化）。
 *
 * 回傳：
 *   - 線上名單：5 分鐘內活躍的乘客 / 司機
 *   - 訂單狀態計數：待確認（pending/confirmed）、進行中（en_route/arrived_pickup/in_transit）
 *   - 啟用中折扣碼：enabled 且目前在有效時間區間內
 *
 * 機場人流（今日入境/出境）由前端另打 /api/airport/flow（lazy fetch + 快取語意不同）。
 *
 * 線上判定 5 分鐘；乘客 lastSeenAt 僅登入時更新（陽春版接受，前端標「資料時間」）。
 * 權限：任何 admin role（read-only 維運總覽）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { Timestamp } from 'firebase-admin/firestore';
import type { DiscountCodeDoc } from '@@/utils/discount-code';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

// 訂單狀態分組（en_route 起 3 種為「進行中」；pending/confirmed 為「待確認」）
const PENDING_CONFIRM_STATUSES = ['pending', 'confirmed'];
const IN_PROGRESS_STATUSES = ['en_route', 'arrived_pickup', 'in_transit'];
const ACTIVE_STATUSES = [...PENDING_CONFIRM_STATUSES, ...IN_PROGRESS_STATUSES];

interface OnlineUserDoc {
  displayName?: string;
  pictureUrl?: string;
  lastSeenAt?: Timestamp;
}

interface OnlineDriverDoc {
  displayName?: string;
  pictureUrl?: string;
  lastActiveAt?: Timestamp;
  status?: string;
}

const _toIso = (ts: Timestamp | undefined): string => ts?.toDate().toISOString() ?? '';
const _tsToIso = (v: unknown): string => {
  const d = (v as { toDate?: () => Date } | null)?.toDate?.();
  return d ? d.toISOString() : '';
};
const _tsToMs = (v: unknown): number | null => {
  const d = (v as { toDate?: () => Date } | null)?.toDate?.();
  return d ? d.getTime() : null;
};

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const cutoff = Timestamp.fromMillis(Date.now() - ONLINE_WINDOW_MS);

    const [passengersSnap, driversSnap, activeOrdersSnap, discountSnap] = await Promise.all([
      db.collection('users').where('lastSeenAt', '>=', cutoff).get(),
      db.collection('drivers').where('lastActiveAt', '>=', cutoff).get(),
      db.collection('orders').where('orderStatus', 'in', ACTIVE_STATUSES).get(),
      db.collection('discount_codes').get(),
    ]);

    // ── 線上名單 ───────────────────────────────────────────
    const passengers = passengersSnap.docs
      .map((d) => {
        const data = d.data() as OnlineUserDoc;
        return {
          uid: d.id,
          displayName: data.displayName ?? '',
          pictureUrl: data.pictureUrl ?? '',
          lastSeenAt: _toIso(data.lastSeenAt),
        };
      })
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0));

    const drivers = driversSnap.docs
      .map((d) => {
        const data = d.data() as OnlineDriverDoc;
        return {
          uid: d.id,
          displayName: data.displayName ?? '',
          pictureUrl: data.pictureUrl ?? '',
          lastActiveAt: _toIso(data.lastActiveAt),
          driverStatus: data.status ?? '',
        };
      })
      .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0));

    // ── 訂單狀態計數 ───────────────────────────────────────
    let pendingConfirm = 0;
    let inProgress = 0;
    activeOrdersSnap.docs.forEach((d) => {
      const status = d.data().orderStatus as string;
      if (PENDING_CONFIRM_STATUSES.includes(status)) pendingConfirm += 1;
      else if (IN_PROGRESS_STATUSES.includes(status)) inProgress += 1;
    });

    // ── 啟用中折扣碼（enabled 且在有效時間區間內）──────────
    const nowMs = Date.now();
    const discountCodes = discountSnap.docs
      .map((d) => {
        const data = d.data() as Partial<DiscountCodeDoc>;
        return {
          code: d.id,
          discountAmount: typeof data.discountAmount === 'number' ? data.discountAmount : 0,
          validFrom: _tsToIso(data.validFrom),
          validUntil: _tsToIso(data.validUntil),
          validFromMs: _tsToMs(data.validFrom),
          validUntilMs: _tsToMs(data.validUntil),
          maxRedemptions: typeof data.maxRedemptions === 'number' ? data.maxRedemptions : null,
          redemptionCount: typeof data.redemptionCount === 'number' ? data.redemptionCount : 0,
          enabled: data.enabled === true,
        };
      })
      .filter((c) => {
        if (!c.enabled) return false;
        if (c.validFromMs !== null && nowMs < c.validFromMs) return false;
        if (c.validUntilMs !== null && nowMs > c.validUntilMs) return false;
        return true;
      })
      .map((c) => ({
        code: c.code,
        discountAmount: c.discountAmount,
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        maxRedemptions: c.maxRedemptions,
        redemptionCount: c.redemptionCount,
      }));

    return successResponse({
      passengers: { count: passengers.length, list: passengers },
      drivers: { count: drivers.length, list: drivers },
      orderCounts: { pendingConfirm, inProgress },
      discountCodes,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin/dashboard/summary GET] failed:', err);
    return serverError();
  }
});
