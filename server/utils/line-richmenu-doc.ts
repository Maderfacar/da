/**
 * LINE Richmenu Firestore Doc — schema、validators、DTO serializer（P38 Phase 1）
 *
 * 對應 design.md §2.1 `line_richmenus/{id}` schema：
 *   - status：draft / active / archived（同 channel 同時最多 1 個 active）
 *   - lineRichMenuId：LINE 端 id（建立後寫回）
 *   - syncStatus：not_synced / syncing / synced / sync_failed
 *
 * 用於：
 *   - server endpoint validate body
 *   - server-side doc 序列化（Timestamp → ISO string）
 *   - 共用型別 import 給多個 endpoint
 */
import type { Timestamp } from 'firebase-admin/firestore';
import type {
  RichmenuArea,
  RichmenuAction,
  RichmenuSize,
} from '@@/utils/line-richmenu';
import type { LineClient } from '@@/utils/line-channel';

// ── Constants ──────────────────────────────────────────────────────

export const RICHMENU_NAME_MAX = 100;
export const CHAT_BAR_TEXT_MAX = 14;
export const AREAS_MAX = 20;
export const URI_MAX = 1000;
export const MESSAGE_TEXT_MAX = 300;
export const POSTBACK_DATA_MAX = 300;
export const ACTION_LABEL_MAX = 20;

export const VALID_SIZES: RichmenuSize[] = [
  { width: 2500, height: 1686 },
  { width: 2500, height: 843 },
];

export type RichmenuStatus = 'draft' | 'active' | 'archived';
export type SyncStatus = 'not_synced' | 'syncing' | 'synced' | 'sync_failed';

// ── Firestore Doc ──────────────────────────────────────────────────

export interface LineRichmenuDoc {
  channel: LineClient;
  status: RichmenuStatus;
  name: string;

  // LINE sync
  lineRichMenuId: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: Timestamp | null;

  // Image
  imageUrl: string | null;
  imageObjectPath: string | null;
  imageSize: RichmenuSize | null;
  imageBytes: number | null;
  imageMime: 'image/png' | 'image/jpeg' | null;

  // Content
  chatBarText: string;
  selected: boolean;
  areas: RichmenuArea[];

  // Meta
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  publishedAt: Timestamp | null;
  archivedAt: Timestamp | null;
}

// ── DTO（API 回傳格式：Timestamp → ISO string） ─────────────────────

export interface LineRichmenuDto {
  id: string;
  channel: LineClient;
  status: RichmenuStatus;
  name: string;
  lineRichMenuId: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  imageUrl: string | null;
  imageObjectPath: string | null;
  imageSize: RichmenuSize | null;
  imageBytes: number | null;
  imageMime: 'image/png' | 'image/jpeg' | null;
  chatBarText: string;
  selected: boolean;
  areas: RichmenuArea[];
  createdBy: string;
  createdAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
}

const _ts = (v: unknown): string | null => {
  const t = (v as { toDate?: () => Date } | null)?.toDate?.();
  return t ? t.toISOString() : null;
};

/** Firestore snapshot → API DTO */
export function toRichmenuDto(id: string, data: LineRichmenuDoc): LineRichmenuDto {
  return {
    id,
    channel: data.channel,
    status: data.status,
    name: data.name,
    lineRichMenuId: data.lineRichMenuId ?? null,
    syncStatus: data.syncStatus ?? 'not_synced',
    syncError: data.syncError ?? null,
    lastSyncedAt: _ts(data.lastSyncedAt),
    imageUrl: data.imageUrl ?? null,
    imageObjectPath: data.imageObjectPath ?? null,
    imageSize: data.imageSize ?? null,
    imageBytes: data.imageBytes ?? null,
    imageMime: data.imageMime ?? null,
    chatBarText: data.chatBarText ?? '',
    selected: data.selected ?? true,
    areas: Array.isArray(data.areas) ? data.areas : [],
    createdBy: data.createdBy ?? '',
    createdAt: _ts(data.createdAt),
    updatedBy: data.updatedBy ?? '',
    updatedAt: _ts(data.updatedAt),
    publishedAt: _ts(data.publishedAt),
    archivedAt: _ts(data.archivedAt),
  };
}

// ── Validators ─────────────────────────────────────────────────────

const VALID_CHANNELS = new Set<LineClient>(['passenger', 'driver']);

/** 驗 channel；不合法回錯訊；合法回 LineClient */
export function validateChannel(raw: unknown): { ok: true; value: LineClient } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !VALID_CHANNELS.has(raw as LineClient)) {
    return { ok: false, error: 'channel 必須為 passenger 或 driver' };
  }
  return { ok: true, value: raw as LineClient };
}

/** 驗 size；不合法回錯訊；合法回 RichmenuSize */
export function validateSize(raw: unknown): { ok: true; value: RichmenuSize } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'size 必須為物件 { width, height }' };
  }
  const s = raw as { width?: unknown; height?: unknown };
  const match = VALID_SIZES.find((v) => v.width === s.width && v.height === s.height);
  if (!match) {
    return { ok: false, error: 'size 必須為 2500×1686（large）或 2500×843（compact）' };
  }
  return { ok: true, value: match };
}

/** 驗單一 action；不合法回錯訊；合法回 RichmenuAction */
export function validateAction(raw: unknown): { ok: true; value: RichmenuAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'action 必須為物件' };
  }
  const a = raw as Record<string, unknown>;
  const type = a.type;
  const label = typeof a.label === 'string' ? a.label.slice(0, ACTION_LABEL_MAX) : undefined;

  if (type === 'uri') {
    const uri = a.uri;
    if (typeof uri !== 'string' || (!uri.startsWith('https://') && !uri.startsWith('line://'))) {
      return { ok: false, error: 'uri action 的 uri 必須為 https:// 或 line:// 開頭' };
    }
    if (uri.length > URI_MAX) return { ok: false, error: `uri 長度不可超過 ${URI_MAX}` };
    return { ok: true, value: { type: 'uri', uri, ...(label ? { label } : {}) } };
  }

  if (type === 'message') {
    const text = a.text;
    if (typeof text !== 'string' || text.length === 0 || text.length > MESSAGE_TEXT_MAX) {
      return { ok: false, error: `message action 的 text 必須為 1-${MESSAGE_TEXT_MAX} 字` };
    }
    return { ok: true, value: { type: 'message', text, ...(label ? { label } : {}) } };
  }

  if (type === 'postback') {
    const data = a.data;
    if (typeof data !== 'string' || data.length === 0 || data.length > POSTBACK_DATA_MAX) {
      return { ok: false, error: `postback action 的 data 必須為 1-${POSTBACK_DATA_MAX} 字` };
    }
    const displayText = typeof a.displayText === 'string' ? a.displayText.slice(0, 300) : undefined;
    return {
      ok: true,
      value: {
        type: 'postback',
        data,
        ...(displayText ? { displayText } : {}),
        ...(label ? { label } : {}),
      },
    };
  }

  return { ok: false, error: 'action.type 必須為 uri / message / postback' };
}

/** 驗 areas（bounds 在 size 內 + action 合法 + 數量 ≤ AREAS_MAX）；合法回 RichmenuArea[] */
export function validateAreas(
  raw: unknown,
  size: RichmenuSize,
): { ok: true; value: RichmenuArea[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'areas 必須為陣列' };
  }
  if (raw.length === 0) {
    return { ok: false, error: 'areas 至少要 1 個' };
  }
  if (raw.length > AREAS_MAX) {
    return { ok: false, error: `areas 不可超過 ${AREAS_MAX} 個` };
  }

  const result: RichmenuArea[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const a = raw[i] as { bounds?: unknown; action?: unknown };
    const b = a?.bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    if (!b || typeof b !== 'object') {
      return { ok: false, error: `area[${i}].bounds 缺失` };
    }
    const { x, y, width, height } = b;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
      return { ok: false, error: `area[${i}].bounds 的 x/y/width/height 必須為整數` };
    }
    if ((x as number) < 0 || (y as number) < 0 || (width as number) <= 0 || (height as number) <= 0) {
      return { ok: false, error: `area[${i}].bounds 數值不合法` };
    }
    if ((x as number) + (width as number) > size.width || (y as number) + (height as number) > size.height) {
      return { ok: false, error: `area[${i}].bounds 超出圖片尺寸（${size.width}×${size.height}）` };
    }
    const actionRes = validateAction(a.action);
    if (!actionRes.ok) {
      return { ok: false, error: `area[${i}].action: ${actionRes.error}` };
    }
    result.push({
      bounds: {
        x: x as number,
        y: y as number,
        width: width as number,
        height: height as number,
      },
      action: actionRes.value,
    });
  }
  return { ok: true, value: result };
}

/** 驗 chatBarText；合法回 string */
export function validateChatBarText(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'chatBarText 缺失' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > CHAT_BAR_TEXT_MAX) {
    return { ok: false, error: `chatBarText 必須為 1-${CHAT_BAR_TEXT_MAX} 字` };
  }
  return { ok: true, value: trimmed };
}

/** 驗 name；合法回 string */
export function validateName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'name 缺失' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > RICHMENU_NAME_MAX) {
    return { ok: false, error: `name 必須為 1-${RICHMENU_NAME_MAX} 字` };
  }
  return { ok: true, value: trimmed };
}

/** 判斷 richmenu 是否「準備好可以 publish」（image / chatBarText / areas 都已就緒） */
export function isPublishReady(doc: Pick<LineRichmenuDoc, 'imageUrl' | 'imageMime' | 'imageSize' | 'chatBarText' | 'areas'>): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!doc.imageUrl || !doc.imageMime || !doc.imageSize) missing.push('image');
  if (!doc.chatBarText || doc.chatBarText.trim().length === 0) missing.push('chatBarText');
  if (!Array.isArray(doc.areas) || doc.areas.length === 0) missing.push('areas');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
