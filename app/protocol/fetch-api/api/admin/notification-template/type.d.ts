// P38 → 2026-05-23 line-template-expansion W2
// 對齊 server/utils/template-registry.ts TEMPLATE_REGISTRY + TemplateContent / TemplateAction
//
// W2 schema 擴：
//   - TemplateCategory 加 dispatch / softmatch / driver-notify
//   - TemplateMeta 加 outputType / audience / i18nMode / triggerType / triggerEvent / requiresSuperLevel
//   - TemplateContent 拆 Flex / Text union
//   - 拔除 fallbackI18nKey
//   - GET/PUT body 跟著拆語系

export type TemplateCategory =
  | 'order'
  | 'announcement'
  | 'bot'
  | 'broadcast'
  | 'dispatch'
  | 'softmatch'
  | 'driver-notify';

export type TemplateOutputType = 'flex' | 'text';
export type TemplateAudience = 'passenger' | 'driver' | 'admin' | 'both';
export type TemplateI18nMode = 'multi' | 'single';
export type TemplateTriggerType = 'auto' | 'manual';
export type TemplateLang = 'zh_tw' | 'en' | 'ja';

export interface PlaceholderDef {
  key: string;
  label: string;
  example: string;
  required: boolean;
}

export type TemplateAction =
  | { type: 'uri'; url: string }
  | { type: 'message'; text: string }
  | { type: 'postback'; data: string; displayText?: string };

export interface TemplateCtaButton {
  label: string;
  action: TemplateAction;
}

export interface TemplateContentFlex {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: TemplateCtaButton | null;
}

export interface TemplateContentText {
  body: string;
}

export type TemplateContent = TemplateContentFlex | TemplateContentText;

export interface TemplateMeta {
  templateKey: string;
  category: TemplateCategory;
  displayName: string;
  description: string;
  triggerEvent: string;
  outputType: TemplateOutputType;
  audience: TemplateAudience;
  i18nMode: TemplateI18nMode;
  triggerType: TemplateTriggerType;
  requiresSuperLevel: boolean;
  placeholders: PlaceholderDef[];
  defaultContent: TemplateContent;
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
  /** legacy 欄位（W2-W6 caller 用）；指向 contentByLang.zh_tw */
  content: TemplateContent | null;
  /** W7：i18nMode='multi' 三語 tab 用；各 lang 為 null 表 admin 未編輯該語 → fallback registry default */
  contentByLang: Record<TemplateLang, TemplateContent | null>;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

/**
 * PUT body 沿用 Flex 欄位（單語、繁中）；W6 多語 editor 上線後會擴 lang 欄位。
 * Text 模板（W4 之後出現）走 body-only；W6 前 PUT 仍以 Flex 欄位為主，server 端依
 * meta.outputType 判斷是否忽略 title / cover / cta。
 */
export interface PutNotificationTemplateBody {
  title?: string;
  body: string;
  coverImageUrl?: string | null;
  ctaButton?: TemplateCtaButton | null;
  enabled?: boolean;
  /** W6 多語 editor 用；不傳預設 zh_tw */
  lang?: TemplateLang;
}

export interface UploadTemplateCoverRes {
  url: string;
  objectPath: string;
  sizeBytes: number;
  mime: string;
}
