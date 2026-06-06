import methods from '@/protocol/fetch-api/methods';
import type { DispatchVisibilityDto, DispatchLevel } from '~shared/types/dispatch-visibility';

export type { DispatchVisibilityDto, DispatchLevel } from '~shared/types/dispatch-visibility';

// P37 Phase 3：公告 sub-module
export * from './announcement';
// P38 Phase 2：LINE richmenu sub-module
export * from './line-richmenu';
// P38 Phase 4：通用 notification template sub-module
export * from './notification-template';
// P40 Phase 2：bot replies sub-module
export * from './bot-reply';
// P43 Phase 1：LINE event log sub-module
export * from './line-event-log';
// P43 Phase 2：LINE API error log sub-module
export * from './line-api-error';
// 會員條款 / 隱私政策 sub-module（admin）
export * from './legal-page';
// Fare V2：車資進階規則 sub-module（admin）
export * from './fare-rules';
// 折扣碼（陽春版）sub-module（admin）
export * from './discount-code';
// Admin Dashboard 線上名單 sub-module
export * from './dashboard';
// 推薦獎勵機制 Phase 4：admin 推薦活動 sub-module
export * from './referral';
// Phase 1E：訂單需求單 / 司機喊單 / 配對
export * from './order-dispatch';

export type Role = 'passenger' | 'driver' | 'admin';

/** P18：admin 三層分權 */
export type AdminLevel = 'super' | 'admin' | 'assistant';

export type DocType = 'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl'

/** P26：driver 上傳的待審核證件 */
export interface PendingDocument {
  url: string
  uploadedAt: string | null
  status: 'pending' | 'rejected'
  rejectedAt?: string | null
  rejectReason?: string | null
}

export interface DriverApplication {
  driverName?: string
  phone?: string
  plateNumber?: string
  /** 舊欄位（fallback only）：4 選 1 分類 sedan/mpv/suv/van — 已被 vehicleModel 取代 */
  vehicleType?: 'sedan' | 'mpv' | 'suv' | 'van'
  /** 司機自填「車輛品牌與型號」自由文字（例：Tesla Model S） */
  vehicleModel?: string
  bankCode?: string
  bankAccount?: string
  documents?: {
    licenseUrl?: string
    registrationUrl?: string
    insuranceUrl?: string
    goodCitizenUrl?: string
  }
  documentsPending?: Partial<Record<DocType, PendingDocument>>
  appliedAt?: string | null
  reviewedAt?: string | null
  reviewedBy?: string | null
  rejectedAt?: string | null
  rejectReason?: string | null
}

/** Phase 1B：driver vehicleProfile 已通過審核的版本（公開檔案頁與配對讀此欄位） */
export interface VehicleProfileDto {
  photos: string[]
  tags: string[]
  updatedAt: string | null
}

/** Phase 1B：driver 編輯中或待審的車輛 profile */
export interface VehicleProfilePendingDto {
  photos: string[]
  tags: string[]
  status: 'draft' | 'pending_review' | 'rejected'
  submittedAt: string | null
  rejectedAt: string | null
  rejectReason: string | null
  reviewedBy: string | null
  updatedAt: string | null
}

export interface AdminUser {
  uid: string
  lineUserId: string
  displayName: string
  pictureUrl: string
  roles: Role[]
  approved: boolean
  driverCategory?: string
  driverApplication?: DriverApplication
  /** Phase 1B：driver-scope tags（driverSkill） */
  tags?: string[]
  /** Phase 1B：已通過審核的車輛 profile */
  vehicleProfile?: VehicleProfileDto | null
  /** Phase 1B：草稿 / 待審 / 退回中的車輛 profile */
  vehicleProfilePending?: VehicleProfilePendingDto | null
  /** Phase 1B：最近一次 admin approve vehicleProfile 的 ISO 時間 */
  verifiedAt?: string | null
  verifiedBy?: string | null
  createdAt: string
  /** A2 醜點系統 Phase 1：當前累計醜點（0 = 無紀錄） */
  uglyCount?: number
  /** A2 醜點系統 Phase 1：是否被 admin 拉黑 */
  blacklisted?: boolean
  /** A2 醜點系統 Phase 1：被拉黑的 ISO 時間（blacklisted=false 時為 null） */
  blacklistedAt?: string | null
  /** A2 醜點系統 Phase 1：被拉黑的原因（blacklisted=false 時為 null） */
  blacklistedReason?: string | null
}

export interface GooglePlaceLite {
  address: string
  lat: number
  lng: number
  placeId?: string
  displayName?: string
}

export interface AdminOrderLuggageItem {
  typeId: string
  count: number
}

/** Phase 1D：admin 端訂單偏好標籤 snapshot */
export type AdminOrderPrefTagGroup =
  | 'power'
  | 'vehicleType'
  | 'origin'
  | 'interior'
  | 'equipment'
  | 'driverSkill';

export interface AdminOrderPrefTagSnapshot {
  id: string
  name: { zh_tw: string; en?: string; ja?: string }
  group: AdminOrderPrefTagGroup
  surchargeAmount: number
  sortOrder: number
}

export interface AdminOrderPreferences {
  tagIds: string[]
  tagSnapshot: AdminOrderPrefTagSnapshot[]
  tagSurcharge: number
  snapshotAt: string
}

/** Phase 1E：admin 看訂單列表時的 bid snapshot（含撤回） */
export interface AdminOrderBidSnapshot {
  driverId: string
  driverDisplayName: string
  bidAt: string | null
  withdrawnAt: string | null
}

/** Phase 1F：admin 看訂單列表時的歷次配對輪 snapshot */
export type AdminOrderBidHistoryEndReason = 'assigned' | 'rematched_by_passenger' | 'rematched_by_admin' | ''
export interface AdminOrderBidHistoryEntry {
  round: number
  bids: AdminOrderBidSnapshot[]
  endReason: AdminOrderBidHistoryEndReason
  endedAt: string | null
  endedBy: string | null
}

/** Phase 1F：乘客確認狀態 */
export type PassengerConfirmationStatus = 'auto' | 'pending' | 'accepted' | 'declined'

export interface AdminOrder {
  orderId: string
  userId: string
  lineUserId: string
  orderType: string
  pickupDateTime: string
  pickupLocation: GooglePlaceLite
  dropoffLocation: GooglePlaceLite
  stopovers: GooglePlaceLite[]
  vehicleType: string
  passengerCount: number
  /** Booking v2 批次 2：大人數（server fallback 已對齊舊單） */
  adultCount?: number
  /** Booking v2 批次 2：兒童數（server fallback 已對齊舊單） */
  childCount?: number
  luggageItems: AdminOrderLuggageItem[]
  estimatedFare: number
  estimatedTime: number
  distanceKm: number
  /** 視窗 2：路段分析快照（fare-v2 訂單才有；charter / 舊 v1 訂單為 null） */
  highwayKm?: number | null
  surfaceKm?: number | null
  surfaceSurcharge?: number | null
  extraServices: string[]
  flightNumber: string | null
  terminal: string | null
  notes: string | null
  orderStatus: string
  assignedDriverId: string
  cancelReason: string | null
  createdAt: number
  passengerName: string
  passengerPhone: string | null
  /** Phase 1D：偏好標籤 snapshot（null = 乘客建單時未勾選） */
  preferences?: AdminOrderPreferences | null
  /** Phase 1E：admin 派發時間（null = 尚未發出需求單；首發後固定不變） */
  dispatchAt?: string | null
  dispatchedBy?: string | null
  /** Phase 1E：最近一次重發推播時間（首發時無此欄位；每次重發 = serverTimestamp） */
  lastDispatchAt?: string | null
  lastDispatchedBy?: string | null
  /**
   * Phase 1E：重發累計次數（FieldValue.increment(1) 寫入；首發後仍為 undefined，
   * 第 N 次重發後 = N）。Wave 1A：列表 chip 顯示總派發次數 = (dispatchCount ?? 0) + 1。
   */
  dispatchCount?: number
  /** Phase 1E：司機喊單 list（append-only；withdrawnAt 非 null 表示撤回） */
  bids?: AdminOrderBidSnapshot[]
  /** Phase 1E：admin 指派時間（null = 尚未指派） */
  assignedAt?: string | null
  assignedBy?: string | null
  /** Phase 1F：乘客對 Soft Match 結果的確認狀態（null = 從未指派 / pre-1F 訂單） */
  passengerConfirmationStatus?: PassengerConfirmationStatus | null
  /** Phase 1F：本訂單已重新配對的次數（含 admin force rematch + passenger 選 wait） */
  reMatchRound?: number
  /** Phase 1F：歷次配對輪 snapshot（最後一輪不一定在這；當前的 bids 仍在 order.bids） */
  bidHistory?: AdminOrderBidHistoryEntry[]
  /**
   * Wave 2B+2C：派單分級可見性。
   * 舊單（Migration 前）/ 從未派發的訂單可能無此欄位 → consumer fallback `currentLevel='0'`（全開）。
   */
  dispatchVisibility?: DispatchVisibilityDto | null
  /**
   * Charter Fare V1：包車訂單 snapshot；非 charter 訂單為 null。
   * 訂單建立時寫入 plans 整份 freeze + estimatedEndTime；
   * W5 driver 結束行程時補寫 actualEndTime / overtimeMinutes / overtimeBlocks / overtimeCharge。
   * 型別與 app/protocol/fetch-api/api/order/type.d.ts::OrderCharter 對齊。
   */
  charter?: OrderCharter | null
}

export interface PatchAdminOrderBody {
  orderStatus?: string
  assignedDriverId?: string
  cancelReason?: string
  orderType?: string
  pickupDateTime?: string
  pickupLocation?: GooglePlaceLite
  dropoffLocation?: GooglePlaceLite
  stopovers?: GooglePlaceLite[]
  vehicleType?: string
  passengerCount?: number
  /** Booking v2 批次 2：大人數 */
  adultCount?: number
  /** Booking v2 批次 2：兒童數 */
  childCount?: number
  luggageItems?: AdminOrderLuggageItem[]
  estimatedFare?: number
  extraServices?: string[]
  flightNumber?: string | null
  terminal?: string | null
  notes?: string | null
  passengerName?: string
  /** Booking v2 批次 1：admin 可改聯絡人姓名 */
  contactName?: string
  contactPhone?: string
}

/** Admin 手動建立訂單的 body（乘客為 server 自動產生的 guest id） */
export interface CreateAdminOrderBody {
  orderType: string
  pickupDateTime: string
  pickupLocation: GooglePlaceLite
  dropoffLocation: GooglePlaceLite
  stopovers?: GooglePlaceLite[]
  passengerCount: number
  /** Booking v2 批次 2：大人數（server 自動 passengerCount = adult + child） */
  adultCount?: number
  /** Booking v2 批次 2：兒童數 */
  childCount?: number
  luggageItems?: AdminOrderLuggageItem[]
  vehicleType: string
  extraServices?: string[]
  estimatedFare: number
  passengerName: string
  contactPhone: string
  flightNumber?: string | null
  terminal?: string | null
  notes?: string | null
  /** 若為 true，建單成功後 server 直接呼叫 dispatchOrder + LINE multicast 給 active driver */
  autoDispatch?: boolean
}

export interface NotifyOrderBody {
  target: 'passenger' | 'driver'
  message: string
}

export interface PatchAdminUserBody {
  addRole?: Role
  removeRole?: Exclude<Role, 'passenger'>
  approved?: boolean
  rejectedAt?: string | null
  rejectReason?: string
  driverCategory?: string
  displayName?: string
}

/** 查詢使用者清單（依 role 篩選 — server 端用 array-contains） */
export const GetAdminUsers = (params: { role: Role; approved?: boolean }) =>
  methods.get<AdminUser[]>('/nuxt-api/admin/users', params as Record<string, unknown>);

/** 更新使用者 roles（addRole / removeRole）或 approved 狀態 */
export const PatchAdminUser = (uid: string, body: PatchAdminUserBody) =>
  methods.patch<{ uid: string; updated?: boolean }>(`/nuxt-api/admin/users/${uid}`, body);

// ── A2 醜點系統 Phase 1 ────────────────────────────────────────────

/** Admin 對訂單手動標記乘客未到（+2 醜；訂單轉 cancelled） */
export const MarkOrderNoShow = (orderId: string, body?: { reason?: string }) =>
  methods.post<{ orderId: string; cancellationCategory: 'no_show'; uglyCount: number | null; pushed: 'warning' | 'suspended' | null }>(
    `/nuxt-api/admin/orders/${orderId}/no-show`,
    (body ?? {}) as unknown as Record<string, unknown>,
  );

/** Admin 對乘客拉黑 / 解黑（add 後該乘客無法下訂） */
export const PostUserBlacklist = (uid: string, body: { action: 'add' | 'remove'; reason?: string }) =>
  methods.post<{ uid: string; blacklisted: boolean }>(
    `/nuxt-api/admin/users/${uid}/blacklist`,
    body as unknown as Record<string, unknown>,
  );

/** 查詢所有訂單（Admin 用）— Wave 1 A3：支援 from/to ISO 範圍過濾 pickupDateTime
 *  region filter：regionField=pickup|dropoff + cities=台北市,新北市 + districts=中正區,信義區 */
export interface GetAllOrdersParams {
  status?: string;
  from?: string;
  to?: string;
  regionField?: 'pickup' | 'dropoff';
  /** 逗號分隔的縣市中文全名 list */
  cities?: string;
  /** 逗號分隔的鄉鎮市區中文全名 list */
  districts?: string;
}

export const GetAllOrders = (params: GetAllOrdersParams = {}) =>
  methods.get<AdminOrder[]>('/nuxt-api/admin/orders', params as Record<string, unknown>);

/** Admin 手動建立訂單（乘客為 server 自動產生的 guest id；車資手動輸入，不自動試算） */
export const CreateAdminOrder = (body: CreateAdminOrderBody) =>
  methods.post<{ orderId: string; orderStatus: string; dispatched: boolean }>(
    '/nuxt-api/admin/orders',
    body as unknown as Record<string, unknown>,
  );

/** 廣播 LINE 推播通知 */
export const BroadcastNotification = (body: { title: string; message: string; targetRole: 'all' | 'passenger' | 'driver' }) =>
  methods.post<{ sent: number; total: number }>('/nuxt-api/admin/broadcast', body);

/** 點對點訂單通知（admin 對某筆訂單的乘客或司機發 LINE 推播） */
export const NotifyOrder = (orderId: string, body: NotifyOrderBody) =>
  methods.post<{ orderId: string; target: string; sentTo: string }>(
    `/nuxt-api/admin/orders/${orderId}/notify`,
    body as unknown as Record<string, unknown>,
  );

// Wave 1C：訂單後修 tag → 車資重算 -------------------------------------------

export type OrderRecalcWarning = 'discount_expired_fallback';

export interface OrderRecalcBeforeAfter {
  tagIds: string[]
  tagSurcharge: number
  discountAmount: number
  fareBeforeDiscount: number
  finalTotal: number
  /** preview 端點 after 才有，PATCH 不回傳 */
  tagSnapshot?: AdminOrderPrefTagSnapshot[]
}

export interface OrderRecalcPreviewRes {
  orderId: string
  before: OrderRecalcBeforeAfter
  after: OrderRecalcBeforeAfter
  diff: { finalTotal: number; tagSurcharge: number; discountAmount: number }
  warnings: OrderRecalcWarning[]
}

/** Wave 1C：訂單後修 tag 重算車資（dry-run，僅預覽，不寫 doc） */
export const RecalcOrderPreview = (orderId: string, body: { tagIds: string[] }) =>
  methods.post<OrderRecalcPreviewRes>(
    `/nuxt-api/admin/orders/${orderId}/recalc-preview`,
    body as unknown as Record<string, unknown>,
  );

// P18：admins collection 相關 ----------------------------------------------------

// P34：細粒度權限類型（與 server/utils/require-permission.ts Permission 對齊）
export type AdminPermission =
  | 'canManageAdmins'
  | 'canManageDrivers'
  | 'canManageOrders'
  | 'canBroadcast'
  | 'canViewFinance'
  | 'canManageFleet';

export interface AdminEntry {
  uid: string
  lineUserId: string
  displayName: string
  pictureUrl: string
  level: AdminLevel
  // P34：null = 走 LEVEL_TABLE 預設；object = 細粒度 override
  permissions?: Partial<Record<AdminPermission, boolean>> | null
  createdBy?: string | null
  createdAt: string
  lastLoginAt?: string | null
}

/** 列出所有管理員（含 level + permissions override）— 需 canManageAdmins */
export const GetAdmins = () =>
  methods.get<AdminEntry[]>('/nuxt-api/admin/admins');

/**
 * 修改某管理員 level / permissions override（P34）— 需 canManageAdmins
 * - body.level：'admin' | 'assistant'（super 不接受；target=super 一律 403）
 * - body.permissions：null 清除 override（走 LEVEL_TABLE） / object 細粒度設定
 */
export const PatchAdmin = (uid: string, body: {
  level?: 'admin' | 'assistant';
  permissions?: Partial<Record<AdminPermission, boolean>> | null;
}) =>
  methods.patch<{ uid: string; level: AdminLevel }>(`/nuxt-api/admin/admins/${uid}`, body);

// P26 admin/drivers ---------------------------------------------------------

/** Admin 編輯司機 profile 業務欄位（目前只開放 phone）— 需 canManageDrivers */
export const PatchAdminDriver = (uid: string, body: { phone?: string }) =>
  methods.patch<{ uid: string; updated: boolean }>(`/nuxt-api/admin/drivers/${uid}`, body);

/** Admin 核准 / 退回司機 pending 證件 — 需 canManageDrivers */
export const ReviewDriverDocument = (uid: string, body: {
  docType: DocType
  decision: 'approve' | 'reject'
  reason?: string
}) => methods.post<{ uid: string; docType: string; decision: string }>(
  `/nuxt-api/admin/drivers/${uid}/document-review`,
  body as unknown as Record<string, unknown>,
);

/** Phase 1B：Admin 核准 / 退回司機 pending 車輛 profile — 需 canManageDrivers */
export const PostVehicleProfileReview = (uid: string, body: {
  decision: 'approve' | 'reject'
  reason?: string
}) => methods.post<{ uid: string; decision: string }>(
  `/nuxt-api/admin/drivers/${encodeURIComponent(uid)}/vehicle-profile-review`,
  body as unknown as Record<string, unknown>,
);

// ── P40 Phase 1：LINE Postback Whitelist（admin 編輯 richmenu / template 時下拉選用） ────
export interface LinePostbackWhitelistItem {
  data: string
  label: string
  channel: 'passenger' | 'driver' | 'both'
}
export interface LinePostbackWhitelistRes {
  items: LinePostbackWhitelistItem[]
}

/**
 * 列 admin 可選的 postback whitelist（依 channel 過濾；不傳 channel 則回全部含 both）
 * 用於 richmenu Edit dialog / TemplateEditor postback action input 下拉
 */
export const GetLinePostbackWhitelist = (params: { channel?: 'passenger' | 'driver' } = {}) =>
  methods.get<LinePostbackWhitelistRes>(
    '/nuxt-api/admin/line-postback-whitelist',
    params as Record<string, unknown>,
  );
