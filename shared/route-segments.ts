// 路段分類 — Google Routes/Directions steps[] 跑 regex 分高速 / 平面。
//
// 設計：白名單 regex 列舉「明確高速」字樣，未命中即視為平面。
// 不用「台\d+ 通配」— 台 61/62/64 等是高速白名單，台 2/9 是平面省道，誤抓會錯收。
//
// 純函式 / 前後端共用 / 無 Nuxt 依賴。
// 視窗 1（fare 引擎加平面道路加成）。

export interface RouteStepLite {
  /** 已 HTML strip 前的原始 instructions（zh-TW 語系 Routes/Directions 回的）；caller 不必預先 strip */
  instructions: string;
  /** step 距離（km；caller 已轉好） */
  distanceKm: number;
}

export interface RouteSegmentRow {
  /** 已 strip HTML 的純文字指引 */
  instructions: string;
  distanceKm: number;
  /** 命中任一 highwayPatterns → true（高速）；否則 false（平面） */
  isHighway: boolean;
}

export interface RouteSegmentsResult {
  highwayKm: number;
  surfaceKm: number;
  breakdown: RouteSegmentRow[];
}

/**
 * 預設高速路型白名單 regex（admin 可在 Firestore fare_rules/v1.surfaceSurcharge.highwayPatterns 覆寫）。
 *
 * 涵蓋：
 *  - 國道一/二/三/四/五/六/八/十號（國道帶中文數字 / 阿拉伯數字）
 *  - 國 1 / 國 5 / freeway / expressway / 高速公路 / 快速道路
 *  - 台 61/62/64/65/66/68/74/76/78/82/84/86/88 等明確快速道路省道
 *
 * 不收：台 2 / 台 9 / 台 11（平面省道）；台北市/縣道則靠未命中自然落 surface。
 */
export const DEFAULT_HIGHWAY_PATTERNS: ReadonlyArray<string> = Object.freeze([
  '國道[一二三四五六八十]+號?',
  '國[1-9]',
  'freeway|expressway',
  '高速公路|快速道路',
  '台\\s*(61|62|64|65|66|68|74|76|78|82|84|86|88)',
]);

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': '\'',
  '&#39;': '\'',
  '&nbsp;': ' ',
};

/**
 * 移除 HTML tag + 解碼常見 entity；Google instructions 帶 <b>/<div> 等標記。
 * 純字串轉換，無 DOM 依賴（shared 前後端共用）。
 */
export function stripHtml(s: string): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITY_MAP[m.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 把 patterns 字串編譯成 RegExp[]（case-insensitive）。
 * 無效 pattern silent skip — 避免 admin 誤打 regex 把整個引擎打掛。
 */
export function compilePatterns(patterns: ReadonlyArray<string>): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    if (typeof p !== 'string' || p.length === 0) continue;
    try {
      out.push(new RegExp(p, 'i'));
    } catch {
      // skip invalid pattern
    }
  }
  return out;
}

/**
 * 解析路線 steps，依 patterns 把每段歸類為高速 / 平面並累加里程。
 *
 * - steps 空陣列 → highwayKm 0 / surfaceKm 0 / breakdown []
 * - 任一 pattern 在 step.instructions 命中 → 該段歸高速
 * - 否則歸平面
 * - distanceKm 取 max(0, step.distanceKm) 防呆
 */
export function parseRouteSegments(
  steps: ReadonlyArray<RouteStepLite>,
  patterns: ReadonlyArray<string>,
): RouteSegmentsResult {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { highwayKm: 0, surfaceKm: 0, breakdown: [] };
  }
  const regexes = compilePatterns(patterns);
  let highwayKm = 0;
  let surfaceKm = 0;
  const breakdown: RouteSegmentRow[] = [];
  for (const step of steps) {
    const text = stripHtml(step?.instructions ?? '');
    const km = Number.isFinite(step?.distanceKm) ? Math.max(0, step.distanceKm) : 0;
    const isHighway = regexes.some((r) => r.test(text));
    if (isHighway) highwayKm += km;
    else surfaceKm += km;
    breakdown.push({ instructions: text, distanceKm: km, isHighway });
  }
  return { highwayKm, surfaceKm, breakdown };
}
