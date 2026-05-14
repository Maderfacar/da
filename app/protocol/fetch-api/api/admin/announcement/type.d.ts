// P37 Phase 3：admin 公告 type 定義（對齊 server/utils/announcement.ts AnnouncementDoc）

export type AnnouncementStatus = 'draft' | 'published' | 'archived';
export type AnnouncementTargetType = 'all' | 'passenger' | 'driver' | 'order';

export interface AnnouncementCtaButton {
  label: string;
  url: string;
}

export interface AnnouncementChannels {
  line: boolean;
  inApp: boolean;
}

export interface AnnouncementPushStats {
  targetCount: number;
  sentCount: number;
  failedCount: number;
}

/**
 * 公告完整物件（API 回傳的形狀；timestamp 已轉 ISO string）。
 * 對齊 server `AnnouncementDoc`，但 Timestamp 欄位序列化成 string | null。
 */
export interface Announcement {
  id: string;
  status: AnnouncementStatus;
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: AnnouncementCtaButton | null;
  targetType: AnnouncementTargetType;
  targetOrderId: string | null;
  channels: AnnouncementChannels;
  createdBy: string;
  createdAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  pushStats: AnnouncementPushStats | null;
}

/** GET 列表回傳 */
export interface AnnouncementListRes {
  items: Announcement[];
  nextCursor: string | null;
}

/** POST/PATCH 共用內容欄位 */
export interface AnnouncementWriteBody {
  title?: string;
  body?: string;
  coverImageUrl?: string | null;
  ctaButton?: AnnouncementCtaButton | null;
  targetType?: AnnouncementTargetType;
  targetOrderId?: string | null;
  channels?: AnnouncementChannels;
}

/** POST 建草稿 body（必填 title / body / targetType / channels） */
export interface CreateAnnouncementBody extends AnnouncementWriteBody {
  title: string;
  body: string;
  targetType: AnnouncementTargetType;
  channels: AnnouncementChannels;
}

/** PATCH 編輯 / 狀態變更 body */
export interface PatchAnnouncementBody extends AnnouncementWriteBody {
  status?: AnnouncementStatus;
}

/** 圖片上傳回傳 */
export interface UploadAnnouncementCoverRes {
  url: string;
  objectPath: string;
  sizeBytes: number;
  mime: string;
}
