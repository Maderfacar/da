// P37 Phase 5：乘客端公告 API
import methods from '@/protocol/fetch-api/methods';
import type {
  AnnouncementDetail,
  AnnouncementListRes,
  AnnouncementUnreadRes,
} from './type.d';

export type {
  AnnouncementDetail,
  AnnouncementListItem,
  AnnouncementListRes,
  AnnouncementUnreadRes,
} from './type.d';

/** 取得乘客可見的 published 公告列表（分頁） */
export const GetAnnouncements = (params: { limit?: number; cursor?: string | null } = {}) =>
  methods.get<AnnouncementListRes>(
    '/nuxt-api/passenger/announcements',
    params as Record<string, unknown>,
  );

/** 取得單篇公告（順帶寫已讀） */
export const GetAnnouncementDetail = (id: string) =>
  methods.get<AnnouncementDetail>(`/nuxt-api/passenger/announcements/${id}`);

/** 未讀數（drawer 紅點 polling） */
export const GetAnnouncementUnreadCount = () =>
  methods.get<AnnouncementUnreadRes>('/nuxt-api/passenger/announcements/unread-count');

// ── 司機端「公告欄」（沿用相同 shape，但 server filter 只給 all/driver target） ──

/** 司機端公告欄列表 */
export const GetDriverAnnouncements = (params: { limit?: number; cursor?: string | null } = {}) =>
  methods.get<AnnouncementListRes>(
    '/nuxt-api/driver/announcements',
    params as Record<string, unknown>,
  );

/** 司機端公告詳情（順帶寫已讀） */
export const GetDriverAnnouncementDetail = (id: string) =>
  methods.get<AnnouncementDetail>(`/nuxt-api/driver/announcements/${id}`);

/** 司機端未讀數（layout drawer 紅點 polling） */
export const GetDriverAnnouncementUnreadCount = () =>
  methods.get<AnnouncementUnreadRes>('/nuxt-api/driver/announcements/unread-count');
