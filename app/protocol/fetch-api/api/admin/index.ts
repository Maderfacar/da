import methods from '@/protocol/fetch-api/methods';

export type Role = 'passenger' | 'driver' | 'admin';

/** P18：admin 三層分權 */
export type AdminLevel = 'super' | 'admin' | 'assistant';

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
  luggageCount: number
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
  pickupDateTime?: string
  pickupLocation?: GooglePlaceLite
  dropoffLocation?: GooglePlaceLite
  stopovers?: GooglePlaceLite[]
  vehicleType?: string
  passengerCount?: number
  luggageCount?: number
  estimatedFare?: number
  extraServices?: string[]
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

/** 查詢所有訂單（Admin 用） */
export const GetAllOrders = (params: { status?: string } = {}) =>
  methods.get<AdminOrder[]>('/nuxt-api/admin/orders', params as Record<string, unknown>);

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

export interface AdminEntry {
  uid: string
  lineUserId: string
  displayName: string
  pictureUrl: string
  level: AdminLevel
  createdBy?: string | null
  createdAt: string
  lastLoginAt?: string | null
}

/** 列出所有管理員（含 level）— 需 canManageAdmins */
export const GetAdmins = () =>
  methods.get<AdminEntry[]>('/nuxt-api/admin/admins');

/** 修改某管理員 level（僅 'admin' | 'assistant'，不接受 super；target=super 也會被擋）— 需 canManageAdmins */
export const PatchAdmin = (uid: string, body: { level: 'admin' | 'assistant' }) =>
  methods.patch<{ uid: string; level: AdminLevel }>(`/nuxt-api/admin/admins/${uid}`, body);
