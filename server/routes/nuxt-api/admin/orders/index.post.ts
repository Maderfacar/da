/**
 * POST /nuxt-api/admin/orders
 *
 * Admin 手動建立訂單。乘客為「不存在的使用者」— server 自動產生 guest id，
 * 並由 admin 自行填入乘客姓名 / 聯絡電話 / 車資（車資不自動試算）。
 *
 * 與 orders/index.post.ts（乘客自助下單）差異：
 *   - userId / lineUserId 為 guest:<uuid>（非真實 LINE user），不發 LINE 推播
 *   - estimatedFare 由 admin 手動輸入（不呼叫 Routes API）
 *   - 不套用「同帳號 4 筆未完成訂單」上限
 *
 * 權限：canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { getFleetConfig } from '@@/utils/fleet-config';
import { writeAuditLog } from '@@/utils/audit-log';
import { notifyAdmins } from '@@/utils/notify-admins';
import { dispatchOrder, loadActiveDrivers, DispatchGuardError } from '@@/utils/order-dispatch';
import { pushOrderDispatchToDrivers, getDispatchPushEnv, type DispatchedOrderSummary } from '@@/utils/line-dispatch-push';

interface GooglePlace {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
  displayName?: string;
}

interface LuggageItemBody {
  typeId: string;
  count: number;
}

interface CreateAdminOrderBody {
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  passengerCount: number;
  luggageItems?: LuggageItemBody[];
  vehicleType: string;
  extraServices?: string[];
  estimatedFare: number;
  passengerName: string;
  contactPhone: string;
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
  /**
   * 若為 true，建單成功後同步呼叫 dispatchOrder + 推播 LINE Flex 給全部 active driver。
   * 等同於 admin 建完馬上按「📤 發出需求單」，省一次點擊。
   * dispatch 失敗不影響建單結果（fire-and-forget；錯誤寫 log）。
   */
  autoDispatch?: boolean;
}

const VALID_ORDER_TYPES = new Set(['airport-pickup', 'airport-dropoff', 'charter', 'transfer']);
const PHONE_REGEX = /^09\d{8}$/;
const NOTES_MAX_LENGTH = 200;
const NAME_MAX_LENGTH = 40;

const _isValidGooglePlace = (v: unknown): v is GooglePlace => {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.address === 'string' && p.address.length > 0
    && typeof p.lat === 'number' && typeof p.lng === 'number';
};

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const body = await readBody<CreateAdminOrderBody>(event);

  if (!VALID_ORDER_TYPES.has(body.orderType)) {
    return badRequestError({ zh_tw: '無效的行程類型', en: 'Invalid orderType', ja: '無効な行程タイプ' });
  }
  if (typeof body.pickupDateTime !== 'string' || Number.isNaN(Date.parse(body.pickupDateTime))) {
    return badRequestError({ zh_tw: '用車時間格式錯誤', en: 'Invalid pickupDateTime', ja: '日時形式が無効' });
  }
  if (!_isValidGooglePlace(body.pickupLocation)) {
    return badRequestError({ zh_tw: '請選擇上車點', en: 'Invalid pickupLocation', ja: '乗車地が無効' });
  }
  if (!_isValidGooglePlace(body.dropoffLocation)) {
    return badRequestError({ zh_tw: '請選擇下車點', en: 'Invalid dropoffLocation', ja: '降車地が無効' });
  }
  const stopovers = Array.isArray(body.stopovers) ? body.stopovers : [];
  if (!stopovers.every(_isValidGooglePlace)) {
    return badRequestError({ zh_tw: '停靠站格式錯誤', en: 'Invalid stopovers', ja: '経由地形式が無効' });
  }
  if (!Number.isInteger(body.passengerCount) || body.passengerCount < 1 || body.passengerCount > 20) {
    return badRequestError({ zh_tw: '人數須為 1-20', en: 'passengerCount must be 1-20', ja: '人数は 1-20' });
  }
  if (typeof body.estimatedFare !== 'number' || !Number.isFinite(body.estimatedFare) || body.estimatedFare < 0) {
    return badRequestError({ zh_tw: '車資須為非負數', en: 'estimatedFare must be non-negative', ja: '料金は非負数' });
  }
  const passengerName = (body.passengerName ?? '').trim();
  if (!passengerName || passengerName.length > NAME_MAX_LENGTH) {
    return badRequestError({ zh_tw: '請填寫乘客姓名（40 字內）', en: 'passengerName required (≤40 chars)', ja: '乗客名を入力してください（40文字以内）' });
  }
  if (!body.contactPhone || !PHONE_REGEX.test(body.contactPhone)) {
    return badRequestError({
      zh_tw: '聯絡電話格式錯誤（須為 09 開頭的 10 碼數字）',
      en: 'Invalid contact phone (must be 10 digits starting with 09)',
      ja: '連絡先電話番号の形式が不正です',
    });
  }
  if (body.notes && body.notes.length > NOTES_MAX_LENGTH) {
    return badRequestError({ zh_tw: '備註長度不可超過 200 字', en: 'Notes must be ≤200 characters', ja: '備考は200文字以内' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

  // 車型 / 額外服務 / 行李存在性校驗（與乘客下單一致）
  const fleet = await getFleetConfig(db);
  const vehicle = fleet.vehicles.find((v) => v.id === body.vehicleType);
  if (!vehicle) {
    return badRequestError({ zh_tw: `無效的車型：${body.vehicleType}`, en: `Invalid vehicle type: ${body.vehicleType}`, ja: `無効な車種：${body.vehicleType}` });
  }
  const extraServices = (body.extraServices ?? []).filter((id) => fleet.extras.some((e) => e.id === id));
  const luggageItems = (Array.isArray(body.luggageItems) ? body.luggageItems : [])
    .filter((i) => i && typeof i.typeId === 'string'
      && fleet.luggageTypes.some((t) => t.id === i.typeId)
      && Number.isInteger(i.count) && i.count > 0)
    .map((i) => ({ typeId: i.typeId, count: i.count }));

  const orderId = crypto.randomUUID();
  // 模擬不存在的使用者：guest id（非真實 LINE user，不會收到 LINE 推播）
  const guestUserId = `guest:${crypto.randomUUID()}`;

  try {
    await db.collection('orders').doc(orderId).set({
      orderId,
      userId: guestUserId,
      lineUserId: guestUserId,
      orderType: body.orderType,
      pickupDateTime: body.pickupDateTime,
      pickupLocation: body.pickupLocation,
      dropoffLocation: body.dropoffLocation,
      stopovers,
      passengerCount: body.passengerCount,
      luggageItems,
      vehicleType: body.vehicleType,
      extraServices,
      estimatedFare: body.estimatedFare,
      estimatedTime: 0,
      distanceKm: 0,
      fareVersion: 'v1',
      fareBreakdown: null,
      passengerName,
      contactPhone: body.contactPhone,
      flightNumber: body.flightNumber ?? null,
      terminal: body.terminal ?? null,
      notes: body.notes ?? null,
      orderStatus: 'pending',
      // 標記為 admin 手動建立（guest 乘客），方便後續排查
      isManualOrder: true,
      createdBy: auth.lineUid,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[admin/orders/post] Firestore write failed:', err);
    return serverError({ zh_tw: '訂單寫入失敗，請稍後重試', en: 'Failed to save order, please retry', ja: '注文の保存に失敗しました' });
  }

  await writeAuditLog({
    event,
    auth,
    action: 'order.create',
    targetType: 'order',
    targetId: orderId,
    payload: { passengerName, orderType: body.orderType, estimatedFare: body.estimatedFare },
  });

  // ── admin 自動通知（D1：手動建單也推；fire-and-forget）──
  void (async () => {
    try {
      await notifyAdmins(db, 'adminNotify.orderCreated', {
        orderId: orderId.slice(0, 8).toUpperCase(),
        date: body.pickupDateTime.replace('T', ' ').slice(0, 16),
        pickup: body.pickupLocation.address,
      });
    } catch (err) {
      console.error('[admin/orders/post] admin notify failed:', err);
    }
  })();

  // ── 可選：建單後立即派發（autoDispatch=true）─────────────────────
  // 與 /dispatch.post.ts 流程一致：dispatchOrder（寫 dispatchAt） + LINE multicast 給 active driver + audit
  // 失敗不影響建單；錯誤僅寫 log，response 仍回 dispatched: false
  let dispatched = false;
  if (body.autoDispatch === true) {
    try {
      await dispatchOrder(db, orderId, auth.lineUid);
      dispatched = true;

      const pickupAddress = body.pickupLocation.displayName || body.pickupLocation.address;
      const dropoffAddress = body.dropoffLocation.displayName || body.dropoffLocation.address;
      const payload: DispatchedOrderSummary = {
        orderId,
        pickupDateTime: body.pickupDateTime,
        pickupAddress,
        dropoffAddress,
        passengerCount: body.passengerCount,
        estimatedFare: body.estimatedFare,
        preferenceChips: [],
      };

      void (async () => {
        try {
          const drivers = await loadActiveDrivers(db);
          const lineUserIds = drivers.map((dv) => dv.lineUserId).filter(Boolean);
          await pushOrderDispatchToDrivers(payload, getDispatchPushEnv(), lineUserIds);
        } catch (err) {
          console.error('[admin/orders/post] auto-dispatch multicast failed:', err);
        }
      })();

      await writeAuditLog({
        event,
        auth,
        action: 'order.dispatch',
        targetType: 'order',
        targetId: orderId,
        payload: { dispatchAt: 'server', viaCreate: true },
      });
    } catch (err) {
      // dispatch 失敗（DispatchGuardError 或 server err）不擋訂單建立完成
      if (err instanceof DispatchGuardError) {
        console.warn('[admin/orders/post] auto-dispatch guard failed:', err.code);
      } else {
        console.error('[admin/orders/post] auto-dispatch failed:', err);
      }
    }
  }

  return successResponse({ orderId, orderStatus: 'pending', dispatched });
});
