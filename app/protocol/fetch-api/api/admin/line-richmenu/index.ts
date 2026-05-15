// P38 Phase 2：admin LINE richmenu API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  CleanupOrphanBody,
  LineClient,
  LineRichmenuDto,
  CreateRichmenuBody,
  PatchRichmenuBody,
  PublishRichmenuRes,
  RichmenuLang,
  RichmenuListRes,
  RichmenuStatus,
  SyncOverviewRes,
  SyncStatusRes,
  UploadRichmenuImageRes,
} from './type.d';

export type {
  CleanupOrphanBody,
  CreateRichmenuBody,
  LineClient,
  LineRichmenuDto,
  PatchRichmenuBody,
  PublishRichmenuRes,
  RichmenuAction,
  RichmenuArea,
  RichmenuBounds,
  RichmenuLang,
  RichmenuListRes,
  RichmenuSize,
  RichmenuStatus,
  SyncOverviewByLangEntry,
  SyncOverviewLineMenu,
  SyncOverviewLocalDoc,
  SyncOverviewRes,
  SyncStatus,
  SyncStatusRes,
  UploadRichmenuImageRes,
} from './type.d';

/** 列表 richmenu（依 channel + lang + status filter；P42 加 lang param） */
export const GetLineRichmenus = (params: {
  channel: LineClient;
  lang?: RichmenuLang | 'all';
  status?: RichmenuStatus | 'all';
  limit?: number;
}) =>
  methods.get<RichmenuListRes>(
    '/nuxt-api/admin/line-richmenus',
    params as Record<string, unknown>,
  );

/** 取單筆 richmenu 詳情 */
export const GetLineRichmenu = (id: string) =>
  methods.get<LineRichmenuDto>(`/nuxt-api/admin/line-richmenus/${id}`);

/** 建草稿 */
export const CreateLineRichmenu = (body: CreateRichmenuBody) =>
  methods.post<{ id: string; status: 'draft' }>(
    '/nuxt-api/admin/line-richmenus',
    body as unknown as Record<string, unknown>,
  );

/** 編輯 */
export const PatchLineRichmenu = (id: string, body: PatchRichmenuBody) =>
  methods.patch<{ id: string; updated: boolean; fields: string[] }>(
    `/nuxt-api/admin/line-richmenus/${id}`,
    body as unknown as Record<string, unknown>,
  );

/** 刪除 */
export const DeleteLineRichmenu = (id: string) =>
  methods.delete<{ id: string; deleted: boolean; lineDeleted: boolean }>(
    `/nuxt-api/admin/line-richmenus/${id}`,
  );

/** 上傳圖片（multipart；server 端嚴格驗 2500×1686 或 2500×843、PNG/JPEG、≤ 1MB） */
export const UploadLineRichmenuImage = (id: string, file: File) =>
  methods.formData<UploadRichmenuImageRes>(
    `/nuxt-api/admin/line-richmenus/${id}/upload-image`,
    { file },
  );

/**
 * P44b-FU：上傳圖層合成器用的自訂圖片（image layer 用，不驗尺寸；PNG / JPEG / WebP ≤ 2 MB）
 * 與成品 menu 圖（UploadLineRichmenuImage）區隔；layer 圖會被 canvas 縮放，不限寬高。
 */
export interface UploadLineRichmenuLayerImageRes {
  url: string;
  objectPath: string;
  sizeBytes: number;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}
export const UploadLineRichmenuLayerImage = (id: string, file: File) =>
  methods.formData<UploadLineRichmenuLayerImageRes>(
    `/nuxt-api/admin/line-richmenus/${id}/upload-layer-image`,
    { file },
  );

/** Publish 為 channel default（複合：archive 舊 active + LINE create+upload+setDefault） */
export const PublishLineRichmenu = (id: string) =>
  methods.post<PublishRichmenuRes>(
    `/nuxt-api/admin/line-richmenus/${id}/publish`,
    {},
  );

/** 取消預設（並 archive 本 menu） */
export const UnpublishLineRichmenu = (id: string) =>
  methods.post<{ id: string; status: 'archived'; lineCleared: boolean; syncError: string | null }>(
    `/nuxt-api/admin/line-richmenus/${id}/unpublish`,
    {},
  );

/** 詢問 LINE 端狀態 + 對比本地 doc */
export const SyncLineRichmenuStatus = (id: string) =>
  methods.post<SyncStatusRes>(
    `/nuxt-api/admin/line-richmenus/${id}/sync-status`,
    {},
  );

/** 把 richmenu 綁定到特定 LINE user（admin 測試用） */
export const TestBindLineRichmenu = (id: string, lineUid: string) =>
  methods.post<{ id: string; lineRichMenuId: string; boundTo: string }>(
    `/nuxt-api/admin/line-richmenus/${id}/test-bind`,
    { lineUid },
  );

// ── P40 Phase 3：Diagnostics MVP ─────────────────────────

/** Diagnostics 總覽：本地 line_richmenus + LINE listRichmenus / default 一致性比對 */
export const GetRichmenuSyncOverview = (channel: LineClient) =>
  methods.get<SyncOverviewRes>(
    '/nuxt-api/admin/line-richmenus/sync-overview',
    { channel },
  );

/** 清理 LINE 端孤兒 richmenu（本地無對應 doc） */
export const CleanupOrphanRichmenu = (body: CleanupOrphanBody) =>
  methods.post<{ channel: LineClient; lineRichMenuId: string; deleted: boolean }>(
    '/nuxt-api/admin/line-richmenus/cleanup-orphan',
    body as unknown as Record<string, unknown>,
  );
