/**
 * TinyMCE 8 集中式配置
 *
 * 未來升級時：
 * - 新增/移除 plugin → 調整 tinymcePlugins
 * - 調整工具列 → 調整 tinymceToolbar
 * - TinyMCE 主版本變更（資源路徑/suffix）→ 調整 tinymceBaseUrl / tinymceSuffix
 */

/** TinyMCE 靜態資源的 public 路徑（對應 public/tinymce/） */
export const tinymceBaseUrl = '/tinymce';

/** TinyMCE 資源檔名 suffix */
export const tinymceSuffix = '.min';

/** TinyMCE 核心 script 檔案完整路徑 */
export const tinymceScriptSrc = `${tinymceBaseUrl}/tinymce.min.js`;

/** 啟用的 plugins */
export const tinymcePlugins = 'lists link image media code autolink advlist';

/** 工具列配置（依需求分組） */
export const tinymceToolbar = [
  'undo redo',
  'fontfamily fontsize',
  'forecolor backcolor',
  'bold italic underline strikethrough',
  'alignleft aligncenter alignright alignjustify',
  'bullist numlist',
  'outdent indent',
  'link image media',
  'removeformat',
  'code'
].join(' | ');

/** 預設 init 配置 */
export const tinymceDefaultInit = {
  license_key: 'gpl' as const,
  base_url: tinymceBaseUrl,
  suffix: tinymceSuffix,
  language: 'zh-TW',
  language_url: `${tinymceBaseUrl}/langs/zh-TW.js`,
  plugins: tinymcePlugins,
  toolbar: tinymceToolbar,
  toolbar_mode: 'wrap' as const,
  menubar: false,
  height: 500,
  branding: false,
  promotion: false,
  content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif; font-size: 14px; line-height: 1.6; color: #303133; }',
  font_family_formats: [
    'System=-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'Serif=Georgia, serif',
    'Monospace=Menlo, Consolas, monospace',
    'Arial=Arial, sans-serif',
    '微軟正黑體=Microsoft JhengHei, sans-serif',
    '新細明體=PMingLiU, serif'
  ].join(';'),
  font_size_formats: '12px 14px 16px 18px 20px 24px 28px 32px 36px 48px',
  image_advtab: true,
  automatic_uploads: true,
  file_picker_types: 'image',
  // media plugin：允許嵌入 YouTube / Vimeo 等影片
  media_live_embeds: true,
  media_alt_source: false,
  media_poster: false,
  media_dimensions: true
};

/** 圖片上傳 API 端點路徑 */
export const tinymceUploadUrl = '/nuxt-api/tinymce/upload';
