// P37 Phase 3：admin 公告 API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  Announcement,
  AnnouncementListRes,
  AnnouncementStatus,
  CreateAnnouncementBody,
  PatchAnnouncementBody,
  UploadAnnouncementCoverRes,
} from './type.d';

export type {
  Announcement,
  AnnouncementChannels,
  AnnouncementCtaButton,
  AnnouncementListRes,
  AnnouncementPushStats,
  AnnouncementStatus,
  AnnouncementTargetType,
  AnnouncementWriteBody,
  CreateAnnouncementBody,
  PatchAnnouncementBody,
  UploadAnnouncementCoverRes,
} from './type.d';

/** 列表公告（admin 用），可依 status filter + 分頁 cursor */
export const GetAdminAnnouncements = (params: {
  status?: AnnouncementStatus | 'all';
  limit?: number;
  cursor?: string | null;
} = {}) =>
  methods.get<AnnouncementListRes>(
    '/nuxt-api/admin/announcements',
    params as Record<string, unknown>,
  );

/** 取得單篇公告詳情 */
export const GetAdminAnnouncement = (id: string) =>
  methods.get<Announcement>(`/nuxt-api/admin/announcements/${id}`);

/** 建立草稿公告 */
export const CreateAdminAnnouncement = (body: CreateAnnouncementBody) =>
  methods.post<{ id: string; status: AnnouncementStatus }>(
    '/nuxt-api/admin/announcements',
    body as unknown as Record<string, unknown>,
  );

/** 編輯公告 / 變更 status（任意循環） */
export const PatchAdminAnnouncement = (id: string, body: PatchAnnouncementBody) =>
  methods.patch<{ id: string; updated: boolean; newStatus: AnnouncementStatus }>(
    `/nuxt-api/admin/announcements/${id}`,
    body as unknown as Record<string, unknown>,
  );

/** 刪除公告（任何 status 皆可） */
export const DeleteAdminAnnouncement = (id: string) =>
  methods.delete<{ id: string; deleted: boolean }>(`/nuxt-api/admin/announcements/${id}`);

/** 上傳公告封面圖（multipart） */
export const UploadAdminAnnouncementCover = (file: File) =>
  methods.formData<UploadAnnouncementCoverRes>(
    '/nuxt-api/admin/announcements/upload-cover',
    { file },
  );
