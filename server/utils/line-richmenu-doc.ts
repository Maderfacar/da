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
import type { Lang } from '@@/utils/user-lang';

// ── Constants ──────────────────────────────────────────────────────

export const RICHMENU_NAME_MAX = 100;
export const CHAT_BAR_TEXT_MAX = 14;
export const AREAS_MAX = 20;
export const URI_MAX = 1000;
export const MESSAGE_TEXT_MAX = 300;
export const POSTBACK_DATA_MAX = 300;
export const ACTION_LABEL_MAX = 20;

// P44b：layers 上限（avoid 過大 doc 與合成爆炸）
export const LAYERS_MAX = 50;
export const LAYER_TEXT_MAX = 200;
export const LAYER_TEMPLATE_KEY_MAX = 60;

export const VALID_SIZES: RichmenuSize[] = [
  { width: 2500, height: 1686 },
  { width: 2500, height: 843 },
];

/**
 * P42：richmenu 支援的 lang code 列舉（對齊 user-lang.ts `Lang`）。
 *
 * - 建立 draft 時必選其一（Q1=1a 拍板：每 lang 一獨立 doc）
 * - publish unique 約束：channel × lang × status='active' 同時 ≤ 1
 * - migration 把既有 lang 為 null/undefined 的 doc grandfather 為 'zh_tw'（Q7=7a 拍板）
 */
export const RICHMENU_VALID_LANGS: readonly Lang[] = ['zh_tw', 'en', 'ja'] as const;

export type RichmenuStatus = 'draft' | 'active' | 'archived';
export type SyncStatus = 'not_synced' | 'syncing' | 'synced' | 'sync_failed';

// ── P44b：圖層合成器 ─────────────────────────────────────────
export type RichmenuLayerType = 'image' | 'text' | 'rectangle';

/**
 * P44b：richmenu 合成圖層 schema（doc 內可選 field）
 *
 * - 既有 doc 沒 layers field 完全不影響（admin 用「上傳成品圖」流程）
 * - admin 用「圖層合成器」flow 後 layers 寫入 doc，下次 admin 重編可直接從 layers 繼續修
 * - layers 不影響 LINE 端 — 只是 admin 端的「設計藍圖」；render 出 PNG 後走既有 upload-image 流程
 */
export interface RichmenuLayer {
  /** client uuid（非 Firestore id），用於 list key */
  id: string;
  type: RichmenuLayerType;
  /** 底圖 px 整數座標 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-1，預設 1 */
  opacity?: number;

  // image
  imageUrl?: string;
  imageFit?: 'contain' | 'cover' | 'fill';

  // text
  text?: string;
  fontSize?: number;
  fontWeight?: 400 | 600 | 700;
  fontFamily?: string;
  color?: string;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';

  // rectangle
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
}

// ── Firestore Doc ──────────────────────────────────────────────────

export interface LineRichmenuDoc {
  channel: LineClient;
  /** P42：lang 維度（每 lang 獨立 doc；既有 doc 由 migration 補為 'zh_tw'） */
  lang: Lang;
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

  // P44b：圖層合成器 metadata（opt-in，既有 doc 無此欄位仍 work）
  layers?: RichmenuLayer[];
  layersTemplate?: string;
}

// ── DTO（API 回傳格式：Timestamp → ISO string） ─────────────────────

export interface LineRichmenuDto {
  id: string;
  channel: LineClient;
  /** P42：對應 doc lang field（永遠是 'zh_tw' / 'en' / 'ja'，migration 後不再為 null） */
  lang: Lang;
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
  // P44b：layers metadata
  layers?: RichmenuLayer[];
  layersTemplate?: string | null;
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
    // P42：grandfather safety — pre-migration doc 沒寫 lang 時 fallback 'zh_tw'
    lang: ((data.lang as Lang | undefined) && (RICHMENU_VALID_LANGS as readonly Lang[]).includes(data.lang))
      ? data.lang
      : 'zh_tw',
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
    layers: Array.isArray(data.layers) ? data.layers : undefined,
    layersTemplate: data.layersTemplate ?? null,
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

/** P42：驗 lang；不合法回錯訊；合法回 Lang */
export function validateLang(raw: unknown): { ok: true; value: Lang } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !(RICHMENU_VALID_LANGS as readonly string[]).includes(raw)) {
    return { ok: false, error: `lang 必須為 ${RICHMENU_VALID_LANGS.join(' / ')}` };
  }
  return { ok: true, value: raw as Lang };
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

// ── P44b：layers / layersTemplate validators ───────────────────────

const VALID_LAYER_TYPES = new Set<RichmenuLayerType>(['image', 'text', 'rectangle']);
const VALID_IMAGE_FITS = new Set(['contain', 'cover', 'fill']);
const VALID_ALIGNS = new Set(['left', 'center', 'right']);
const VALID_V_ALIGNS = new Set(['top', 'middle', 'bottom']);
const VALID_FONT_WEIGHTS = new Set([400, 600, 700]);

/** 驗單一 layer。回完整清洗過的 RichmenuLayer（去掉 undefined / 越界值） */
function validateLayer(raw: unknown, size: RichmenuSize, idx: number): { ok: true; value: RichmenuLayer } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `layer[${idx}] 必須為物件` };
  }
  const l = raw as Record<string, unknown>;

  // type
  const type = l.type;
  if (typeof type !== 'string' || !VALID_LAYER_TYPES.has(type as RichmenuLayerType)) {
    return { ok: false, error: `layer[${idx}].type 必須為 image / text / rectangle` };
  }

  // id
  const id = typeof l.id === 'string' && l.id.length > 0 && l.id.length <= 80 ? l.id : null;
  if (!id) {
    return { ok: false, error: `layer[${idx}].id 缺失或過長` };
  }

  // bounds (整數 + 在 size 內)
  const { x, y, width, height } = l;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
    return { ok: false, error: `layer[${idx}] 的 x/y/width/height 必須為整數` };
  }
  if ((x as number) < 0 || (y as number) < 0 || (width as number) <= 0 || (height as number) <= 0) {
    return { ok: false, error: `layer[${idx}] 的 x/y/width/height 數值不合法` };
  }
  // 允許 layer 超出底圖部分裁切（不強制限制），但完全在底圖外則拒
  if ((x as number) >= size.width || (y as number) >= size.height) {
    return { ok: false, error: `layer[${idx}] 完全在底圖外` };
  }

  const out: RichmenuLayer = {
    id,
    type: type as RichmenuLayerType,
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
  };

  // opacity
  if (l.opacity !== undefined) {
    const op = Number(l.opacity);
    if (!Number.isFinite(op) || op < 0 || op > 1) {
      return { ok: false, error: `layer[${idx}].opacity 必須為 0-1` };
    }
    out.opacity = op;
  }

  // image
  if (type === 'image') {
    if (l.imageUrl !== undefined) {
      if (typeof l.imageUrl !== 'string' || l.imageUrl.length === 0 || l.imageUrl.length > 4096) {
        return { ok: false, error: `layer[${idx}].imageUrl 無效` };
      }
      out.imageUrl = l.imageUrl;
    }
    if (l.imageFit !== undefined) {
      if (typeof l.imageFit !== 'string' || !VALID_IMAGE_FITS.has(l.imageFit)) {
        return { ok: false, error: `layer[${idx}].imageFit 必須為 contain / cover / fill` };
      }
      out.imageFit = l.imageFit as RichmenuLayer['imageFit'];
    }
  }

  // text
  if (type === 'text') {
    if (l.text !== undefined) {
      if (typeof l.text !== 'string' || l.text.length > LAYER_TEXT_MAX) {
        return { ok: false, error: `layer[${idx}].text 必須為 string 且 ≤ ${LAYER_TEXT_MAX} 字` };
      }
      out.text = l.text;
    }
    if (l.fontSize !== undefined) {
      const fs = Number(l.fontSize);
      if (!Number.isFinite(fs) || fs < 6 || fs > 800) {
        return { ok: false, error: `layer[${idx}].fontSize 必須為 6-800` };
      }
      out.fontSize = Math.round(fs);
    }
    if (l.fontWeight !== undefined) {
      const fw = Number(l.fontWeight);
      if (!VALID_FONT_WEIGHTS.has(fw)) {
        return { ok: false, error: `layer[${idx}].fontWeight 必須為 400 / 600 / 700` };
      }
      out.fontWeight = fw as 400 | 600 | 700;
    }
    if (l.fontFamily !== undefined) {
      if (typeof l.fontFamily !== 'string' || l.fontFamily.length > 200) {
        return { ok: false, error: `layer[${idx}].fontFamily 無效` };
      }
      out.fontFamily = l.fontFamily;
    }
    if (l.color !== undefined) {
      if (typeof l.color !== 'string' || l.color.length > 64) {
        return { ok: false, error: `layer[${idx}].color 無效` };
      }
      out.color = l.color;
    }
    if (l.align !== undefined) {
      if (typeof l.align !== 'string' || !VALID_ALIGNS.has(l.align)) {
        return { ok: false, error: `layer[${idx}].align 必須為 left / center / right` };
      }
      out.align = l.align as RichmenuLayer['align'];
    }
    if (l.vAlign !== undefined) {
      if (typeof l.vAlign !== 'string' || !VALID_V_ALIGNS.has(l.vAlign)) {
        return { ok: false, error: `layer[${idx}].vAlign 必須為 top / middle / bottom` };
      }
      out.vAlign = l.vAlign as RichmenuLayer['vAlign'];
    }
  }

  // rectangle
  if (type === 'rectangle') {
    if (l.fillColor !== undefined) {
      if (typeof l.fillColor !== 'string' || l.fillColor.length > 64) {
        return { ok: false, error: `layer[${idx}].fillColor 無效` };
      }
      out.fillColor = l.fillColor;
    }
    if (l.borderColor !== undefined) {
      if (typeof l.borderColor !== 'string' || l.borderColor.length > 64) {
        return { ok: false, error: `layer[${idx}].borderColor 無效` };
      }
      out.borderColor = l.borderColor;
    }
    if (l.borderWidth !== undefined) {
      const bw = Number(l.borderWidth);
      if (!Number.isFinite(bw) || bw < 0 || bw > 200) {
        return { ok: false, error: `layer[${idx}].borderWidth 必須為 0-200` };
      }
      out.borderWidth = Math.round(bw);
    }
    if (l.radius !== undefined) {
      const r = Number(l.radius);
      if (!Number.isFinite(r) || r < 0 || r > 1000) {
        return { ok: false, error: `layer[${idx}].radius 必須為 0-1000` };
      }
      out.radius = Math.round(r);
    }
  }

  return { ok: true, value: out };
}

/** 驗 layers array（≤ LAYERS_MAX；每 layer 合法） */
export function validateLayers(raw: unknown, size: RichmenuSize): { ok: true; value: RichmenuLayer[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'layers 必須為陣列' };
  }
  if (raw.length > LAYERS_MAX) {
    return { ok: false, error: `layers 不可超過 ${LAYERS_MAX} 個` };
  }
  const result: RichmenuLayer[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = validateLayer(raw[i], size, i);
    if (!r.ok) return r;
    result.push(r.value);
  }
  return { ok: true, value: result };
}

/** 驗 layersTemplate key（≤ 60 字字串 / null 清除） */
export function validateLayersTemplate(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LAYER_TEMPLATE_KEY_MAX) {
    return { ok: false, error: `layersTemplate 必須為 1-${LAYER_TEMPLATE_KEY_MAX} 字 string（或 null 清除）` };
  }
  return { ok: true, value: raw };
}

/** 判斷 richmenu 是否「準備好可以 publish」（image / chatBarText / areas 都已就緒） */
export function isPublishReady(doc: Pick<LineRichmenuDoc, 'imageUrl' | 'imageMime' | 'imageSize' | 'chatBarText' | 'areas'>): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!doc.imageUrl || !doc.imageMime || !doc.imageSize) missing.push('image');
  if (!doc.chatBarText || doc.chatBarText.trim().length === 0) missing.push('chatBarText');
  if (!Array.isArray(doc.areas) || doc.areas.length === 0) missing.push('areas');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
