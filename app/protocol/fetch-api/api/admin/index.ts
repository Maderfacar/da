import methods from '@/protocol/fetch-api/methods';

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
  vehicleType?: 'sedan' | 'mpv' | 'suv' | 'van'
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

export interface AdminUser {
  uid: string
  lineUserId: string
  displayName: string
  pictureUrl: string
  roles: Role[]
  approved: boolean
  driverCategory?: string
  driverApplication?: DriverApplication
  createdAt: string
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
  luggageItems: AdminOrderLuggageItem[]
  estimatedFare: number
  estimatedTime: number
  distanceKm: number
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
  luggageItems?: AdminOrderLuggageItem[]
  estimatedFare?: number
  extraServices?: string[]
  flightNumber?: string | null
  terminal?: string | null
  notes?: string | null
  passengerName?: string
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
  luggageItems?: AdminOrderLuggageItem[]
  vehicleType: string
  extraServices?: string[]
  estimatedFare: number
  passengerName: string
  contactPhone: string
  flightNumber?: string | null
  terminal?: string | null
  notes?: string | null
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

/** 查詢所有訂單（Admin 用）— Wave 1 A3：支援 from/to ISO 範圍過濾 pickupDateTime */
export const GetAllOrders = (params: { status?: string; from?: string; to?: string } = {}) =>
  methods.get<AdminOrder[]>('/nuxt-api/admin/orders', params as Record<string, unknown>);

/** Admin 手動建立訂單（乘客為 server 自動產生的 guest id；車資手動輸入，不自動試算） */
export const CreateAdminOrder = (body: CreateAdminOrderBody) =>
  methods.post<{ orderId: string; orderStatus: string }>(
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
