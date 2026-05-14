// P38 Phase 4：admin notification template type 定義
// 對齊 server/utils/template-registry.ts TEMPLATE_REGISTRY + TemplateContent / TemplateAction

export type TemplateCategory = 'order' | 'announcement' | 'bot' | 'broadcast';

export interface PlaceholderDef {
  key: string;
  label: string;
  example: string;
  required: boolean;
}

export interface TemplateMeta {
  templateKey: string;
  category: TemplateCategory;
  displayName: string;
  description: string;
  placeholders: PlaceholderDef[];
  defaultContent: {
    title: string;
    body: string;
  };
  fallbackI18nKey?: string;
}

export type TemplateAction =
  | { type: 'uri'; url: string }
  | { type: 'message'; text: string }
  | { type: 'postback'; data: string; displayText?: string };

export interface TemplateCtaButton {
  label: string;
  action: TemplateAction;
}

export interface TemplateContent {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: TemplateCtaButton | null;
}

export interface NotificationTemplateItem {
  meta: TemplateMeta;
  content: TemplateContent | null;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

export interface NotificationTemplateListRes {
  items: NotificationTemplateItem[];
}

export interface NotificationTemplateDetailRes {
  meta: TemplateMeta;
  content: TemplateContent | null;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

export interface PutNotificationTemplateBody {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: TemplateCtaButton | null;
  enabled?: boolean;
}

export interface UploadTemplateCoverRes {
  url: string;
  objectPath: string;
  sizeBytes: number;
  mime: string;
}
