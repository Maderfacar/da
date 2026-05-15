// P38 Phase 2：admin LINE richmenu type 定義
// 對齊 server/utils/line-richmenu-doc.ts LineRichmenuDoc + line-richmenu.ts 內 Area / Action

export type LineClient = 'passenger' | 'driver';
export type RichmenuStatus = 'draft' | 'active' | 'archived';
export type SyncStatus = 'not_synced' | 'syncing' | 'synced' | 'sync_failed';
// P42：lang 維度（對齊 server/utils/i18n-message.ts `Lang`）
export type RichmenuLang = 'zh_tw' | 'en' | 'ja';

export interface RichmenuSize {
  width: 2500;
  height: 1686 | 843;
}

export interface RichmenuBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RichmenuAction =
  | { type: 'uri'; uri: string; label?: string }
  | { type: 'message'; text: string; label?: string }
  | { type: 'postback'; data: string; displayText?: string; label?: string };

export interface RichmenuArea {
  bounds: RichmenuBounds;
  action: RichmenuAction;
}

// P44b：圖層合成器 schema（admin client side 設計藍圖；render 後出 PNG 走既有 upload-image flow）
export type RichmenuLayerType = 'image' | 'text' | 'rectangle';

export interface RichmenuLayer {
  /** client uuid（非 Firestore id），用於 list key */
  id: string;
  type: RichmenuLayerType;
  /** 底圖 px 整數 */
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

export interface LineRichmenuDto {
  id: string;
  channel: LineClient;
  /** P42：每 doc 一個 lang（migration 後不再為 null；fallback 'zh_tw'） */
  lang: RichmenuLang;
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
  // P44b：圖層合成器 metadata（opt-in）
  layers?: RichmenuLayer[];
  layersTemplate?: string | null;
}

export interface RichmenuListRes {
  items: LineRichmenuDto[];
}

export interface CreateRichmenuBody {
  channel: LineClient;
  /** P42：建立草稿時必選；建立後不允許改（unique key 維度） */
  lang: RichmenuLang;
  name: string;
  chatBarText?: string;
  selected?: boolean;
}

export interface PatchRichmenuBody {
  name?: string;
  chatBarText?: string;
  selected?: boolean;
  areas?: RichmenuArea[];
  // P44b：layers / layersTemplate
  layers?: RichmenuLayer[];
  layersTemplate?: string | null;
}

export interface UploadRichmenuImageRes {
  url: string;
  objectPath: string;
  sizeBytes: number;
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg';
}

export interface PublishRichmenuRes {
  id: string;
  syncStatus: SyncStatus;
  lineRichMenuId: string | null;
  prevActiveId?: string | null;
}

export interface SyncStatusRes {
  local: {
    status: RichmenuStatus;
    lineRichMenuId: string | null;
    syncStatus: SyncStatus;
  };
  line: {
    defaultRichMenuId: string | null;
    detailExists: boolean;
  };
  match: boolean;
  queryError: string | null;
}

// ── P40 Phase 3：Diagnostics MVP ─────────────────────────
export interface SyncOverviewLocalDoc {
  id: string;
  name: string;
  status: RichmenuStatus;
  lineRichMenuId: string | null;
  /** P42：每 doc 一個 lang */
  lang: RichmenuLang;
}

/** P42：sync-overview 內各 lang 獨立統計（admin UI grid 顯示用） */
export interface SyncOverviewByLangEntry {
  activeDoc: SyncOverviewLocalDoc | null;
  docs: SyncOverviewLocalDoc[];
}

export interface SyncOverviewLineMenu {
  richMenuId: string;
  name: string;
  size: { width: number; height: number };
  hasLocalDoc: boolean;
  isDefault: boolean;
}

export interface SyncOverviewRes {
  local: {
    /** P42：以 zh_tw active 為基準（其他 lang 不對 LINE default） */
    activeDoc: SyncOverviewLocalDoc | null;
    docs: SyncOverviewLocalDoc[];
  };
  line: {
    defaultRichMenuId: string | null;
    allMenus: SyncOverviewLineMenu[];
  };
  /** P42：lang 維度獨立統計（admin UI grid 顯示用） */
  byLang: Record<RichmenuLang, SyncOverviewByLangEntry>;
  match: boolean;
  inconsistencies: string[];
  orphans: Array<{ richMenuId: string; name: string }>;
  stale: Array<{ docId: string; lineRichMenuId: string; name: string }>;
  queryError: string | null;
}

export interface CleanupOrphanBody {
  channel: LineClient;
  lineRichMenuId: string;
}
