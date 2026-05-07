import methods from '@/protocol/fetch-api/methods';

export type Role = 'passenger' | 'driver' | 'admin';

export interface AdminUser {
  uid: string
  lineUserId: string
  displayName: string
  pictureUrl: string
  roles: Role[]
  approved: boolean
  createdAt: string
}

export interface AdminOrder {
  orderId: string
  userId: string
  lineUserId: string
  orderType: string
  pickupDateTime: string
  pickupLocation: { address: string; displayName?: string }
  dropoffLocation: { address: string; displayName?: string }
  vehicleType: string
  estimatedFare: number
  distanceKm: number
  orderStatus: string
  assignedDriverId: string
  createdAt: number
}

export interface PatchAdminUserBody {
  addRole?: Role
  removeRole?: Exclude<Role, 'passenger'>
  approved?: boolean
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
