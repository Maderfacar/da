/**
 * Flex / Text Template Registry（P38 → 2026-05-23 line-template-expansion W2）
 *
 * 本檔同時負責：
 *   - server 寫死的 registry meta（admin UI 顯示 / placeholder hint / 預設內容）
 *   - 從 Firestore `notification_templates/{key}` 讀使用者編輯內容（loadTemplate）
 *   - 通用 Flex / Text Bubble builder（buildTemplate*）
 *
 * W2 schema 擴充（line-template-expansion）：
 *   - 加 dispatch / softmatch / driver-notify 三個 category
 *   - 加 outputType（flex / text）/ audience / i18nMode / triggerType / triggerEvent / requiresSuperLevel
 *   - 拔除 fallbackI18nKey（i18n-message.ts 走向 deprecate；W4 全部觸發點遷移完才 delete）
 *   - 文件 schema 從 root-level title/body 改 nested content.{lang}.{title|body|...}；
 *     loadTemplate 同時容錯舊 root-level 格式（避免 W2 推 prod 後既有資料失效）
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { LineMessage } from '@@/utils/line-push';

// ── Types ─────────────────────────────────────────────────────────

export type TemplateCategory =
  | 'order'
  | 'announcement'
  | 'bot'
  | 'broadcast'
  | 'dispatch'        // F1 / F3 / F4 派發 / 配對
  | 'softmatch'       // F5 / F6 軟性配對
  | 'driver-notify'   // T3-T9 司機通知
  | 'penalty';        // A2 醜點系統（warning / suspended）

export type TemplateOutputType = 'flex' | 'text';
export type TemplateAudience = 'passenger' | 'driver' | 'admin' | 'both';
export type TemplateI18nMode = 'multi' | 'single';
export type TemplateTriggerType = 'auto' | 'manual';
export type TemplateLang = 'zh_tw' | 'en' | 'ja';

const VALID_LANGS: readonly TemplateLang[] = ['zh_tw', 'en', 'ja'] as const;

export const isValidLang = (v: unknown): v is TemplateLang =>
  typeof v === 'string' && (VALID_LANGS as readonly string[]).includes(v);

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

/** Flex 模板內容（title + body + 可選封面圖 + 可選 CTA 按鈕） */
export interface TemplateContentFlex {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: TemplateCtaButton | null;
}

/** Text 模板內容（純文字 LINE message） */
export interface TemplateContentText {
  body: string;
}

/** Union：實際型別視 TemplateMeta.outputType 而定 */
export type TemplateContent = TemplateContentFlex | TemplateContentText;

export interface TemplateMeta {
  templateKey: string;
  category: TemplateCategory;
  displayName: string;
  description: string;
  /** 觸發事件描述（admin UI hint，如「乘客成功建單瞬間」） */
  triggerEvent: string;
  outputType: TemplateOutputType;
  audience: TemplateAudience;
  i18nMode: TemplateI18nMode;
  triggerType: TemplateTriggerType;
  /** dispatch / driver-notify 類限 super only；order / softmatch / bot 類 admin+ 可改 */
  requiresSuperLevel: boolean;
  placeholders: PlaceholderDef[];
  /** 結構視 outputType 而定（flex → TemplateContentFlex；text → TemplateContentText） */
  defaultContent: TemplateContent;
}

// ── Registry（5 個 order + W3 加 12 個：3 dispatch / 2 softmatch / 7 driver-notify） ─

export const TEMPLATE_REGISTRY: Record<string, TemplateMeta> = {
  'order.pending': {
    templateKey: 'order.pending',
    category: 'order',
    displayName: '訂單建立通知',
    description: '乘客建單成功瞬間推播。最高頻 push，行銷觸達關鍵點。',
    triggerEvent: '乘客成功建單瞬間（passenger order created）',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: true },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: true },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'vehicle', label: '車型分類（乘客建單時自選）', example: '豪華 MPV', required: true },
      { key: 'fare', label: '預估車資', example: '1,800', required: true },
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      // 2026-06-08：擴 placeholder（全部由 buildOrderParams 注入；空值由 _applyPlaceholders 渲染為空白）
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'pickupAddress', label: '上車點（dispatch 系列 alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoffAddress', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'estimatedFare', label: '預估車資（alias）', example: '1,800', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'passengerCount', label: '總人數', example: '3', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
    ],
    defaultContent: {
      title: '📝 訂單已建立',
      body: '您的訂單已送出，正在媒合司機。\n\n📅 {date}\n📍 {pickup}\n🛑 {stopovers}\n🏁 {dropoff}\n🚗 {vehicle}\n💰 NT$ {fare}\n🔖 {orderId}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.confirmed': {
    templateKey: 'order.confirmed',
    category: 'order',
    displayName: '司機接單通知',
    description: 'driver 自行接單瞬間推播（admin 指派時改用「通知乘客」按鈕手動推）。',
    triggerEvent: '訂單狀態切 confirmed 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'driverName', label: '司機姓名', example: '王先生', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
      { key: 'vehicleModel', label: '車輛品牌與型號（司機註冊時填寫）', example: 'Tesla Model S', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      // 2026-06-08：擴 placeholder
      { key: 'driverPhone', label: '司機電話（隱私敏感，admin 自行決定是否顯示）', example: '0987654321', required: false },
      { key: 'driverDisplayName', label: '司機 LINE 顯示名', example: 'David', required: false },
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'pickupAddress', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoffAddress', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'estimatedFare', label: '預估車資（alias）', example: '1,800', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'passengerCount', label: '總人數', example: '3', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
    ],
    defaultContent: {
      title: '✅ 司機已接單',
      body: '司機 {driverName} 已接受您的訂單 {orderId}，準備前往接您。\n🚘 {vehicleModel}\n🔖 車牌：{vehiclePlate}\n📍 {pickup}\n🛑 {stopovers}\n🏁 {dropoff}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.en_route': {
    templateKey: 'order.en_route',
    category: 'order',
    displayName: '司機到點通知',
    description: 'driver 按「已到達上車點」按鈕（通知乘客）時推播；司機可選擇「僅紀錄」不推播。',
    triggerEvent: '訂單狀態切 arrived_pickup 時推給乘客（司機可選擇是否通知）',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'driverName', label: '司機姓名', example: '王先生', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
      { key: 'vehicleModel', label: '車輛品牌與型號（司機註冊時填寫）', example: 'Tesla Model S', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      // 2026-06-08：擴 placeholder
      { key: 'driverPhone', label: '司機電話（隱私敏感，admin 自行決定是否顯示）', example: '0987654321', required: false },
      { key: 'driverDisplayName', label: '司機 LINE 顯示名', example: 'David', required: false },
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'pickupAddress', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoffAddress', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
    ],
    defaultContent: {
      title: '📍 司機已到達上車點',
      body: '司機 {driverName} 已抵達上車點，請至約定地點上車。\n🚘 {vehicleModel}\n🔖 車牌：{vehiclePlate}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.completed': {
    templateKey: 'order.completed',
    category: 'order',
    displayName: '行程完成通知',
    description: 'driver 切 completed 時推播；行銷觸達點（再次預訂 CTA）。',
    triggerEvent: '訂單狀態切 completed 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'fare', label: '車資', example: '1,800', required: false },
      // 2026-06-08：擴 placeholder
      { key: 'driverName', label: '司機姓名', example: '王先生', required: false },
      { key: 'driverPhone', label: '司機電話（隱私敏感）', example: '0987654321', required: false },
      { key: 'driverDisplayName', label: '司機 LINE 顯示名', example: 'David', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
      { key: 'vehicleModel', label: '車輛品牌/型號', example: 'Tesla Model S', required: false },
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接）', example: '台北 101', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
    ],
    defaultContent: {
      title: '🎉 行程已完成',
      body: '感謝您搭乘 Destination Anywhere！\n本次車資：NT$ {fare}\n訂單編號：{orderId}\n\n期待再次為您服務。',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.cancelled': {
    templateKey: 'order.cancelled',
    category: 'order',
    displayName: '訂單取消通知',
    description: 'admin / driver 切 cancelled 時推播；含取消原因（如有）。',
    triggerEvent: '訂單狀態切 cancelled 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'cancelReason', label: '取消原因', example: '司機無法配合時段', required: false },
      // 2026-06-08：擴 placeholder
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接）', example: '台北 101', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'driverName', label: '司機姓名（如已指派）', example: '王先生', required: false },
      { key: 'driverPhone', label: '司機電話（隱私敏感）', example: '0987654321', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
      { key: 'vehicleModel', label: '車輛品牌/型號', example: 'Tesla Model S', required: false },
    ],
    defaultContent: {
      title: '⚠️ 訂單已取消',
      body: '您的訂單 {orderId} 已取消。\n原因：{cancelReason}\n\n如需協助請聯絡客服。',
      coverImageUrl: null,
      ctaButton: null,
    },
  },

  // ── Dispatch Flex（3 個；driver/passenger；F1/F4 繁中、F3 三語）─────────
  'dispatch.driver-pending': {
    templateKey: 'dispatch.driver-pending',
    category: 'dispatch',
    displayName: '訂單派發給司機',
    description: 'F1 訂單建單後 dispatch 給所有 active driver；hybrid：「我要接單」按鈕鎖死、人數/車資 formatter 鎖死。',
    triggerEvent: '訂單建單 dispatch 時推給所有 active driver',
    outputType: 'flex',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'date', label: '搭乘時間', example: '05/15 14:30', required: true },
      { key: 'pickupAddress', label: '上車點', example: '桃園機場第一航廈', required: true },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoffAddress', label: '下車點', example: '台北車站', required: true },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: true },
      { key: 'estimatedFare', label: '預估車資', example: '1,800', required: true },
      // 2026-06-08 Phase 2：擴 placeholder（admin 可在 title / ctaLabel 編輯處選用；body 仍走 hardcoded）
      { key: 'pickup', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'fare', label: '車資（alias）', example: '1,800', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'passengerCount', label: '總人數', example: '3', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
      { key: 'contactName', label: '聯絡人姓名（隱私敏感）', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話（隱私敏感）', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名（隱私敏感）', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
      { key: 'driverPhone', label: '司機電話（首發無中選司機，通常空白）', example: '', required: false },
      { key: 'driverDisplayName', label: '司機顯示名（首發無中選司機，通常空白）', example: '', required: false },
    ],
    defaultContent: {
      title: '📦 新訂單派發',
      body: '🔖 #{orderId}\n📅 {date}\n📍 {pickupAddress}\n🛑 {stopovers}\n🏁 {dropoffAddress}\n👥 {paxSummary}  💰 NT$ {estimatedFare}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'dispatch.driver-selected': {
    templateKey: 'dispatch.driver-selected',
    category: 'dispatch',
    displayName: '司機中選通知',
    description: 'F4 admin 指派 / 司機自動中選後推給該司機。',
    triggerEvent: '司機被指派或自動中選時推給該司機',
    outputType: 'flex',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'date', label: '搭乘時間', example: '05/15 14:30', required: true },
      { key: 'pickupAddress', label: '上車點', example: '桃園機場第一航廈', required: true },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoffAddress', label: '下車點', example: '台北車站', required: true },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: true },
      // 2026-06-08 Phase 2：擴 placeholder（admin 可在 title / ctaLabel 編輯處選用；body 仍走 hardcoded）
      { key: 'pickup', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'estimatedFare', label: '預估車資', example: '1,800', required: false },
      { key: 'fare', label: '車資（alias）', example: '1,800', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'passengerCount', label: '總人數', example: '3', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
      { key: 'contactName', label: '聯絡人姓名（隱私敏感）', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話（隱私敏感）', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名（隱私敏感）', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
      { key: 'driverPhone', label: '司機電話（中選司機本人，通常 admin 不需顯示）', example: '0987654321', required: false },
      { key: 'driverDisplayName', label: '司機 LINE 顯示名', example: 'David', required: false },
    ],
    defaultContent: {
      title: '✅ 您已中選',
      body: '🔖 #{orderId}\n📅 {date}\n📍 {pickupAddress}\n🛑 {stopovers}\n🏁 {dropoffAddress}\n👥 {paxSummary}\n\n請於上車時間前準時抵達。',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'dispatch.passenger-matched': {
    templateKey: 'dispatch.passenger-matched',
    category: 'dispatch',
    displayName: '配對成功通知乘客',
    description: 'F3 hard match 後推給乘客（內含車輛資訊 + CTA「查看車輛資訊」）。',
    triggerEvent: '訂單 hard-match 成功瞬間推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'date', label: '上車時間', example: '05/15 14:30', required: true },
      { key: 'pickupAddress', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoffAddress', label: '下車點', example: '台北車站', required: false },
      { key: 'driverName', label: '司機顯示名', example: '王先生', required: true },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
      { key: 'vehicleModel', label: '車輛品牌與型號（司機註冊時填寫）', example: 'Tesla Model S', required: false },
      { key: 'fare', label: '車資', example: '1,800', required: false },
      // 2026-06-08 Phase 2：擴 placeholder
      { key: 'driverPhone', label: '司機電話（隱私敏感）', example: '0987654321', required: false },
      { key: 'driverDisplayName', label: '司機 LINE 顯示名（alias）', example: 'David', required: false },
      { key: 'pickup', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'estimatedFare', label: '預估車資（alias）', example: '1,800', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'passengerCount', label: '總人數', example: '3', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話（隱私敏感）', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
    ],
    defaultContent: {
      title: '🎉 配對成功',
      body: '您的訂單已配對司機\n🔖 #{orderId}\n🚗 {driverName}\n🚘 {vehicleModel}\n📅 上車時間：{date}\n📍 {pickupAddress}\n🛑 {stopovers}\n🏁 {dropoffAddress}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'dispatch.level-down': {
    templateKey: 'dispatch.level-down',
    category: 'dispatch',
    displayName: '分級派單降級通知',
    description: 'Wave 2D 訂單降級（auto-downgrade / manual-downgrade / force-open-all）後推給新加入等級的 driver；hybrid：title/ctaButton 可編、人數/車資 formatter + CTA URI 鎖死。',
    triggerEvent: '訂單 dispatchVisibility.currentLevel 下降時推給該級以上 driver',
    outputType: 'flex',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'orderType', label: '訂單類型', example: '機場接送', required: true },
      { key: 'date', label: '搭乘時間', example: '05/15 14:30', required: true },
      { key: 'pickupAddress', label: '上車點', example: '桃園機場第一航廈', required: true },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoffAddress', label: '下車點', example: '台北車站', required: true },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: true },
      { key: 'estimatedFare', label: '預估車資', example: '1,800', required: true },
      { key: 'newLevel', label: '新開放等級（0/1/2）', example: '1', required: true },
      // 2026-06-08 Phase 2：擴 placeholder
      { key: 'pickup', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'fare', label: '車資（alias）', example: '1,800', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'passengerCount', label: '總人數', example: '3', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
      { key: 'contactName', label: '聯絡人姓名（隱私敏感）', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話（隱私敏感）', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名（隱私敏感）', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
      { key: 'driverPhone', label: '司機電話（降級時無中選司機，通常空白）', example: '', required: false },
      { key: 'driverDisplayName', label: '司機顯示名（降級時無中選司機，通常空白）', example: '', required: false },
    ],
    defaultContent: {
      title: '📢 新需求單已開放給您',
      body: '🔖 #{orderId}\n🚕 {orderType}\n📅 {date}\n📍 {pickupAddress}\n🛑 {stopovers}\n🏁 {dropoffAddress}\n👥 {paxSummary}  💰 NT$ {estimatedFare}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },

  // ── Softmatch Flex（2 個；passenger 三語）────────────────────────────────
  'softmatch.passenger-choose': {
    templateKey: 'softmatch.passenger-choose',
    category: 'softmatch',
    displayName: '軟性配對選擇',
    description: 'F5 部分符合的 driver 配給 passenger 時推播；hybrid：✓/✗ list + 3 個 postback 按鈕 action 鎖死，title/subtitle/header/btn label 可編。',
    triggerEvent: 'softmatch 演算法選出部分符合 driver 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'date', label: '上車時間', example: '05/15 14:30', required: true },
      { key: 'driverName', label: '司機姓名', example: '王先生', required: true },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
      { key: 'vehicleModel', label: '車輛品牌與型號（司機註冊時填寫）', example: 'Tesla Model S', required: false },
      { key: 'pickupAddress', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接，多站時使用）', example: '台北 101、九份老街', required: false },
      { key: 'dropoffAddress', label: '下車點', example: '台北車站', required: false },
      { key: 'matchCount', label: '符合項數', example: '2', required: true },
      { key: 'preferenceCount', label: '偏好總數', example: '3', required: true },
      { key: 'completedOrders', label: '完成趟數', example: '128', required: false },
      { key: 'matchedList', label: '符合偏好清單', example: '不抽菸、寵物友善', required: false },
      { key: 'unmatchedList', label: '未符合清單', example: '黑色車輛', required: false },
      // 2026-06-08 Phase 2：擴 placeholder
      { key: 'pickup', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'estimatedFare', label: '預估車資（alias）', example: '1,800', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'passengerCount', label: '總人數', example: '3', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話（隱私敏感）', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
      { key: 'driverPhone', label: '司機電話（隱私敏感）', example: '0987654321', required: false },
      { key: 'driverDisplayName', label: '司機 LINE 顯示名', example: 'David', required: false },
    ],
    defaultContent: {
      title: '⚠️ 配對部分符合',
      body: '您勾選的 {preferenceCount} 項偏好中，{matchCount} 項符合\n\n🔖 #{orderId}\n🚗 司機：{driverName}\n📅 上車時間：{date}\n✓ 完成 {completedOrders} 趟\n\n✓ 符合偏好\n{matchedList}\n\n✗ 未符合\n{unmatchedList}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'softmatch.passenger-rematching': {
    templateKey: 'softmatch.passenger-rematching',
    category: 'softmatch',
    displayName: '重新配對通知',
    description: 'F6 原 driver 被撤回 / 乘客選等下一輪後，passenger 收重新配對通知。',
    triggerEvent: '訂單重新進入配對佇列時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'date', label: '上車時間', example: '05/15 14:30', required: true },
      // 2026-06-08 Phase 2：擴 placeholder
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'pickupAddress', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'dropoffAddress', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接）', example: '台北 101', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'estimatedFare', label: '預估車資（alias）', example: '1,800', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
    ],
    defaultContent: {
      title: '🔄 正在重新為您配對',
      body: '🔖 #{orderId}\n原車輛已撤回，正在尋找其他符合的司機\n📅 {date}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },

  // ── Driver Notify Text（7 個；driver 繁中）──────────────────────────────
  'driver.order-cancelled-assigned': {
    templateKey: 'driver.order-cancelled-assigned',
    category: 'driver-notify',
    displayName: '訂單取消通知司機',
    description: 'T3 admin / passenger 取消已指派司機的訂單後通知該司機。',
    triggerEvent: '訂單狀態切 cancelled 時推給指派司機',
    outputType: 'text',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'cancelReason', label: '取消原因（含換行；無原因傳空字串）', example: '原因：司機無法配合時段\n', required: false },
      // 2026-06-08：擴 placeholder（司機可看到取消的是哪筆訂單詳情）
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接）', example: '台北 101', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'adultCount', label: '大人人數', example: '2', required: false },
      { key: 'childCount', label: '兒童人數', example: '1', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'notes', label: '訂單備註', example: '需嬰兒座椅', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
    ],
    defaultContent: {
      body: '⚠️ 訂單已取消\n訂單 #{orderId} 已被取消。\n{cancelReason}如有疑問請聯絡客服。',
    },
  },
  'driver.order-cancelled-bidders': {
    templateKey: 'driver.order-cancelled-bidders',
    category: 'driver-notify',
    displayName: '訂單取消通知喊單司機',
    description: 'T4 已派發但未指派的訂單被取消後，通知所有 active bidder 司機。',
    triggerEvent: '訂單在已派發/未指派狀態下被取消時推給所有喊單司機',
    outputType: 'text',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      // 2026-06-08 Phase 2：擴 placeholder（讓 admin 可在文字模板顯示更多訂單細節）
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'pickupAddress', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'dropoffAddress', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接）', example: '台北 101', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'estimatedFare', label: '預估車資（alias）', example: '1,800', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
    ],
    defaultContent: {
      body: '⚠️ 訂單已取消\n訂單 #{orderId} 已取消，您的喊單已自動撤回。',
    },
  },
  'driver.order-completed-earnings': {
    templateKey: 'driver.order-completed-earnings',
    category: 'driver-notify',
    displayName: '訂單完成收入入帳通知',
    description: 'T5 訂單狀態切 completed 時通知中選司機（含本次收入金額）。',
    triggerEvent: '訂單狀態切 completed 時推給中選司機',
    outputType: 'text',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: true },
      // 2026-06-08：擴 placeholder（司機可回顧本趟乘客 / 路線）
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接）', example: '台北 101', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'contactName', label: '聯絡人姓名', example: '王小明', required: false },
      { key: 'contactPhone', label: '聯絡電話', example: '0912345678', required: false },
      { key: 'passengerName', label: '乘車人姓名', example: '王太太', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
      { key: 'flightNumber', label: '航班號', example: 'BR226', required: false },
      { key: 'terminal', label: '航廈', example: '1', required: false },
      { key: 'luggageDescription', label: '行李摘要', example: '大 1 件 / 小 2 件', required: false },
    ],
    defaultContent: {
      body: '✅ 訂單已完成\n訂單 #{orderId} 已完成。\n收入 NT$ {fare} 已計入今日統計。\n辛苦了！',
    },
  },
  'driver.softmatch-rejected': {
    templateKey: 'driver.softmatch-rejected',
    category: 'driver-notify',
    displayName: '軟配未中選通知',
    description: 'T6 原中選 driver 被乘客 reject（選等下一輪 / 取消）後通知該司機。',
    triggerEvent: '原中選司機被乘客撤回後推給該司機',
    outputType: 'text',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      // 2026-06-08 Phase 2：擴 placeholder（讓司機看到撤回的是哪筆訂單細節）
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: false },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: false },
      { key: 'pickupAddress', label: '上車點（alias）', example: '桃園機場第一航廈', required: false },
      { key: 'dropoff', label: '下車點', example: '台北車站', required: false },
      { key: 'dropoffAddress', label: '下車點（alias）', example: '台北車站', required: false },
      { key: 'stopovers', label: '中途停靠站（換行串接）', example: '台北 101', required: false },
      { key: 'orderType', label: '訂單類型 slug', example: 'airport-pickup', required: false },
      { key: 'vehicle', label: '車型 slug', example: 'sedan-business', required: false },
      { key: 'fare', label: '車資（含千分位）', example: '1,800', required: false },
      { key: 'paxSummary', label: '人數摘要', example: '大人 2 / 兒童 1', required: false },
    ],
    defaultContent: {
      body: '🔁 訂單已重新分派\n訂單 #{orderId} 已重新進入配對佇列，本次未繼續由您接單，請查看接單看板有無其他機會。',
    },
  },
  'driver.application-submitted': {
    templateKey: 'driver.application-submitted',
    category: 'driver-notify',
    displayName: '司機申請已送出通知',
    description: 'T7 申請人完成 driver/apply 表單送出後通知申請人。',
    triggerEvent: '司機申請送出時推給申請人',
    outputType: 'text',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'applicantName', label: '申請人姓名', example: '王小明', required: false },
      // 2026-06-08 Phase 2：擴 placeholder（buildDriverParams 注入；申請人 driver 自己的聯絡資料）
      { key: 'driverPhone', label: '司機電話（申請表單填寫值）', example: '0987654321', required: false },
      { key: 'driverDisplayName', label: '司機 LINE 顯示名', example: 'David', required: false },
      { key: 'driverName', label: '司機姓名（buildDriverParams 提供）', example: '王小明', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
      { key: 'vehicleModel', label: '車輛品牌與型號', example: 'Tesla Model S', required: false },
    ],
    defaultContent: {
      body: '✅ 司機申請已送出\n{applicantName} 您好，您的申請已成功送出，我們將盡快審核您的證件資料。\n審核期間請耐心等候，結果將透過 LINE 通知您。',
    },
  },
  'driver.document-review': {
    templateKey: 'driver.document-review',
    category: 'driver-notify',
    displayName: '司機證件審核結果',
    description: 'T8 admin 對司機證件做出核准 / 駁回後通知司機（核准 / 駁回共用一個模板）。',
    triggerEvent: 'admin 完成司機證件審核時推給司機',
    outputType: 'text',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'result', label: '審核結果（通過/未通過）', example: '通過', required: true },
      { key: 'reason', label: '結果說明（核准：證件已生效；駁回：退回原因 + 重新上傳提示）', example: '新版證件已生效。', required: true },
    ],
    defaultContent: {
      body: '📋 證件審核結果：{result}\n{reason}',
    },
  },
  // ── Penalty Flex（2 個；passenger 三語；A2 醜點系統 Phase 1）──────────
  'penalty.warning': {
    templateKey: 'penalty.warning',
    category: 'penalty',
    displayName: '醜點最後警告通知',
    description: 'A2 乘客累計達 2 醜點時推播；下次再記點即達暫停門檻。',
    triggerEvent: '乘客累計醜點剛好達 2 點時自動推播',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'uglyCount', label: '當前醜點數', example: '2', required: false },
    ],
    defaultContent: {
      title: '⚠️ 服務使用提醒',
      body: '您已累計 {uglyCount} 次未準時取消或未到的紀錄。\n\n再記 1 次將暫停您的訂車服務。\n\n• 24 小時前取消：不記點\n• 24 小時內取消：記 1 點\n• 司機到場未出現：記 2 點\n• 6 個月內無新紀錄將自動歸零\n\n感謝您的理解與配合。',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'penalty.suspended': {
    templateKey: 'penalty.suspended',
    category: 'penalty',
    displayName: '服務暫停通知',
    description: 'A2 乘客累計達 3 醜點或被 admin 拉黑時推播。',
    triggerEvent: '乘客醜點達 3 點 / admin 手動拉黑時推播',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'reason', label: '暫停原因（admin 拉黑時可帶；累計到頂時為空）', example: '多次未準時取消', required: false },
    ],
    defaultContent: {
      title: '🚫 服務暫停通知',
      body: '您的訂車服務已暫停。\n{reason}\n\n如需恢復服務或了解詳情，請聯絡客服協助處理。',
      coverImageUrl: null,
      ctaButton: {
        label: '聯絡客服',
        action: { type: 'uri', url: 'https://line.me/R/ti/p/@986qtjwt' },
      },
    },
  },

  'driver.vehicle-profile-review': {
    templateKey: 'driver.vehicle-profile-review',
    category: 'driver-notify',
    displayName: '車型 Profile 審核結果',
    description: 'T9 admin 對司機車型 profile（標籤/照片）做出核准 / 駁回後通知司機。',
    triggerEvent: 'admin 完成車型 profile 審核時推給司機',
    outputType: 'text',
    audience: 'driver',
    i18nMode: 'single',
    triggerType: 'auto',
    requiresSuperLevel: true,
    placeholders: [
      { key: 'result', label: '審核結果（通過/未通過）', example: '通過', required: true },
      { key: 'reason', label: '結果說明（核准：已上線；駁回：退回原因 + 重新送審提示）', example: '您提交的標籤與照片已上線。', required: true },
    ],
    defaultContent: {
      body: '🚗 車輛 Profile 審核結果：{result}\n{reason}',
    },
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_REGISTRY);

export function getTemplateMeta(templateKey: string): TemplateMeta | null {
  return TEMPLATE_REGISTRY[templateKey] ?? null;
}

// ── Flex / Text Builder ─────────────────────────────────────────────

const MAX_ALT_TEXT = 400;
const MAX_LABEL = 20;
const FLEX_AMBER = '#D4860A';

/**
 * 把 `{placeholder}` 替換為 params[key]。
 *
 * 2026-06-08 修：區分「key 不存在」與「key 存在但空字串」：
 *   - key in params：用 params[key]（包含空字串）→ 缺資料的位置乾淨輸出空白
 *   - key 不在 params：保留 `{key}` 字樣 → admin 排錯（typo / 未開放的 placeholder）
 *
 * 動機：trigger site 改走 buildOrderDriverParams 後，會把所有可用 key 都帶上（缺值 ''），
 * 舊版「空字串也保留 {key}」會讓 user 訊息看到一堆 `{stopovers}`、`{notes}` 字樣。
 *
 * 2026-06-08 Phase 2：export 同名 `applyPlaceholders` 供 dispatch / softmatch hybrid
 * helper 對「title / ctaLabel」等 admin-editable 標籤做 placeholder 替換（hardcoded Flex
 * body 部份不參與替換）。內部 caller 繼續用 `_applyPlaceholders`，外部用 `applyPlaceholders`。
 */
const _applyPlaceholders = (text: string, params: Record<string, string>): string => {
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (key in params) return params[key] ?? '';
    return `{${key}}`;
  });
};

export const applyPlaceholders = _applyPlaceholders;

const _buildActionPayload = (action: TemplateAction, params: Record<string, string>): object | null => {
  if (action.type === 'uri') {
    const uri = _applyPlaceholders(action.url, params);
    if (!uri.startsWith('https://') && !uri.startsWith('line://')) return null;
    return { type: 'uri', uri };
  }
  if (action.type === 'message') {
    const text = _applyPlaceholders(action.text, params);
    if (!text || text.length === 0) return null;
    return { type: 'message', text };
  }
  // postback
  const data = _applyPlaceholders(action.data, params);
  if (!data || data.length === 0) return null;
  const out: Record<string, unknown> = { type: 'postback', data };
  if (action.displayText) out.displayText = _applyPlaceholders(action.displayText, params);
  return out;
};

/**
 * 套用 placeholder 並組 LINE Flex Bubble。
 *
 * @returns null 當 template 為 null 或缺 title/body（呼叫端 fallback i18n text）
 */
export function buildTemplateFlex(
  template: TemplateContentFlex | null,
  params: Record<string, string>,
): LineMessage | null {
  if (!template || !template.title || !template.body) return null;

  const title = _applyPlaceholders(template.title, params);
  const body = _applyPlaceholders(template.body, params);
  const altText = title.slice(0, MAX_ALT_TEXT);

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true, color: '#222222' },
        { type: 'text', text: body, wrap: true, size: 'sm', color: '#666666', margin: 'md' },
      ],
    },
  };

  if (template.coverImageUrl && template.coverImageUrl.startsWith('https://')) {
    bubble.hero = {
      type: 'image',
      url: template.coverImageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  if (template.ctaButton && template.ctaButton.label) {
    const actionPayload = _buildActionPayload(template.ctaButton.action, params);
    if (actionPayload) {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          action: { ...actionPayload, label: template.ctaButton.label.slice(0, MAX_LABEL) },
          style: 'primary',
          color: FLEX_AMBER,
        }],
      };
    }
  }

  return { type: 'flex', altText, contents: bubble };
}

/**
 * 套用 placeholder 組純文字 LINE message。
 *
 * @returns null 當 template 為 null / body 為空 / 套完 placeholder 後仍為空字串
 */
export function buildTemplateText(
  template: TemplateContentText | null,
  params: Record<string, string>,
): LineMessage | null {
  if (!template || !template.body) return null;
  const text = _applyPlaceholders(template.body, params);
  if (!text || text.length === 0) return null;
  return { type: 'text', text };
}

/**
 * 通用 build：依 outputType 分派到 Flex 或 Text builder。
 *
 * caller 在 W4 後將統一走此函式（trigger 點不再各自挑 builder）。
 */
export function buildTemplate(
  template: TemplateContent | null,
  params: Record<string, string>,
  outputType: TemplateOutputType,
): LineMessage | null {
  if (outputType === 'text') {
    return buildTemplateText((template as TemplateContentText | null) ?? null, params);
  }
  return buildTemplateFlex((template as TemplateContentFlex | null) ?? null, params);
}

// ── Loader ──────────────────────────────────────────────────────────

const NEW_COLLECTION = 'notification_templates';

/**
 * Doc 子物件（content.{lang} 或 root-level legacy）→ TemplateContent。
 * 視 outputType 而定，做最小欄位驗證；不符回 null。
 */
function _normalizeContent(
  data: Record<string, unknown>,
  outputType: TemplateOutputType,
): TemplateContent | null {
  if (outputType === 'text') {
    const body = typeof data.body === 'string' ? data.body : '';
    if (!body) return null;
    return { body };
  }

  // flex
  const title = typeof data.title === 'string' ? data.title : '';
  const body = typeof data.body === 'string' ? data.body : '';
  if (!title || !body) return null;

  const cta = data.ctaButton;
  let ctaButton: TemplateCtaButton | null = null;
  if (cta && typeof cta === 'object') {
    const c = cta as Record<string, unknown>;
    const label = typeof c.label === 'string' ? c.label : '';
    if (label) {
      const action = c.action as Record<string, unknown> | undefined;
      if (action && typeof action.type === 'string') {
        if (action.type === 'uri' && typeof action.url === 'string') {
          ctaButton = { label, action: { type: 'uri', url: action.url } };
        } else if (action.type === 'message' && typeof action.text === 'string') {
          ctaButton = { label, action: { type: 'message', text: action.text } };
        } else if (action.type === 'postback' && typeof action.data === 'string') {
          ctaButton = {
            label,
            action: {
              type: 'postback',
              data: action.data,
              ...(typeof action.displayText === 'string' ? { displayText: action.displayText } : {}),
            },
          };
        }
      } else if (typeof c.url === 'string') {
        // 更舊的 A1 schema：{ label, url }
        ctaButton = { label, action: { type: 'uri', url: c.url } };
      }
    }
  }

  return {
    title,
    body,
    coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
    ctaButton,
  };
}

/**
 * 讀 admin 編輯內容；缺值 / disabled / 找不到 → null（呼叫端 fallback 用 registry.defaultContent）。
 *
 * 新 schema：
 *   { templateKey, enabled, content: { zh_tw: {...}, en?: {...}, ja?: {...} }, ... }
 *
 * Legacy schema（pre-W2，root-level）：
 *   { templateKey, enabled, title, body, coverImageUrl, ctaButton }
 *   → loadTemplate 自動容錯，避免 W2 推 prod 後既有 admin 編輯內容失效。
 *
 * @param lang i18nMode='single' 時無視；i18nMode='multi' 時找不到指定 lang 退回 zh_tw。
 */
export async function loadTemplate(
  db: Firestore,
  templateKey: string,
  lang: TemplateLang = 'zh_tw',
): Promise<TemplateContent | null> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) return null;

  const effectiveLang: TemplateLang = meta.i18nMode === 'single' ? 'zh_tw' : lang;

  try {
    const snap = await db.collection(NEW_COLLECTION).doc(templateKey).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (data.enabled === false) return null;

    // 1) 新 schema：content.{lang}
    const contentMap = data.content as Record<string, unknown> | undefined;
    if (contentMap && typeof contentMap === 'object') {
      const langData = contentMap[effectiveLang];
      if (langData && typeof langData === 'object') {
        const c = _normalizeContent(langData as Record<string, unknown>, meta.outputType);
        if (c) return c;
      }
      // 多語模板找不到指定 lang → 退回 zh_tw
      if (meta.i18nMode === 'multi' && effectiveLang !== 'zh_tw') {
        const zh = contentMap.zh_tw;
        if (zh && typeof zh === 'object') {
          const c = _normalizeContent(zh as Record<string, unknown>, meta.outputType);
          if (c) return c;
        }
      }
    }

    // 2) Legacy root-level fallback（pre-W2 doc）
    return _normalizeContent(data, meta.outputType);
  } catch (err) {
    console.error(`[template-registry] loadTemplate(${templateKey}) failed:`, err);
    return null;
  }
}

/**
 * 寫入單一語系的 template content（upsert，merge=true）。
 *
 * 寫入結構：
 *   notification_templates/{key} = {
 *     templateKey, category, enabled,
 *     content: { [lang]: { title, body, coverImageUrl, ctaButton } },
 *     updatedBy, updatedAt,
 *   }
 */
export async function saveTemplate(
  db: Firestore,
  templateKey: string,
  data: TemplateContent & { enabled?: boolean },
  writerLineUid: string,
  lang: TemplateLang = 'zh_tw',
): Promise<void> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) throw new Error(`Unknown template key: ${templateKey}`);

  const { FieldValue } = await import('firebase-admin/firestore');

  // 視 outputType 組對應 sub-doc
  const subDoc: Record<string, unknown> = meta.outputType === 'text'
    ? { body: (data as TemplateContentText).body }
    : {
      title: (data as TemplateContentFlex).title,
      body: (data as TemplateContentFlex).body,
      coverImageUrl: (data as TemplateContentFlex).coverImageUrl,
      ctaButton: (data as TemplateContentFlex).ctaButton,
    };

  await db.collection(NEW_COLLECTION).doc(templateKey).set({
    templateKey,
    category: meta.category,
    enabled: data.enabled ?? true,
    content: { [lang]: subDoc },
    updatedBy: writerLineUid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * 一律拿到 TemplateContent — 優先 admin 編輯版（loadTemplate），缺值退回 registry.defaultContent。
 *
 * W4 後所有 push 觸發點走此 helper，省去各 caller 重複 `?? defaultContent` 寫法。
 * registry 不存在 key 時 throw（呼叫端傳錯 templateKey 是 dev bug，不應 silent fail）。
 */
export async function resolveTemplate(
  db: Firestore,
  templateKey: string,
  lang: TemplateLang = 'zh_tw',
): Promise<TemplateContent> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) throw new Error(`resolveTemplate: unknown template key ${templateKey}`);
  return (await loadTemplate(db, templateKey, lang)) ?? meta.defaultContent;
}

/**
 * 還原 template 到 registry.defaultContent（zh_tw）。
 *
 * 多語模板的 en/ja 不在此處清除（W6 多語 editor 上線後可由 admin 個別語系 reset）。
 */
export async function resetTemplate(db: Firestore, templateKey: string, writerLineUid: string): Promise<void> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) throw new Error(`Unknown template key: ${templateKey}`);
  await saveTemplate(db, templateKey, {
    ...(meta.defaultContent as TemplateContent),
    enabled: true,
  }, writerLineUid, 'zh_tw');
}
