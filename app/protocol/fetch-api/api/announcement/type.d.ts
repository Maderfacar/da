// P37 Phase 5：乘客端公告 type 定義

/** 消息分類：trip = 針對單一訂單（targetType='order'）；announcement = 其餘公告 */
export type AnnouncementCategory = 'announcement' | 'trip';

/** 列表 item（含 isRead，封面 + 標題 + 發佈時間 + 分類） */
export interface AnnouncementListItem {
  id: string;
  title: string;
  coverImageUrl: string | null;
  publishedAt: string | null;
  isRead: boolean;
  category: AnnouncementCategory;
}

export interface AnnouncementListRes {
  items: AnnouncementListItem[];
  nextCursor: string | null;
}

/** 詳情頁完整 announcement（passenger 不需要 status / channels / pushStats 等管理欄位） */
export interface AnnouncementDetail {
  id: string;
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: { label: string; url: string } | null;
  publishedAt: string | null;
}

export interface AnnouncementUnreadRes {
  unread: number;
  total: number;
}
