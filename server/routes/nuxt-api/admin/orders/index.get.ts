import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { serializeOrderPreferences } from '@@/utils/order-preferences';
import { serializeBids } from '@@/utils/order-dispatch';
import { matchRegion } from '~shared/region-match';

type GooglePlaceLite = { address: string; lat: number; lng: number; placeId?: string; displayName?: string; city?: string; district?: string };

// Phase 1 FU：縣市別名 + 舊單 address contains fallback 全部抽到 shared/region-match。
// 給 __unknown__ bucket 比對用 — 列出 22 縣市 id（locations-taiwan.ts 對齊）。
const ALL_CITY_NAMES: readonly string[] = [
  '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
  '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
  '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '台東縣', '澎湖縣', '金門縣', '連江縣',
];

export default defineEventHandler(async (event) => {
  // P14：必須登入；P18：套 canManageOrders 權限（admin/assistant 都有此權限）
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const query = getQuery(event);
  const { status, from, to, regionField, cities, districts } = query as {
    status?: string;
    from?: string;
    to?: string;
    regionField?: string;
    cities?: string;
    districts?: string;
  };

  // Wave 1 A3：from / to 為 ISO string（exclusive end）；於 server 內存 filter
  // pickupDateTime（避免動 Firestore composite index）。
  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;
  const hasFrom = Number.isFinite(fromMs);
  const hasTo = Number.isFinite(toMs);

  // 縣市過濾參數
  const effectiveRegionField: 'pickup' | 'dropoff' = regionField === 'dropoff' ? 'dropoff' : 'pickup';
  const citiesSet = new Set(
    (cities ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const districtsSet = new Set(
    (districts ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    let q = db.collection('orders').orderBy('createdAt', 'desc').limit(200) as FirebaseFirestore.Query;
    if (status) q = q.where('orderStatus', '==', status);

    const snapshot = await q.get();

    // 完整訂單欄位（admin/orders modal 用）
    // Wave 1 A3：先 map 後依 from/to 過濾 pickupDateTime
    const baseOrdersAll = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        orderId: d.orderId as string,
        userId: (d.userId as string) ?? '',
        lineUserId: (d.lineUserId as string) ?? '',
        orderType: d.orderType as string,
        pickupDateTime: d.pickupDateTime as string,
        pickupLocation: d.pickupLocation as GooglePlaceLite,
        dropoffLocation: d.dropoffLocation as GooglePlaceLite,
        stopovers: ((d.stopovers as GooglePlaceLite[] | undefined) ?? []),
        vehicleType: d.vehicleType as string,
        passengerCount: (d.passengerCount as number) ?? 1,
        // Booking v2 批次 2：fallback 舊單無 adult/child
        adultCount: (d.adultCount as number | undefined) ?? ((d.passengerCount as number | undefined) ?? 1),
        childCount: (d.childCount as number | undefined) ?? 0,
        luggageItems: ((d.luggageItems as Array<{ typeId: string; count: number }> | undefined) ?? []),
        estimatedFare: (d.estimatedFare as number) ?? 0,
        estimatedTime: (d.estimatedTime as number) ?? 0,
        distanceKm: (d.distanceKm as number) ?? 0,
        // 視窗 2：路段分析（fare-v2 訂單才有；舊 v1 / charter 為 null）
        highwayKm: (() => {
          const fb = d.fareBreakdown as { highwayKm?: number } | null | undefined;
          return typeof fb?.highwayKm === 'number' ? fb.highwayKm : null;
        })(),
        surfaceKm: (() => {
          const fb = d.fareBreakdown as { surfaceKm?: number } | null | undefined;
          return typeof fb?.surfaceKm === 'number' ? fb.surfaceKm : null;
        })(),
        surfaceSurcharge: (() => {
          const fb = d.fareBreakdown as { surfaceSurcharge?: number } | null | undefined;
          return typeof fb?.surfaceSurcharge === 'number' ? fb.surfaceSurcharge : null;
        })(),
        extraServices: (d.extraServices as string[] | undefined) ?? [],
        flightNumber: (d.flightNumber as string | undefined) ?? null,
        terminal: (d.terminal as string | undefined) ?? null,
        notes: (d.notes as string | undefined) ?? null,
        orderStatus: (d.orderStatus as string) ?? 'pending',
        assignedDriverId: (d.assignedDriverId as string) ?? '',
        cancelReason: (d.cancelReason as string | undefined) ?? null,
        createdAt: d.createdAt?.toMillis?.() ?? 0,
        // 訂單 doc 自帶的乘客欄位（admin 手動建立的 guest 訂單會有；乘客自助下單無）
        storedPassengerName: (d.passengerName as string | undefined) ?? '',
        contactPhone: (d.contactPhone as string | undefined) ?? null,
        // Phase 1D：偏好標籤 snapshot（null = 乘客建單時未勾選或為舊單）
        preferences: serializeOrderPreferences(d.preferences),
        // Phase 1E：派發 / 喊單欄位 echo（null/[] = 未派發 / 未喊單）
        dispatchAt: d.dispatchAt?.toDate?.()?.toISOString?.() ?? null,
        dispatchedBy: (d.dispatchedBy as string | undefined) ?? null,
        bids: serializeBids(d.bids),
        assignedAt: d.assignedAt?.toDate?.()?.toISOString?.() ?? null,
        assignedBy: (d.assignedBy as string | undefined) ?? null,
        // Phase 1F：Soft Match / 重新配對欄位 echo
        passengerConfirmationStatus: (d.passengerConfirmationStatus as string | undefined) ?? null,
        reMatchRound: typeof d.reMatchRound === 'number' ? d.reMatchRound : 0,
        // Charter Fare V1：包車訂單 snapshot（plans 已 freeze；actualEndTime / overtime* 為 W5 driver 結束後寫入）
        // 全 plain object（無 Timestamp），直接 echo 即可
        charter: (d.charter as Record<string, unknown> | null | undefined) ?? null,
        bidHistory: Array.isArray(d.bidHistory)
          ? (d.bidHistory as Array<{ round?: number; bids?: unknown; endReason?: string; endedAt?: unknown; endedBy?: string }>).map((h) => {
            const e = h.endedAt as { toDate?: () => Date } | Date | null | undefined;
            const endedAtIso = e instanceof Date
              ? e.toISOString()
              : (e as { toDate?: () => Date } | null | undefined)?.toDate?.()?.toISOString?.() ?? null;
            return {
              round: typeof h.round === 'number' ? h.round : 0,
              bids: serializeBids(h.bids),
              endReason: (h.endReason as string | undefined) ?? '',
              endedAt: endedAtIso,
              endedBy: (h.endedBy as string | undefined) ?? null,
            };
          })
          : [],
      };
    });

    const baseOrdersAfterDate = (hasFrom || hasTo)
      ? baseOrdersAll.filter((o) => {
        const t = Date.parse(o.pickupDateTime);
        if (!Number.isFinite(t)) return false;
        if (hasFrom && t < fromMs) return false;
        if (hasTo && t >= toMs) return false;
        return true;
      })
      : baseOrdersAll;

    const baseOrders = (citiesSet.size > 0 || districtsSet.size > 0)
      ? baseOrdersAfterDate.filter((o) =>
        matchRegion({
          pickup: o.pickupLocation,
          dropoff: o.dropoffLocation,
          regionField: effectiveRegionField,
          cities: citiesSet,
          districts: districtsSet,
          allSelectableCityNames: ALL_CITY_NAMES,
        }),
      )
      : baseOrdersAfterDate;

    // batch read users/{userId} 取乘客顯示名（既有 user 資料無 phone，passengerPhone 暫 null）
    const userIds = Array.from(new Set(baseOrders.map((o) => o.userId).filter(Boolean)));
    const userMap = new Map<string, { displayName: string }>();
    if (userIds.length > 0) {
      try {
        const userRefs = userIds.map((uid) => db.collection('users').doc(uid));
        const userSnaps = await db.getAll(...userRefs);
        userSnaps.forEach((s) => {
          if (s.exists) {
            const data = s.data() ?? {};
            userMap.set(s.id, { displayName: (data.displayName as string) ?? '' });
          }
        });
      } catch (err) {
        console.error('[admin/orders] users batch read failed:', err);
      }
    }

    // 乘客名：訂單 doc 自帶（手動訂單）優先，否則回退 users/{userId}.displayName
    // 乘客電話：訂單 doc 的 contactPhone（乘客下單 / 手動訂單皆會寫入）
    const orders = baseOrders.map((o) => {
      const { storedPassengerName, contactPhone, ...rest } = o;
      return {
        ...rest,
        passengerName: storedPassengerName || (userMap.get(o.userId)?.displayName ?? ''),
        passengerPhone: contactPhone,
      };
    });

    return successResponse(orders);
  } catch (err) {
    console.error('[admin/orders] Firestore query failed:', err);
    return serverError();
  }
});
