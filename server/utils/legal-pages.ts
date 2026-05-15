/**
 * Legal Pages（會員服務條款 / 隱私權政策）
 *
 * - collection `legal_pages/{key}`，key = 'terms' | 'privacy'（doc id 直接用 key）
 * - 內容 admin 可在 /admin/settings 編輯（TinyEditor 富文本 → bodyHtml）
 * - 乘客端公開讀取（無 auth），走 30s edge cache
 * - schema 第一版簡單版（單語、單版本）：未來如需多語走 lang 子 doc / 版本歷史走子 collection
 */
import type { Timestamp } from 'firebase-admin/firestore';

export type LegalPageKey = 'terms' | 'privacy';

export const LEGAL_PAGE_KEYS: readonly LegalPageKey[] = ['terms', 'privacy'] as const;

export const LEGAL_TITLE_MAX = 200;
/** 100 KB（粗估足夠 50,000+ 中文字 plain text，或含 inline CSS 的 TinyEditor HTML） */
export const LEGAL_BODY_HTML_MAX = 100_000;

// ── Firestore Doc ──────────────────────────────────────────────────

export interface LegalPageDoc {
  key: LegalPageKey;
  title: string;
  bodyHtml: string;
  updatedBy: string;
  updatedAt: Timestamp;
  /** 自動 +1 給 observability；無 rollback 機制 */
  version: number;
}

// ── DTO（API 回傳格式：Timestamp → ISO string） ─────────────────────

export interface LegalPageDto {
  key: LegalPageKey;
  title: string;
  bodyHtml: string;
  updatedBy: string;
  updatedAt: string | null;
  version: number;
}

function tsToIso(v: unknown): string | null {
  const t = (v as { toDate?: () => Date } | null)?.toDate?.();
  return t ? t.toISOString() : null;
}

export function toLegalPageDto(data: Partial<LegalPageDoc> & { key: LegalPageKey }): LegalPageDto {
  return {
    key: data.key,
    title: typeof data.title === 'string' ? data.title : '',
    bodyHtml: typeof data.bodyHtml === 'string' ? data.bodyHtml : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
    updatedAt: tsToIso(data.updatedAt),
    version: typeof data.version === 'number' ? data.version : 0,
  };
}

/** doc 不存在時的 placeholder（admin list view 用） */
export function placeholderLegalPageDto(key: LegalPageKey): LegalPageDto {
  return { key, title: '', bodyHtml: '', updatedBy: '', updatedAt: null, version: 0 };
}

// ── Validators ─────────────────────────────────────────────────────

const KEYS_SET = new Set<LegalPageKey>(LEGAL_PAGE_KEYS);

export function isLegalPageKey(raw: unknown): raw is LegalPageKey {
  return typeof raw === 'string' && KEYS_SET.has(raw as LegalPageKey);
}

export function validateLegalKey(raw: unknown): { ok: true; value: LegalPageKey } | { ok: false; error: string } {
  if (!isLegalPageKey(raw)) {
    return { ok: false, error: `key 必須為 ${LEGAL_PAGE_KEYS.join(' / ')}` };
  }
  return { ok: true, value: raw };
}

export function validateTitle(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'title 缺失' };
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > LEGAL_TITLE_MAX) {
    return { ok: false, error: `title 必須為 1-${LEGAL_TITLE_MAX} 字` };
  }
  return { ok: true, value: trimmed };
}

export function validateBodyHtml(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'bodyHtml 缺失' };
  if (raw.length > LEGAL_BODY_HTML_MAX) {
    return { ok: false, error: `bodyHtml 不可超過 ${LEGAL_BODY_HTML_MAX} 字元（約 100 KB）` };
  }
  return { ok: true, value: raw };
}
