/**
 * Announcement helpers（P37）
 *
 * 共用：
 *   - validateAnnouncementBody：寫入前驗證欄位
 *   - sanitizeBody：簡易 HTML sanitize（移除 <script> / on* / javascript: URI）
 *   - getAnnouncementTargets：依 targetType 撈受眾 lineUid 列表（publish 推送用）
 *   - filterAnnouncementForUser：判斷單篇 announcement 對特定 user 是否可見
 *
 * 對應 openspec/changes/2026-05-14-passenger-announcements/design.md
 */
import type { Firestore } from 'firebase-admin/firestore';

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

export interface AnnouncementDoc {
  id?: string;
  status: AnnouncementStatus;
  title: string;
  body: string;                  // sanitized HTML
  coverImageUrl: string | null;
  ctaButton: AnnouncementCtaButton | null;
  targetType: AnnouncementTargetType;
  targetOrderId: string | null;
  channels: AnnouncementChannels;
  createdBy: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  publishedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  archivedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  pushStats: AnnouncementPushStats | null;
}

export interface AnnouncementWriteInput {
  title?: string;
  body?: string;
  coverImageUrl?: string | null;
  ctaButton?: AnnouncementCtaButton | null;
  targetType?: AnnouncementTargetType;
  targetOrderId?: string | null;
  channels?: AnnouncementChannels;
}

const MAX_TITLE = 60;
const MAX_BODY = 10_000;
const MAX_CTA_LABEL = 20;
const VALID_TARGET_TYPES: AnnouncementTargetType[] = ['all', 'passenger', 'driver', 'order'];

/**
 * 驗證 announcement 寫入 payload。回傳錯誤訊息（null 表示通過）。
 * @param input - 部分 / 完整欄位
 * @param requireAll - true 時必填 title / body / targetType / channels（POST create 用）
 */
export function validateAnnouncementBody(
  input: AnnouncementWriteInput,
  requireAll: boolean,
): string | null {
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > MAX_TITLE) {
      return `title 必須為 1-${MAX_TITLE} 字`;
    }
  } else if (requireAll) {
    return 'title 缺失';
  }

  if (input.body !== undefined) {
    if (typeof input.body !== 'string' || input.body.trim().length === 0 || input.body.length > MAX_BODY) {
      return `body 必須為 1-${MAX_BODY} 字`;
    }
  } else if (requireAll) {
    return 'body 缺失';
  }

  if (input.coverImageUrl !== undefined && input.coverImageUrl !== null) {
    if (typeof input.coverImageUrl !== 'string' || !input.coverImageUrl.startsWith('https://')) {
      return 'coverImageUrl 必須為 https:// 開頭';
    }
  }

  if (input.ctaButton !== undefined && input.ctaButton !== null) {
    const cta = input.ctaButton;
    if (typeof cta !== 'object'
      || typeof cta.label !== 'string'
      || cta.label.trim().length === 0
      || cta.label.length > MAX_CTA_LABEL) {
      return `ctaButton.label 必須為 1-${MAX_CTA_LABEL} 字`;
    }
    if (typeof cta.url !== 'string' || !cta.url.startsWith('https://')) {
      return 'ctaButton.url 必須為 https:// 開頭';
    }
  }

  if (input.targetType !== undefined) {
    if (!VALID_TARGET_TYPES.includes(input.targetType)) {
      return `targetType 必須為 ${VALID_TARGET_TYPES.join(' / ')}`;
    }
    if (input.targetType === 'order' && (!input.targetOrderId || typeof input.targetOrderId !== 'string')) {
      return 'targetType=order 時 targetOrderId 必填';
    }
    if (input.targetType !== 'order' && input.targetOrderId) {
      return 'targetOrderId 只能在 targetType=order 時設定';
    }
  } else if (requireAll) {
    return 'targetType 缺失';
  }

  if (input.channels !== undefined) {
    const ch = input.channels;
    if (typeof ch !== 'object'
      || typeof ch.line !== 'boolean'
      || typeof ch.inApp !== 'boolean') {
      return 'channels.line / channels.inApp 必須為 boolean';
    }
    if (!ch.line && !ch.inApp) {
      return 'channels 至少擇一（line 或 inApp）';
    }
  } else if (requireAll) {
    return 'channels 缺失';
  }

  return null;
}

/**
 * 簡易 HTML sanitize — 移除明顯危險的內容。
 *
 * **不是**完整 XSS 防護；Phase 5 乘客端 v-html render 時應再過一次 DOMPurify。
 * 此處主要擋住 admin 從 TinyEditor 不小心貼入的 <script> 與 javascript: URI。
 */
export function sanitizeBody(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // <script>...</script>
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // <iframe>...</iframe>
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')   // onclick="..." onload="..." etc
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')              // href="javascript:..."
    .trim();
}

/**
 * 依 targetType 撈出受眾的 lineUid 列表（publish LINE push 時用）。
 *
 * - all       → 撈 users 全表
 * - passenger → users where roles array-contains 'passenger'
 * - driver    → users where roles array-contains 'driver'
 * - order     → 撈該訂單 owner 一人（user.lineUserId）
 */
export async function getAnnouncementTargets(
  db: Firestore,
  targetType: AnnouncementTargetType,
  targetOrderId: string | null,
): Promise<string[]> {
  if (targetType === 'order') {
    if (!targetOrderId) return [];
    const orderSnap = await db.collection('orders').doc(targetOrderId).get();
    if (!orderSnap.exists) return [];
    const userId = orderSnap.data()?.userId as string | undefined;
    return userId ? [userId] : [];
  }

  let q = db.collection('users') as FirebaseFirestore.Query;
  if (targetType !== 'all') {
    q = q.where('roles', 'array-contains', targetType);
  }

  const snapshot = await q.get();
  const uids: string[] = [];
  snapshot.docs.forEach((doc) => {
    const lineUserId = doc.data().lineUserId as string | undefined;
    if (lineUserId) uids.push(lineUserId);
  });
  return uids;
}

/**
 * 判斷單篇 announcement 對特定 user 是否可見（Phase 5 乘客 list / detail 過濾用）。
 *
 * 規則（status=published 為前提，archived/draft 一律不顯示給乘客）：
 *   - targetType='all'       → 全部使用者
 *   - targetType='passenger' → roles 含 passenger
 *   - targetType='driver'    → roles 含 driver
 *   - targetType='order'     → targetOrderId 對應訂單 owner === lineUid
 */
export function isAnnouncementVisibleToUser(
  ann: { status: string; targetType: string; targetOrderId?: string | null },
  user: { lineUid: string; roles: string[]; ownedOrderIds?: string[] },
): boolean {
  if (ann.status !== 'published') return false;

  switch (ann.targetType) {
    case 'all':
      return true;
    case 'passenger':
      return user.roles.includes('passenger');
    case 'driver':
      return user.roles.includes('driver');
    case 'order':
      return !!(ann.targetOrderId && user.ownedOrderIds?.includes(ann.targetOrderId));
    default:
      return false;
  }
}
