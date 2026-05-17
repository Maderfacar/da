// Admin Dashboard API methods（admin-auto-notify-dashboard 變更）
import methods from '@/protocol/fetch-api/methods';
import type { DashboardOnlineRes } from './type.d';

export type { DashboardOnlineRes, OnlineDriver, OnlineUser } from './type.d';

/** 取線上名單（5 分鐘內活躍的乘客 / 司機） */
export const GetDashboardOnline = () =>
  methods.get<DashboardOnlineRes>('/nuxt-api/admin/dashboard/online');
