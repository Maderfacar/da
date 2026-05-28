// ===== 共用地點型別 =====
interface GooglePlace {
  address: string;      // 格式化地址（傳給 API 使用）
  lat: number;
  lng: number;
  placeId?: string;
  displayName?: string; // 顯示用：「地點名稱 (地址)」格式
  /** 縣市過濾用：administrative_area_level_1 中文名（如「台北市」「桃園市」） */
  city?: string;
  /** 縣市過濾用：administrative_area_level_2 / level_3 中文名（如「中正區」「龜山區」） */
  district?: string;
}

// ===== 建立訂單 =====
// P17：userId / lineUserId 改為 optional — server 從 ID token 取，不再信任 client
// P20：補上 contactPhone（必填）+ flightNumber / terminal / notes（optional）
// P23：vehicleType / extraServices 改 string（fleet config 動態化），luggageCount 改 luggageItems 陣列
interface OrderLuggageItem {
  typeId: string;
  count: number;
}

// ===== Phase 1D：偏好標籤 snapshot =====
type OrderPreferenceTagGroup =
  | 'power'
  | 'vehicleType'
  | 'origin'
  | 'interior'
  | 'equipment'
  | 'driverSkill';

interface OrderPreferenceTagSnapshotDto {
  id: string;
  /** 三語名稱完整 snapshot；en/ja 缺者前端 fallback 繁中 */
  name: { zh_tw: string; en?: string; ja?: string };
  group: OrderPreferenceTagGroup;
  /** 寫單時鎖定的加價金額（後續 admin 改 surchargeAmount 不影響舊單） */
  surchargeAmount: number;
  sortOrder: number;
}

interface OrderPreferencesDto {
  /** 乘客原始勾選的 tagId 陣列（含 invalid 也保留） */
  tagIds: string[];
  /** 解析後的標籤 snapshot（不含 invalid） */
  tagSnapshot: OrderPreferenceTagSnapshotDto[];
  /** max(snapshot.surchargeAmount)；無命中為 0 */
  tagSurcharge: number;
  /** ISO timestamp */
  snapshotAt: string;
}

// ===== Charter Fare V1：包車三檔時長套餐 =====
// 與 shared/pricing.ts::CharterPlan / app/protocol/fetch-api/api/config/type.d.ts::CharterPlanDto 對齊。
// W1 鎖介面，W2 server 端 plumbing。
type OrderCharterPlanKey = '4h' | '8h' | '10h';

interface OrderCharterPlanSnapshot {
  key: OrderCharterPlanKey;
  durationHours: number;
  basePrice: number;
  includedKm: number;
  extraKmRate: number;
  overtimeRatePer30min: number;
  enabled: boolean;
}

interface OrderCharterStopover {
  name: string;
  lat: number;
  lng: number;
  order: number;
}

/** orders/{orderId}.charter — 僅 orderType='charter' 訂單有此 block；W2 server 端寫入 snapshot */
interface OrderCharter {
  /** 第一天 plan key（summary 顯示用） */
  planKey: OrderCharterPlanKey;
  /** 行程天數（≥ 1） */
  days: number;
  /** 多日各天 plan snapshot（length = days；plans 整份 freeze 避免後續 fleet_vehicles 變動影響舊單） */
  plans: OrderCharterPlanSnapshot[];
  /** 預估結束時間 ISO（pickupTime + Σ plans.durationHours，下訂時寫入） */
  estimatedEndTime: string;
  /** 實際結束時間 ISO（W5 driver app 結束任務時寫入） */
  actualEndTime?: string;
  /** OT 超時分鐘（W5 計算回寫） */
  overtimeMinutes?: number;
  /** OT 段數（W5；每 30 min 為一段，寬限後計算） */
  overtimeBlocks?: number;
  /** OT 加收 NTD（W5；overtimeBlocks × plan.overtimeRatePer30min） */
  overtimeCharge?: number;
  /** 來回判定結果（W2 編排層算） */
  isRoundTrip: boolean;
  /** 山區命中（W2 編排層算） */
  isMountain: boolean;
  /** 山區係數（W2，套用於 baseLayer） */
  mountainMul: number;
  /** 過夜晚數 = max(0, days - 1) */
  nights: number;
  /** 整段路線含 stopover 總里程 km */
  distanceKm: number;
  /** 停靠點清單（依 order 排序） */
  stopovers: OrderCharterStopover[];
}

interface CreateOrderParams {
  userId?: string;
  lineUserId?: string;
  orderType: 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  /** 總人數（向後相容；批次 2 後 server 寫入時 = adultCount + childCount） */
  passengerCount: number;
  /** Booking v2 批次 2：大人數（≥ 1；舊 client 不帶時 server 用 passengerCount fallback） */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數（≥ 0；舊 client 不帶時 server 補 0） */
  childCount?: number;
  luggageItems: OrderLuggageItem[];
  vehicleType: string;
  extraServices?: string[];
  contactPhone: string;
  /** Booking v2 批次 1：聯絡人姓名（下單者；optional 向後相容） */
  contactName?: string;
  /** Booking v2 批次 1：乘車人姓名（同聯絡人 checkbox 控制；optional 向後相容） */
  passengerName?: string;
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
  /** 折扣碼（陽春版）；無折扣則不帶 */
  discountCode?: string | null;
  /** Phase 1D：偏好標籤（vehicle-scope tag ids）；無 → 跳過 */
  preferences?: {
    tagIds?: string[];
  } | null;
  /** Charter Fare V1：orderType='charter' 時必填；非 charter 訂單忽略
   *  W1 鎖介面，W2 server 端在 /orders POST 編排層讀取此欄計算車資 */
  charter?: {
    /** length = days；多日可不同 plan，同車型 */
    planKeys: OrderCharterPlanKey[];
    /** 行程天數（≥ 1） */
    days: number;
  };
}

interface CreateOrderRes {
  orderId: string;
  estimatedFare: number;
  estimatedTime: number;
  distanceKm: number;
  orderStatus: string;
}

// ===== 取得訂單列表 =====
// P17：userId 改為 optional — passenger 由 server 強制使用 auth.lineUid，
// 此參數僅 admin / driver 可帶用於查指定使用者
// Wave 1 P3：from / to 為 ISO string（exclusive end）— server 內存過濾 pickupDateTime
interface GetOrderListParams {
  userId?: string;
  from?: string;
  to?: string;
}

interface OrderItem {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  vehicleType: string;
  passengerCount: number;
  /** Booking v2 批次 2：大人數（舊單 server fallback = passengerCount） */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數（舊單 server fallback = 0） */
  childCount?: number;
  estimatedFare: number;
  orderStatus: string;
  createdAt?: number;
}

// ===== P19：司機被指派的執行中訂單 =====
type AssignedOrderStatus = 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit';

interface AssignedOrder {
  orderId: string;
  userId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  /** Booking v2 批次 2：大人數 */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數 */
  childCount?: number;
  luggageItems: OrderLuggageItem[];
  estimatedFare: number;
  estimatedTime: number;
  distanceKm: number;
  extraServices: string[];
  flightNumber: string | null;
  terminal: string | null;
  notes: string | null;
  orderStatus: AssignedOrderStatus;
  createdAt: number;
  passengerName: string;
  passengerPhone: string | null;
  /** Phase 1F：乘客 Soft Match 確認狀態（null = 無紀錄；'pending' 表 driver 應顯示「等待乘客確認」） */
  passengerConfirmationStatus?: 'auto' | 'pending' | 'accepted' | 'declined' | null;
}

// ===== Wave 1 D1：司機歷史訂單（completed / cancelled）=====
interface DriverHistoryOrder {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  vehicleType: string;
  passengerCount: number;
  /** Booking v2 批次 2：大人數 */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數 */
  childCount?: number;
  estimatedFare: number;
  distanceKm: number;
  orderStatus: 'completed' | 'cancelled' | string;
  cancelReason: string | null;
  createdAt: number;
}

// ===== Wave 2 P4：乘客下一趟訂單 =====
// Home redesign：加 stopovers / flightNumber / driver（confirmed 後才有）
interface UpcomingOrderDriver {
  displayName: string;
  plateNumber: string;
  /** sedan/mpv/suv/van 分類（舊司機資料） */
  vehicleType: string;
  /** 品牌型號自由文字（如 "Tesla Model S"） */
  vehicleModel: string;
  /** 真實電話（drivers.application.phone）— confirmed 後乘客可直接撥；無設定回 null */
  phone: string | null;
}

interface UpcomingOrder {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  /** Home redesign：中途停靠站（舊單 fallback []） */
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  /** Booking v2 批次 2：大人數 */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數 */
  childCount?: number;
  estimatedFare: number;
  orderStatus: string;
  /** Home redesign：航班資訊（接機 / 送機才會有） */
  flightNumber: string | null;
  /** Home redesign：敲定司機後才出現（confirmed 以後） */
  driver: UpcomingOrderDriver | null;
}

// ===== P36：訂單詳情（單筆完整資訊）=====
type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'en_route'
  | 'arrived_pickup'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

interface OrderStatusHistory {
  confirmedAt: string | null;
  enRouteAt: string | null;
  arrivedPickupAt: string | null;
  inTransitAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

interface OrderDriverInfo {
  displayName: string;
  pictureUrl: string;
  plateNumber: string;
  /** 舊欄位（fallback only）：4 選 1 分類 sedan/mpv/suv/van */
  vehicleType: string;
  /** 司機自填「車輛品牌與型號」自由文字（例：Tesla Model S）— 2026-05-27 起新訂單會有 */
  vehicleModel: string;
  /** P36 選項 A：真實電話（drivers.application.phone）；未設定回 null */
  phone: string | null;
}

/** P36：/nuxt-api/orders/[orderId] 回傳完整訂單 + 司機資訊（confirmed 後才有） */
interface OrderDetail {
  orderId: string;
  userId: string;
  orderType: string;
  orderStatus: OrderStatus | string;
  pickupDateTime: string;
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  /** Booking v2 批次 2：大人數（server 對舊單已 fallback = passengerCount） */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數（server 對舊單已 fallback = 0） */
  childCount?: number;
  luggageItems: OrderLuggageItem[];
  extraServices: string[];
  estimatedFare: number;
  estimatedTime: number;
  distanceKm: number;
  contactPhone: string | null;
  /** Booking v2 批次 1：聯絡人姓名（舊單為 null） */
  contactName: string | null;
  /** Booking v2 批次 1：乘車人姓名（舊單為 null） */
  passengerName: string | null;
  flightNumber: string | null;
  terminal: string | null;
  notes: string | null;
  cancelReason: string | null;
  createdAt: string | null;
  statusHistory: OrderStatusHistory;
  driver: OrderDriverInfo | null;
  /** Phase 1D：偏好標籤 snapshot；null = 乘客建單時未勾選（舊單也是 null） */
  preferences?: OrderPreferencesDto | null;
  /** Charter Fare V1：包車訂單 snapshot；非 charter 訂單為 null，舊 charter 訂單也是 null（W2 之前未紀錄） */
  charter?: OrderCharter | null;
}

// ===== 更新訂單 =====
// P19：orderStatus 擴充新增 en_route / arrived_pickup
// P22：admin 可改更多欄位（server 端依角色限制，passenger/driver 帶這些欄位會被拒）
interface PatchOrderParams {
  orderStatus?: 'pending' | 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit' | 'completed' | 'cancelled' | string;
  assignedDriverId?: string;
  cancelReason?: string;
  // admin-only
  orderType?: string;
  pickupDateTime?: string;
  pickupLocation?: GooglePlace;
  dropoffLocation?: GooglePlace;
  stopovers?: GooglePlace[];
  vehicleType?: string;
  passengerCount?: number;
  /** Booking v2 批次 2：admin 可改大人數（會自動帶 passengerCount = adult + child） */
  adultCount?: number;
  /** Booking v2 批次 2：admin 可改兒童數 */
  childCount?: number;
  luggageItems?: OrderLuggageItem[];
  estimatedFare?: number;
  extraServices?: string[];
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
  passengerName?: string;
  contactPhone?: string;
  /** Wave 1 D2：driver 推進 4 個狀態 (en_route/arrived_pickup/in_transit/completed) 時，
   *  附上當下 GPS 座標。server 寫入 orders.statusHistoryLocations.{state}。
   *  其他角色 / 其他狀態提供本欄位會被 server 忽略。*/
  driverLocation?: { lat: number; lng: number };
  /** Charter Fare V1 W5：driver 結束包車任務時帶上當下時間 ISO；server 端會：
   *  1. 把值寫入 orders/{id}.charter.actualEndTime
   *  2. 用 computeOvertimeBlocks 重算 overtimeMinutes/Blocks/Charge 回寫 charter block
   *  3. 寫 audit log 'order.charter.actual_end'
   *  非 charter 訂單 / 非 driver(自己被指派) 角色 / 訂單無 charter block → server 忽略 */
  actualEndTime?: string;
  /**
   * 司機推進狀態時可選擇「不通知乘客」（目前用於「已到達上車點（僅紀錄）」按鈕）。
   * true 時 server 端跳過 order.en_route（司機到點通知）的 LINE push，
   * 但狀態切換 / war-room 狀態 / statusHistoryLocations 仍正常更新。
   */
  skipPassengerNotify?: boolean;
}

// ===== Maps =====
interface AutocompleteParams {
  input: string;
  sessiontoken?: string;
}

interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface GeocodeParams {
  placeId: string;
  sessiontoken?: string;
}

interface GeocodeRes {
  lat: number;
  lng: number;
  address: string;
  placeId: string;
}

interface DistanceParams {
  origin: string;
  destination: string;
}

interface DistanceRes {
  distance_km: number;
  duration_minutes: number;
  origin: string;
  destination: string;
}

// ===== 折扣碼驗證（乘客 booking 預覽）=====
interface ValidateDiscountParams {
  code: string;
  fare: number;
  orderType: string;
}

interface DiscountI18nMsg {
  zh_tw: string;
  en: string;
  ja: string;
}

interface ValidateDiscountRes {
  valid: boolean;
  discountAmount: number;
  failCode: string | null;
  reason: DiscountI18nMsg | null;
}

// ===== 生效中折扣碼（首頁優惠專區）=====
interface PublicDiscountCode {
  code: string;
  discountAmount: number;
  validUntil: string | null;
  minFare: number | null;
  allowedOrderTypes: string[] | null;
}

interface ActiveDiscountCodesRes {
  items: PublicDiscountCode[];
}
