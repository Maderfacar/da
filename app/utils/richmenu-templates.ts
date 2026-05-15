/**
 * P44b：richmenu 圖層合成器預設模板（5 個內建範本）
 *
 * 套用範本一次設定 layers + areas + imageSize；admin 可再改任意 layer 屬性 / area action。
 *
 * Coordinate system：底圖 px（2500×1686 large / 2500×843 compact）。
 */
import type {
  RichmenuArea,
  RichmenuLayer,
  RichmenuSize,
} from '@/protocol/fetch-api/api/admin/line-richmenu';

export interface RichmenuTemplate {
  key: string;
  label: string;
  description: string;
  size: RichmenuSize;
  /** UI 縮圖代表（emoji，不用真實 base64 縮圖以避免 bundle 過大） */
  thumb: string;
  layers: RichmenuLayer[];
  areas: RichmenuArea[];
}

// 統一視覺色（與 P38 既有 admin amber 對齊）
const AMBER = '#d4860a';
const AMBER_DEEP = '#b8730a';
const CREAM = '#fdf9f1';
const SLATE = '#1f2937';
const SLATE_SOFT = '#374151';
const WHITE = '#ffffff';

// helper：產生隨機 id（避免額外引 nanoid）
let _idCounter = 0;
function nid(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

/** 1. grid-2x2-iconLabel: 4 等分 + 大色塊 + label */
function buildGrid2x2(): RichmenuTemplate {
  const W = 2500;
  const H = 1686;
  const cellW = W / 2;
  const cellH = H / 2;
  const labels = ['訂車', '我的行程', '客服', '會員'];
  const colors = [AMBER, SLATE, AMBER_DEEP, SLATE_SOFT];

  const layers: RichmenuLayer[] = [];
  const areas: RichmenuArea[] = [];
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 2; c += 1) {
      const idx = r * 2 + c;
      const x = Math.round(c * cellW);
      const y = Math.round(r * cellH);
      const w = Math.round(cellW);
      const h = Math.round(cellH);
      // rectangle bg
      layers.push({
        id: nid('rect'),
        type: 'rectangle',
        x,
        y,
        width: w,
        height: h,
        fillColor: colors[idx]!,
      });
      // label
      layers.push({
        id: nid('text'),
        type: 'text',
        x,
        y,
        width: w,
        height: h,
        text: labels[idx]!,
        fontSize: 200,
        fontWeight: 700,
        color: WHITE,
        fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
        align: 'center',
        vAlign: 'middle',
      });
      areas.push({
        bounds: { x, y, width: w, height: h },
        action: { type: 'message', text: labels[idx]! },
      });
    }
  }
  return {
    key: 'grid-2x2-iconLabel',
    label: '2×2 grid + 標籤',
    description: '最常用：4 個主要動作均分版',
    size: { width: 2500, height: 1686 },
    thumb: '🔳',
    layers,
    areas,
  };
}

/** 2. hero-plus-3: 上 hero（大圖區）+ 下 3 等分 */
function buildHeroPlus3(): RichmenuTemplate {
  const W = 2500;
  const H = 1686;
  const heroH = 1000;
  const bottomY = heroH;
  const bottomH = H - heroH;
  const bottomW = Math.round(W / 3);

  const layers: RichmenuLayer[] = [
    // hero bg
    {
      id: nid('rect'),
      type: 'rectangle',
      x: 0,
      y: 0,
      width: W,
      height: heroH,
      fillColor: AMBER,
    },
    // hero title
    {
      id: nid('text'),
      type: 'text',
      x: 0,
      y: 0,
      width: W,
      height: heroH,
      text: '立即預約專屬接送',
      fontSize: 220,
      fontWeight: 700,
      color: WHITE,
      fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
      align: 'center',
      vAlign: 'middle',
    },
  ];

  const bottomLabels = ['我的行程', '車型', '客服'];
  const bottomColors = [SLATE, SLATE_SOFT, AMBER_DEEP];
  const areas: RichmenuArea[] = [
    {
      bounds: { x: 0, y: 0, width: W, height: heroH },
      action: { type: 'uri', uri: 'https://example.com/booking' },
    },
  ];
  for (let c = 0; c < 3; c += 1) {
    const x = c * bottomW;
    layers.push({
      id: nid('rect'),
      type: 'rectangle',
      x,
      y: bottomY,
      width: bottomW,
      height: bottomH,
      fillColor: bottomColors[c]!,
    });
    layers.push({
      id: nid('text'),
      type: 'text',
      x,
      y: bottomY,
      width: bottomW,
      height: bottomH,
      text: bottomLabels[c]!,
      fontSize: 160,
      fontWeight: 600,
      color: WHITE,
      fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
      align: 'center',
      vAlign: 'middle',
    });
    areas.push({
      bounds: { x, y: bottomY, width: bottomW, height: bottomH },
      action: { type: 'message', text: bottomLabels[c]! },
    });
  }
  return {
    key: 'hero-plus-3',
    label: '上 hero + 下 3 等分',
    description: '1 強 3 弱：強調主要動作 + 3 次要',
    size: { width: 2500, height: 1686 },
    thumb: '⬛',
    layers,
    areas,
  };
}

/** 3. header-plus-2x2: 上品牌列 + 下 2×2 */
function buildHeaderPlus2x2(): RichmenuTemplate {
  const W = 2500;
  const H = 1686;
  const headerH = 400;
  const gridY = headerH;
  const gridH = H - headerH;
  const cellW = W / 2;
  const cellH = gridH / 2;

  const layers: RichmenuLayer[] = [
    // header bg
    {
      id: nid('rect'),
      type: 'rectangle',
      x: 0,
      y: 0,
      width: W,
      height: headerH,
      fillColor: SLATE,
    },
    // brand title
    {
      id: nid('text'),
      type: 'text',
      x: 0,
      y: 0,
      width: W,
      height: headerH,
      text: 'DestinationAnywhere',
      fontSize: 140,
      fontWeight: 700,
      color: WHITE,
      fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
      align: 'center',
      vAlign: 'middle',
    },
  ];

  const labels = ['訂車', '行程', '客服', '會員'];
  const colors = [AMBER, AMBER_DEEP, SLATE_SOFT, CREAM];
  const textColors = [WHITE, WHITE, WHITE, SLATE];
  const areas: RichmenuArea[] = [];
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 2; c += 1) {
      const idx = r * 2 + c;
      const x = Math.round(c * cellW);
      const y = Math.round(gridY + r * cellH);
      const w = Math.round(cellW);
      const h = Math.round(cellH);
      layers.push({
        id: nid('rect'),
        type: 'rectangle',
        x,
        y,
        width: w,
        height: h,
        fillColor: colors[idx]!,
      });
      layers.push({
        id: nid('text'),
        type: 'text',
        x,
        y,
        width: w,
        height: h,
        text: labels[idx]!,
        fontSize: 180,
        fontWeight: 700,
        color: textColors[idx]!,
        fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
        align: 'center',
        vAlign: 'middle',
      });
      areas.push({
        bounds: { x, y, width: w, height: h },
        action: { type: 'message', text: labels[idx]! },
      });
    }
  }
  return {
    key: 'header-plus-2x2',
    label: '上品牌列 + 下 2×2',
    description: '強化品牌識別 + 4 個動作',
    size: { width: 2500, height: 1686 },
    thumb: '🏷️',
    layers,
    areas,
  };
}

/** 4. compact-3btn (2500×843): 緊湊 3 button */
function buildCompact3Btn(): RichmenuTemplate {
  const W = 2500;
  const H = 843;
  const cellW = Math.round(W / 3);
  const labels = ['立即預約', '我的行程', '客服'];
  const colors = [AMBER, SLATE, AMBER_DEEP];

  const layers: RichmenuLayer[] = [];
  const areas: RichmenuArea[] = [];
  for (let c = 0; c < 3; c += 1) {
    const x = c * cellW;
    layers.push({
      id: nid('rect'),
      type: 'rectangle',
      x,
      y: 0,
      width: cellW,
      height: H,
      fillColor: colors[c]!,
    });
    layers.push({
      id: nid('text'),
      type: 'text',
      x,
      y: 0,
      width: cellW,
      height: H,
      text: labels[c]!,
      fontSize: 180,
      fontWeight: 700,
      color: WHITE,
      fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
      align: 'center',
      vAlign: 'middle',
    });
    areas.push({
      bounds: { x, y: 0, width: cellW, height: H },
      action: { type: 'message', text: labels[c]! },
    });
  }
  return {
    key: 'compact-3btn',
    label: '緊湊 3 button（小尺寸）',
    description: '2500×843 緊湊版：3 個橫向動作',
    size: { width: 2500, height: 843 },
    thumb: '▬',
    layers,
    areas,
  };
}

/** 5. bg-plus-6grid: 底圖 + 6 透明區 */
function buildBgPlus6Grid(): RichmenuTemplate {
  const W = 2500;
  const H = 1686;
  const cellW = Math.round(W / 3);
  const cellH = Math.round(H / 2);
  const labels = ['訂車', '車型', '行程', '通知', '客服', '會員'];

  const layers: RichmenuLayer[] = [
    // bg
    {
      id: nid('rect'),
      type: 'rectangle',
      x: 0,
      y: 0,
      width: W,
      height: H,
      fillColor: CREAM,
    },
  ];

  const areas: RichmenuArea[] = [];
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const idx = r * 3 + c;
      const x = c * cellW;
      const y = r * cellH;
      // 半透明卡片
      layers.push({
        id: nid('rect'),
        type: 'rectangle',
        x: x + 60,
        y: y + 60,
        width: cellW - 120,
        height: cellH - 120,
        fillColor: WHITE,
        borderColor: AMBER,
        borderWidth: 6,
        radius: 40,
      });
      layers.push({
        id: nid('text'),
        type: 'text',
        x,
        y,
        width: cellW,
        height: cellH,
        text: labels[idx]!,
        fontSize: 160,
        fontWeight: 700,
        color: SLATE,
        fontFamily: 'system-ui, "Noto Sans TC", sans-serif',
        align: 'center',
        vAlign: 'middle',
      });
      areas.push({
        bounds: { x, y, width: cellW, height: cellH },
        action: { type: 'message', text: labels[idx]! },
      });
    }
  }
  return {
    key: 'bg-plus-6grid',
    label: '底圖 + 6 卡片',
    description: '視覺豐富 + 6 個動作',
    size: { width: 2500, height: 1686 },
    thumb: '🎴',
    layers,
    areas,
  };
}

export const RICHMENU_TEMPLATES: RichmenuTemplate[] = [
  buildGrid2x2(),
  buildHeroPlus3(),
  buildHeaderPlus2x2(),
  buildCompact3Btn(),
  buildBgPlus6Grid(),
];

export function getTemplate(key: string): RichmenuTemplate | null {
  return RICHMENU_TEMPLATES.find((t) => t.key === key) ?? null;
}

export function listTemplates(sizeHeight?: 1686 | 843): RichmenuTemplate[] {
  if (sizeHeight === undefined) return RICHMENU_TEMPLATES;
  return RICHMENU_TEMPLATES.filter((t) => t.size.height === sizeHeight);
}

/**
 * 範本套用時取「深 clone」避免 admin 改 layer 屬性污染 module-level 範本
 *
 * 注意：每次 clone 時用 fresh id（避免不同 admin 同時複製的 layer.id 重複）
 */
export function cloneTemplate(t: RichmenuTemplate): {
  layers: RichmenuLayer[];
  areas: RichmenuArea[];
  size: RichmenuSize;
} {
  return {
    layers: t.layers.map((l) => ({ ...l, id: nid(l.type) })),
    areas: t.areas.map((a) => ({
      bounds: { ...a.bounds },
      action: { ...a.action },
    })),
    size: { ...t.size },
  };
}
