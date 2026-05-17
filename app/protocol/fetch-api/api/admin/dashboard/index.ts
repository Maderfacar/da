// Admin Dashboard API methods（admin-auto-notify-dashboard 變更 + 後續強化）
import methods from '@/protocol/fetch-api/methods';
import type { DashboardSummaryRes } from './type.d';

export type {
  ActiveDiscountCode,
  DashboardOrderCounts,
  DashboardSummaryRes,
  OnlineDriver,
  OnlineUser,
} from './type.d';

/** 取 Dashboard 總覽（線上名單 + 訂單狀態計數 + 啟用中折扣碼） */
export const GetDashboardSummary = () =>
  methods.get<DashboardSummaryRes>('/nuxt-api/admin/dashboard/summary');
