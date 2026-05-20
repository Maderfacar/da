/**
 * 車輛 / 司機標籤 server-side helpers（Phase 1A）
 *
 * - 共用「tag doc <-> dto」轉換
 * - 共用 `tag_audit_logs` 寫入 helper（獨立 collection，不混 audit_logs）
 * - 取下一個 sortOrder（同 group 內 max + 1）
 *
 * Audit log schema（per design §1.2）：
 *   tag_audit_logs/{logId} {
 *     tagId, action, beforeSnapshot, afterSnapshot,
 *     performedBy, performedByEmail?, performedAt
 *   }
 *
 * 客戶端禁寫（firestore.rules layer）；本檔所有操作皆走 Admin SDK。
 */
import { FieldValue, type Timestamp, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { TagGroup, TagScope } from '~shared/tagTaxonomy';

export type TagStatus = 'active' | 'archived';
export type TagAuditAction = 'create' | 'update' | 'archive' | 'restore';

export interface TagDoc {
  name: { zh_tw: string; en?: string; ja?: string };
  group: TagGroup;
  scope: TagScope;
  surchargeAmount: number;
  status: TagStatus;
  sortOrder: number;
  createdAt: Timestamp | null;
  createdBy: string;
  updatedAt: Timestamp | null;
  updatedBy: string;
}

export interface TagDto {
  id: string;
  name: { zh_tw: string; en: string; ja: string };
  group: TagGroup;
  scope: TagScope;
  surchargeAmount: number;
  status: TagStatus;
  sortOrder: number;
  createdAt: string | null;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string;
}

export interface TagAuditLogDoc {
  tagId: string;
  action: TagAuditAction;
  beforeSnapshot: Partial<TagDoc> | null;
  afterSnapshot: Partial<TagDoc>;
  performedBy: string;
  performedByEmail?: string;
  performedAt: Timestamp | null;
}

export interface TagAuditLogDto {
  id: string;
  tagId: string;
  action: TagAuditAction;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown>;
  performedBy: string;
  performedByEmail: string | null;
  performedAt: string | null;
}

const _tsToIso = (ts: Timestamp | null | undefined): string | null =>
  ts ? ts.toDate().toISOString() : null;

export function toTagDto(snap: DocumentSnapshot): TagDto | null {
  const data = snap.data() as Partial<TagDoc> | undefined;
  if (!data) return null;
  return {
    id: snap.id,
    name: {
      zh_tw: data.name?.zh_tw ?? '',
      en: data.name?.en ?? '',
      ja: data.name?.ja ?? '',
    },
    group: (data.group ?? 'power') as TagGroup,
    scope: (data.scope ?? 'vehicle') as TagScope,
    surchargeAmount: typeof data.surchargeAmount === 'number' ? data.surchargeAmount : 0,
    status: (data.status ?? 'active') as TagStatus,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    createdAt: _tsToIso(data.createdAt as Timestamp | null | undefined),
    createdBy: data.createdBy ?? '',
    updatedAt: _tsToIso(data.updatedAt as Timestamp | null | undefined),
    updatedBy: data.updatedBy ?? '',
  };
}

export function toTagAuditLogDto(snap: DocumentSnapshot): TagAuditLogDto | null {
  const data = snap.data() as Partial<TagAuditLogDoc> | undefined;
  if (!data) return null;
  return {
    id: snap.id,
    tagId: data.tagId ?? '',
    action: (data.action ?? 'update') as TagAuditAction,
    beforeSnapshot: (data.beforeSnapshot ?? null) as Record<string, unknown> | null,
    afterSnapshot: (data.afterSnapshot ?? {}) as Record<string, unknown>,
    performedBy: data.performedBy ?? '',
    performedByEmail: data.performedByEmail ?? null,
    performedAt: _tsToIso(data.performedAt as Timestamp | null | undefined),
  };
}

/**
 * 取得指定 group 內下一個 sortOrder（max + 1）。
 * 空 group 從 1 起算。
 */
export async function getNextSortOrderForGroup(db: Firestore, group: TagGroup): Promise<number> {
  const snap = await db.collection('tags')
    .where('group', '==', group)
    .orderBy('sortOrder', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return 1;
  const top = snap.docs[0]!.data() as Partial<TagDoc>;
  const cur = typeof top.sortOrder === 'number' ? top.sortOrder : 0;
  return cur + 1;
}

interface WriteTagAuditLogInput {
  db: Firestore;
  tagId: string;
  action: TagAuditAction;
  before: Partial<TagDoc> | null;
  after: Partial<TagDoc>;
  performedBy: string;
  performedByEmail?: string;
}

/**
 * 寫一筆 tag audit log。失敗 silent log，不阻擋主流程。
 */
export async function writeTagAuditLog(input: WriteTagAuditLogInput): Promise<void> {
  try {
    await input.db.collection('tag_audit_logs').add({
      tagId: input.tagId,
      action: input.action,
      beforeSnapshot: input.before,
      afterSnapshot: input.after,
      performedBy: input.performedBy,
      ...(input.performedByEmail ? { performedByEmail: input.performedByEmail } : {}),
      performedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[tag-audit-log] write failed (silent):', err);
  }
}
