/**
 * GET /nuxt-api/driver/dispatched-orders — Phase 1E
 *
 * 司機接單看板：列所有「pending && dispatchAt != null && !assignedDriverId」訂單。
 *
 * Wave 2B+2C：driverCategory >= order.currentLevel 才看得到（server-side filter，
 *   client UI 根本拿不到資料）。舊單無 dispatchVisibility fallback '0'（全開），等同無變化。
 *
 * Wave 2D：lazy 自動降級 — 在 GET filter 前對「pending && 未指派」的訂單先檢查
 *   now > openedAt + duration[currentLevel] ?
 *   是 → transaction 降級（防 race）+ fire-and-forget LINE push 新加入等級的司機。
 *   降級寫完才執行 filter，確保「剛剛降級的訂單」在本次 response 內就以新等級判斷可見性。
 *
 * Response 每筆含 myBidStatus = 'none' | 'bid' | 'withdrawn'（依當前 driver 在 bids 內狀態）
 *
 * 認證：必須 driver role + approved（與 driver/apply 相同）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { successResponse, forbiddenError, serverError } from '@@/utils/response';
import { serializeOrderPreferences } from '@@/utils/order-preferences';
import {
  type OrderBidEntry,
  loadDriverCategory,
  downgradeDispatchLevel,
  DispatchGuardError,
} from '@@/utils/order-dispatch';
import { getNextDowngradeAt } from '@@/utils/dispatch-duration';
import { isDispatchLevel, type DispatchLevel } from '~shared/types/dispatch-visibility';
import {
  multicastLevelDown,
  getDispatchPushEnv,
  buildDispatchedOrderSummary,
} from '@@/utils/line-dispatch-push';
import { writeAuditLog } from '@@/utils/audit-log';
import type { Timestamp, Firestore  } from 'firebase-admin/firestore';
import type { H3Event } from 'h3';
import type { AuthOk } from '@@/utils/require-auth';

type GooglePlaceLite = { address: string; lat: number; lng: number; placeId?: string; displayName?: string; city?: string; district?: string };

/** 縣市過濾 helper — 與 admin/orders/index.get.ts 邏輯一致。
 *  歷史訂單無 city 欄位 → '__unknown__' bucket（UI 端用「未知」chip 對應）。*/
function _matchRegion(
  pickup: GooglePlaceLite | undefined,
  dropoff: GooglePlaceLite | undefined,
  regionField: 'pickup' | 'dropoff',
  cities: Set<string>,
  districts: Set<string>,
): boolean {
  if (cities.size === 0 && districts.size === 0) return true;
  const target = regionField === 'dropoff' ? dropoff : pickup;
  const city = (target?.city ?? '').trim();
  const district = (target?.district ?? '').trim();
  if (cities.size > 0) {
    const cityKey = city || '__unknown__';
    if (!cities.has(city) && !cities.has(cityKey)) return false;
  }
  if (districts.size > 0) {
    const districtKey = district || '__unknown__';
    if (!districts.has(district) && !districts.has(districtKey)) return false;
  }
  return true;
}

const _tsToIso = (ts: Timestamp | null | undefined): string | null =>
  ts ? ts.toDate().toISOString() : null;

interface LazyCandidate {
  orderId: string;
  expectedLevel: DispatchLevel;
}

/**
 * Wave 2D：對所有 pending && 未指派訂單跑 lazy auto-downgrade。
 *
 * 步驟：
 *  1. 篩出 nextDowngradeAt 已過 + currentLevel !== '0' 的 candidate
 *  2. 對每筆跑 downgradeDispatchLevel transaction（防 race）
 *  3. 成功降級者 fire-and-forget 推 LINE level-down 給新加入等級 driver + audit log
 *
 * 失敗（level_changed / already_at_lowest_level / 其他 guard）silent skip — 等下次 GET 再試。
 * 整體耗時：transaction ~50-150ms × N，N 通常 1-5 筆（流量低時段就是 cron 替代品）。
 */
async function _runLazyDowngrade(
  db: Firestore,
  event: H3Event,
  auth: AuthOk,
  orders: Array<{ id: string; data: Record<string, unknown> }>,
): Promise<void> {
  const now = Date.now();
  const candidates: LazyCandidate[] = [];
  for (const o of orders) {
    if (o.data.orderStatus !== 'pending') continue;
    if (!o.data.dispatchAt) continue;
    if (o.data.assignedDriverId) continue;
    const vis = (o.data.dispatchVisibility ?? null) as
      | { currentLevel?: unknown; openedAt?: Timestamp | null }
      | null;
    const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';
    if (currentLevel === '0') continue;
    const openedAt = (vis?.openedAt ?? null) as Timestamp | null;
    const nextDowngradeAt = getNextDowngradeAt(
      (o.data.orderType as string) ?? '',
      currentLevel,
      openedAt,
    );
    if (!nextDowngradeAt) continue;
    if (now > nextDowngradeAt.toMillis()) {
      candidates.push({ orderId: o.id, expectedLevel: currentLevel });
    }
  }

  if (candidates.length === 0) return;

  const env = getDispatchPushEnv();
  for (const c of candidates) {
    try {
      const result = await downgradeDispatchLevel(db, c.orderId, {
        mode: 'auto-downgrade',
        actor: 'system',
        expectedLevel: c.expectedLevel,
      });
      // 降級成功 → 重讀 order 拿最新 payload + fire-and-forget push & audit
      const fresh = await db.collection('orders').doc(c.orderId).get();
      if (!fresh.exists) continue;
      const payload = buildDispatchedOrderSummary(c.orderId, fresh.data() ?? {});
      void (async () => {
        try {
          await multicastLevelDown(db, payload, env, result.newLevel);
        } catch (err) {
          console.error('[dispatched-orders] lazy multicastLevelDown failed:', err);
        }
      })();
      // audit log（不阻擋；await 確保 serverless 不砍）
      await writeAuditLog({
        event,
        auth,
        action: 'order.dispatch_level.auto_downgrade',
        targetType: 'order',
        targetId: c.orderId,
        payload: {
          previousLevel: result.previousLevel,
          newLevel: result.newLevel,
          triggeredByDriver: auth.lineUid,
        },
      });
    } catch (err) {
      // race condition / 已被降過 / 已指派 → silent skip（下次 GET 再試）
      if (err instanceof DispatchGuardError) continue;
      console.warn('[dispatched-orders] lazy downgrade failed:', c.orderId, err);
    }
  }
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }
  if (!auth.approved) {
    return forbiddenError({ zh_tw: '司機尚未通過審核', en: 'Driver not approved', ja: 'ドライバー審査未完了' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  // 縣市過濾參數（與 admin/orders 端對齊）
  const query = getQuery(event);
  const { regionField, cities, districts } = query as {
    regionField?: string;
    cities?: string;
    districts?: string;
  };
  const effectiveRegionField: 'pickup' | 'dropoff' = regionField === 'dropoff' ? 'dropoff' : 'pickup';
  const citiesSet = new Set(
    (cities ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const districtsSet = new Set(
    (districts ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    // Wave 2B+2C：先拉司機分級（缺 driver doc fallback '0' NOVICE）
    const driverCategory = await loadDriverCategory(db, auth.lineUid);

    // 只用單欄位 orderBy('createdAt')（Firestore 自動建單欄位 index，零 composite index 需求），
    // orderStatus / dispatchAt / assignedDriverId 全部改 in-memory filter。
    //
    // 為何不用 where('orderStatus','==','pending') + orderBy('createdAt')：
    //   那會需要 orders 的 `orderStatus + createdAt` composite index，prod 上不一定存在
    //   → query throw failed-precondition → 500 → 司機端列表永遠空白（本 bug 主因）。
    // limit 拉到 300：in-memory filter 後才篩 pending，多撈一些避免被非 pending 訂單擠掉。
    let snap = await db.collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(300)
      .get();

    // Wave 2D：lazy 自動降級（會修改 order doc + 推 LINE）
    const rawOrders = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    await _runLazyDowngrade(db, event, auth, rawOrders);

    // 若有訂單剛被降級 → 重新拉一次最新資料，避免本 response 仍以舊 currentLevel 判斷可見性。
    // （簡單作法：lazy 完成才重抓；偷懶不 patch in-memory 是因為 dispatchVisibility 是 nested
    //   field，patch 容易漏 openedAt / levelHistory；多 1 次 read ~100ms 換 correctness 划算。）
    // 為避免 lazy=0 時也多花一次 read，只在 _runLazyDowngrade 真有降級時 re-read。
    // 但 _runLazyDowngrade 內部 silent skip，無回傳 → 用 nextDowngradeAt 過期計數判斷
    const hadCandidates = rawOrders.some(({ data }) => {
      if (data.orderStatus !== 'pending' || !data.dispatchAt || data.assignedDriverId) return false;
      const vis = (data.dispatchVisibility ?? null) as
        | { currentLevel?: unknown; openedAt?: Timestamp | null }
        | null;
      const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';
      if (currentLevel === '0') return false;
      const next = getNextDowngradeAt(
        (data.orderType as string) ?? '',
        currentLevel,
        (vis?.openedAt ?? null) as Timestamp | null,
      );
      return !!next && Date.now() > next.toMillis();
    });
    if (hadCandidates) {
      snap = await db.collection('orders')
        .orderBy('createdAt', 'desc')
        .limit(300)
        .get();
    }

    const myUid = auth.lineUid;

    const dispatched = snap.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter(({ data }) =>
        data.orderStatus === 'pending' && !!data.dispatchAt && !data.assignedDriverId,
      )
      // Wave 2B+2C：driver category 必須 >= order currentLevel 才看得到
      // 舊單無 dispatchVisibility → fallback currentLevel='0'（全開），等同無變化
      .filter(({ data }) => {
        const vis = (data.dispatchVisibility ?? null) as { currentLevel?: unknown } | null;
        const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';
        return driverCategory >= currentLevel; // 字串字典序比 '0'<'1'<'2'
      })
      // 縣市 / 行政區 filter（query 有帶才生效）
      .filter(({ data }) =>
        _matchRegion(
          data.pickupLocation as GooglePlaceLite | undefined,
          data.dropoffLocation as GooglePlaceLite | undefined,
          effectiveRegionField,
          citiesSet,
          districtsSet,
        ),
      )
      .map(({ id, data }) => {
        const rawBids = (Array.isArray(data.bids) ? data.bids : []) as OrderBidEntry[];
        const myBid = rawBids.find((b) => b.driverId === myUid);
        let myBidStatus: 'none' | 'bid' | 'withdrawn' = 'none';
        if (myBid) myBidStatus = myBid.withdrawnAt ? 'withdrawn' : 'bid';

        const activeBidCount = rawBids.filter((b) => !b.withdrawnAt).length;

        // Wave 2B+2C：給 UI 倒數用
        const vis = (data.dispatchVisibility ?? null) as
          | { currentLevel?: unknown; openedAt?: Timestamp | null }
          | null;
        const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';
        const openedAt = (vis?.openedAt ?? null) as Timestamp | null;
        const nextDowngradeAt = getNextDowngradeAt(
          (data.orderType as string) ?? '',
          currentLevel,
          openedAt,
        );

        return {
          orderId: id,
          orderType: (data.orderType as string) ?? '',
          pickupDateTime: (data.pickupDateTime as string) ?? '',
          pickupLocation: data.pickupLocation as GooglePlaceLite,
          dropoffLocation: data.dropoffLocation as GooglePlaceLite,
          stopovers: ((data.stopovers as GooglePlaceLite[] | undefined) ?? []),
          vehicleType: (data.vehicleType as string) ?? '',
          passengerCount: (data.passengerCount as number) ?? 1,
          // Booking v2 批次 2：fallback 舊單無 adult/child
          adultCount: (data.adultCount as number | undefined) ?? ((data.passengerCount as number | undefined) ?? 1),
          childCount: (data.childCount as number | undefined) ?? 0,
          estimatedFare: (data.estimatedFare as number) ?? 0,
          distanceKm: (data.distanceKm as number) ?? 0,
          notes: (data.notes as string | undefined) ?? null,
          flightNumber: (data.flightNumber as string | undefined) ?? null,
          terminal: (data.terminal as string | undefined) ?? null,
          preferences: serializeOrderPreferences(data.preferences),
          dispatchAt: _tsToIso(data.dispatchAt),
          activeBidCount,
          myBidStatus,
          // Wave 2B+2C
          dispatchCurrentLevel: currentLevel,
          dispatchOpenedAt: _tsToIso(openedAt),
          dispatchNextDowngradeAt: _tsToIso(nextDowngradeAt),
        };
      });

    return successResponse(dispatched);
  } catch (err) {
    console.error('[driver/dispatched-orders] failed:', err);
    return serverError();
  }
});
