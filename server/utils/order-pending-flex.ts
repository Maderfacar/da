/**
 * 訂單建立通知模板 Flex builder — A1 wrapper（P38 Phase 3 改寫）
 *
 * P38 Phase 3 起：本檔成為通用 template-registry 的 thin wrapper（向下相容）：
 *   - 既有 caller（orders/index.post.ts + A1 admin endpoints）簽名不動
 *   - 內部呼叫 `loadTemplate('order.pending')` + `buildTemplateFlex(...)`
 *   - 讀寫雙路徑：新 collection `notification_templates/order.pending` 優先；
 *     缺值 fallback 舊 A1 collection `admin_settings_notification_templates/order-pending`
 *   - ctaButton schema 轉換：A1 `{label, url}` → 新 `{label, action: {type:'uri', url}}`（自動）
 *
 * 未來（P41 cleanup）：本檔可刪，caller 直接走 template-registry。
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { LineMessage } from '@@/utils/line-push';
import { buildTemplateFlex, loadTemplate, type TemplateContent } from '@@/utils/template-registry';

// ── 對外型別維持向下相容（caller 不改） ────────────────────────────

export interface OrderPendingTemplate {
  title: string;
  body: string;
  coverImageUrl: string | null;
  /** A1 既有簽名（舊 schema）；P38 內部已轉新 schema，本介面保留只為 caller 相容 */
  ctaButton: { label: string; url: string } | null;
}

export interface OrderPendingParams {
  date: string;
  pickup: string;
  vehicle: string;
  fare: string;
  orderId: string;
}

/**
 * 套用 placeholder 並組 LINE Flex Bubble。
 *
 * @returns null 當 template 為 null 或缺 title/body（呼叫端 fallback 既有 i18n text）
 *
 * **P38 Phase 3 改寫**：caller 傳的 OrderPendingTemplate（舊 schema with `ctaButton.url`）
 * 內部轉成新 schema `{ ctaButton.action: { type: 'uri', url } }` 後丟給通用 builder。
 */
export function buildOrderPendingFlex(
  template: OrderPendingTemplate | null,
  params: OrderPendingParams,
): LineMessage | null {
  if (!template) return null;
  const normalized: TemplateContent = {
    title: template.title,
    body: template.body,
    coverImageUrl: template.coverImageUrl,
    ctaButton: template.ctaButton
      ? { label: template.ctaButton.label, action: { type: 'uri', url: template.ctaButton.url } }
      : null,
  };
  return buildTemplateFlex(normalized, params as unknown as Record<string, string>);
}

/**
 * 讀 order.pending template（雙路徑：新 collection → 舊 A1 collection fallback）。
 *
 * 回傳格式維持 A1 既有 schema（caller 不需改）；內部轉換在 template-registry.loadTemplate 處理。
 */
export async function loadOrderPendingTemplate(
  db: Firestore,
): Promise<OrderPendingTemplate | null> {
  const t = await loadTemplate(db, 'order.pending');
  if (!t) return null;
  // 新 schema → A1 舊 schema（caller 用）；非 uri action 視為無 cta（A1 caller 無法處理）
  let ctaButton: OrderPendingTemplate['ctaButton'] = null;
  if (t.ctaButton && t.ctaButton.action.type === 'uri') {
    ctaButton = { label: t.ctaButton.label, url: t.ctaButton.action.url };
  }
  return {
    title: t.title,
    body: t.body,
    coverImageUrl: t.coverImageUrl,
    ctaButton,
  };
}
