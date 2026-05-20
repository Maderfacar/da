// 車輛 / 司機標籤 API 型別

import type { TagGroup, TagScope } from '~shared/tagTaxonomy';

export type { TagGroup, TagScope } from '~shared/tagTaxonomy';

export type TagStatus = 'active' | 'archived';

export type TagAuditAction = 'create' | 'update' | 'archive' | 'restore';

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

export interface TagListRes {
  tags: TagDto[];
}

export interface TagAuditLogListRes {
  logs: TagAuditLogDto[];
}

export interface CreateTagBody {
  name: { zh_tw: string; en?: string; ja?: string };
  group: TagGroup;
  scope: TagScope;
  surchargeAmount: number;
  sortOrder?: number;
}

export interface UpdateTagBody {
  name?: { zh_tw?: string; en?: string; ja?: string };
  scope?: TagScope;
  surchargeAmount?: number;
  sortOrder?: number;
}

export interface ArchiveTagBody {
  archive: boolean;
}

export interface ArchiveTagRes {
  id: string;
  status: TagStatus;
}

export interface CreateTagRes {
  id: string;
}

export interface UpdateTagRes {
  id: string;
}

export interface SeedTagsRes {
  seeded: number;
}
