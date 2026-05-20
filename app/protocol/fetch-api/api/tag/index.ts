// 車輛 / 司機標籤 API methods（Phase 1A）
import methods from '@/protocol/fetch-api/methods';
import type {
  TagListRes,
  TagAuditLogListRes,
  CreateTagBody,
  UpdateTagBody,
  ArchiveTagBody,
  ArchiveTagRes,
  CreateTagRes,
  UpdateTagRes,
  SeedTagsRes,
  TagScope,
} from './type.d';

export type {
  TagDto,
  TagAuditLogDto,
  TagListRes,
  TagAuditLogListRes,
  CreateTagBody,
  UpdateTagBody,
  ArchiveTagBody,
  ArchiveTagRes,
  CreateTagRes,
  UpdateTagRes,
  SeedTagsRes,
  TagStatus,
  TagAuditAction,
  TagGroup,
  TagScope,
} from './type.d';

/** Admin 列表（含 archived） */
export const GetTagList = () =>
  methods.get<TagListRes>('/nuxt-api/tags');

/** Active-only（給司機 / booking 用） */
export const GetActiveTags = (scope?: TagScope) =>
  methods.get<TagListRes>('/nuxt-api/tags/active', scope ? { scope } : {});

/** 新增標籤 */
export const CreateTag = (body: CreateTagBody) =>
  methods.post<CreateTagRes>('/nuxt-api/tags', body as unknown as Record<string, unknown>);

/** 更新標籤（partial；不可改 group） */
export const UpdateTag = (id: string, body: UpdateTagBody) =>
  methods.put<UpdateTagRes>(
    `/nuxt-api/tags/${encodeURIComponent(id)}`,
    body as unknown as Record<string, unknown>,
  );

/** 軟刪 / 還原（archive=true / false） */
export const ArchiveTag = (id: string, body: ArchiveTagBody) =>
  methods.post<ArchiveTagRes>(
    `/nuxt-api/tags/${encodeURIComponent(id)}/archive`,
    body as unknown as Record<string, unknown>,
  );

/** 查詢單一標籤的 audit log 歷史 */
export const GetTagAuditLogs = (id: string, query: { limit?: number } = {}) =>
  methods.get<TagAuditLogListRes>(
    `/nuxt-api/tags/${encodeURIComponent(id)}/audit-logs`,
    query as Record<string, unknown>,
  );

/** 載入預設標籤種子（idempotent） */
export const SeedTags = () =>
  methods.post<SeedTagsRes>('/nuxt-api/tags/seed');
