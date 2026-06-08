/**
 * Template params builder（2026-06-08）
 *
 * 中心化 placeholder 取值邏輯，讓所有 LINE template 推送的 trigger site 透過同一支
 * helper 從 order / driver doc 抓字串，不再各自手工挑欄位。
 *
 * 設計原則：
 *   - 一律回 string（空值 → ''，避免 buildTemplate 內 placeholder 殘留 `{key}` 字樣）
 *   - admin 不負責隱私把關：所有可暴露的欄位都進 params；template 寫不寫 placeholder
 *     由 admin 自行決定（電話 / 姓名等敏感資料的責任落 admin 編 template 時）
 *   - 新增可用 placeholder 只需在這邊加一行 + registry 補 placeholders 定義
 *
 * 使用：
 *   const params = buildOrderDriverParams({ orderId, orderData, driverData, fareOverride });
 *   const tpl = await resolveTemplate(db, 'order.confirmed', lang);
 *   const msg = buildTemplate(tpl, params, 'flex');
 */

import dayjs from 'dayjs';

// ── 共用型別 ───────────────────────────────────────────────
interface GooglePlaceLike {
  address?: string;
  displayName?: string;
}

interface LuggageItemLike {
  size?: string;
  count?: number;
}

/** order doc field subset 對 template 有意義的部份（多餘欄位被忽略） */
export interface OrderDataLike {
  orderType?: string;
  pickupDateTime?: string;
  pickupLocation?: GooglePlaceLike;
  dropoffLocation?: GooglePlaceLike;
  stopovers?: GooglePlaceLike[];
  vehicleType?: string;
  adultCount?: number;
  childCount?: number;
  passengerCount?: number;
  luggageItems?: LuggageItemLike[];
  estimatedFare?: number;
  contactName?: string;
  contactPhone?: string;
  passengerName?: string;
  flightNumber?: string;
  terminal?: string;
  notes?: string;
}

/** driver doc field subset 對 template 有意義的部份 */
export interface DriverDataLike {
  driverName?: string;
  plateNumber?: string;
  vehicleModel?: string;
  phone?: string;
  displayName?: string;
  // P27：apply 階段資料若 top-level 沒寫到（舊資料），fallback 從 application 撈
  application?: {
    driverName?: string;
    plateNumber?: string;
    vehicleModel?: string;
    phone?: string;
  };
}

/** Build options：trigger site 額外想注入 / 覆蓋的值 */
export interface BuildParamsOptions {
  /** Full order doc UUID；helper 自動取前 8 碼大寫成 displayed orderId */
  orderId?: string;
  /** 顯示用日期格式（預設 'YYYY-MM-DD HH:mm'） */
  dateFormat?: string;
  /** 強制覆寫車資（如 completed 用 actualFare 取代 estimatedFare） */
  fareOverride?: number;
  /** 額外人數摘要寫法（預設「大人 N / 兒童 N」） */
  paxSummaryFormatter?: (adults: number, children: number) => string;
}

// ── 內部工具 ──────────────────────────────────────────────
const _safeString = (v: unknown): string => (typeof v === 'string' ? v : '');
const _safeNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const _formatNumber = (n: number): string => n.toLocaleString('en-US');

const _DEFAULT_DATE_FMT = 'YYYY-MM-DD HH:mm';

const _defaultPaxSummary = (adults: number, children: number): string => {
  const parts: string[] = [];
  if (adults > 0) parts.push(`大人 ${adults}`);
  if (children > 0) parts.push(`兒童 ${children}`);
  return parts.length > 0 ? parts.join(' / ') : '—';
};

const _buildLuggageDescription = (items: LuggageItemLike[] | undefined): string => {
  if (!Array.isArray(items) || items.length === 0) return '';
  const total = items.reduce((acc, it) => acc + _safeNumber(it?.count), 0);
  if (total === 0) return '';
  // 簡略版：「3 件」或「小 2 件 / 大 1 件」（依 size 群組）
  const bySize = new Map<string, number>();
  for (const it of items) {
    const size = _safeString(it?.size) || '件';
    const count = _safeNumber(it?.count);
    if (count > 0) bySize.set(size, (bySize.get(size) ?? 0) + count);
  }
  return Array.from(bySize.entries()).map(([s, c]) => `${s} ${c} 件`).join(' / ');
};

// ── 公開 builder ──────────────────────────────────────────

/**
 * 把 order doc 轉成 template params。所有值為 string；缺值 ''。
 *
 * 提供 key：
 *   - orderId（前 8 碼大寫）/ orderType
 *   - date / pickup / dropoff / stopovers（換行串接）
 *   - vehicle（vehicleType slug）/ fare（含千分位）
 *   - paxSummary / adultCount / childCount / passengerCount
 *   - luggageDescription
 *   - contactName / contactPhone / passengerName
 *   - flightNumber / terminal / notes
 */
export const buildOrderParams = (
  orderData: OrderDataLike | null | undefined,
  options: BuildParamsOptions = {},
): Record<string, string> => {
  const o = orderData ?? {};
  const dateFmt = options.dateFormat ?? _DEFAULT_DATE_FMT;
  const paxFormatter = options.paxSummaryFormatter ?? _defaultPaxSummary;

  const adults = _safeNumber(o.adultCount);
  const children = _safeNumber(o.childCount);
  const passengerCount = _safeNumber(o.passengerCount) || (adults + children);

  const fareNum = typeof options.fareOverride === 'number'
    ? options.fareOverride
    : _safeNumber(o.estimatedFare);

  const orderIdShort = options.orderId
    ? options.orderId.slice(0, 8).toUpperCase()
    : '';

  const stopoverAddrs = (o.stopovers ?? [])
    .map((s) => _safeString(s?.address))
    .filter(Boolean);

  return {
    orderId: orderIdShort,
    orderType: _safeString(o.orderType),
    date: o.pickupDateTime ? dayjs(o.pickupDateTime).format(dateFmt) : '',
    pickup: _safeString(o.pickupLocation?.address),
    pickupAddress: _safeString(o.pickupLocation?.address),  // alias，dispatch 類 template 慣用
    dropoff: _safeString(o.dropoffLocation?.address),
    dropoffAddress: _safeString(o.dropoffLocation?.address),  // alias
    stopovers: stopoverAddrs.join('\n'),
    vehicle: _safeString(o.vehicleType),
    fare: _formatNumber(fareNum),
    estimatedFare: _formatNumber(fareNum),  // alias，dispatch 類 template 慣用
    paxSummary: paxFormatter(adults, children),
    adultCount: String(adults),
    childCount: String(children),
    passengerCount: String(passengerCount),
    luggageDescription: _buildLuggageDescription(o.luggageItems),
    contactName: _safeString(o.contactName),
    contactPhone: _safeString(o.contactPhone),
    passengerName: _safeString(o.passengerName) || _safeString(o.contactName),
    flightNumber: _safeString(o.flightNumber),
    terminal: _safeString(o.terminal),
    notes: _safeString(o.notes),
  };
};

/**
 * 把 driver doc 轉成 template params。top-level 缺值時 fallback application 子物件。
 *
 * 提供 key：
 *   - driverName / driverDisplayName
 *   - vehiclePlate / vehicleModel
 *   - driverPhone
 */
export const buildDriverParams = (
  driverData: DriverDataLike | null | undefined,
): Record<string, string> => {
  const d = driverData ?? {};
  const app = d.application ?? {};

  const driverName = _safeString(d.driverName) || _safeString(app.driverName);
  const plate = _safeString(d.plateNumber) || _safeString(app.plateNumber);
  const model = _safeString(d.vehicleModel) || _safeString(app.vehicleModel);
  const phone = _safeString(d.phone) || _safeString(app.phone);
  const display = _safeString(d.displayName) || driverName;

  return {
    driverName,
    driverDisplayName: display,
    vehiclePlate: plate,
    vehicleModel: model,
    driverPhone: phone,
  };
};

/**
 * Order + Driver 合併 params（driver 部份缺 doc → 全空字串）。
 */
export const buildOrderDriverParams = (
  orderData: OrderDataLike | null | undefined,
  driverData: DriverDataLike | null | undefined,
  options: BuildParamsOptions = {},
): Record<string, string> => ({
  ...buildOrderParams(orderData, options),
  ...buildDriverParams(driverData),
});
