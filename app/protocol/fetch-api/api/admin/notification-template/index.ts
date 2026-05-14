// P38 Phase 4：admin notification template API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  NotificationTemplateDetailRes,
  NotificationTemplateListRes,
  PutNotificationTemplateBody,
  UploadTemplateCoverRes,
} from './type.d';

export type {
  NotificationTemplateDetailRes,
  NotificationTemplateItem,
  NotificationTemplateListRes,
  PlaceholderDef,
  PutNotificationTemplateBody,
  TemplateAction,
  TemplateCategory,
  TemplateContent,
  TemplateCtaButton,
  TemplateMeta,
  UploadTemplateCoverRes,
} from './type.d';

/** 列出所有 registry template（merge Firestore doc 內容） */
export const GetNotificationTemplates = () =>
  methods.get<NotificationTemplateListRes>('/nuxt-api/admin/notification-templates');

/** 取單一 template 詳情 */
export const GetNotificationTemplate = (key: string) =>
  methods.get<NotificationTemplateDetailRes>(`/nuxt-api/admin/notification-templates/${encodeURIComponent(key)}`);

/** Upsert template content（order.pending 會 dual-write 舊 A1 collection） */
export const PutNotificationTemplate = (key: string, body: PutNotificationTemplateBody) =>
  methods.put<{ ok: boolean }>(
    `/nuxt-api/admin/notification-templates/${encodeURIComponent(key)}`,
    body as unknown as Record<string, unknown>,
  );

/** 還原 registry default（清 cover/cta，title/body 填預設） */
export const ResetNotificationTemplate = (key: string) =>
  methods.post<{ ok: boolean }>(
    `/nuxt-api/admin/notification-templates/${encodeURIComponent(key)}/reset`,
    {},
  );

/** 上傳 template 封面圖（multipart） */
export const UploadNotificationTemplateCover = (key: string, file: File) =>
  methods.formData<UploadTemplateCoverRes>(
    `/nuxt-api/admin/notification-templates/${encodeURIComponent(key)}/upload-cover`,
    { file },
  );
