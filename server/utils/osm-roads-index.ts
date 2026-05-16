// OSM 道路層級索引 — 判定路線上某點是否落在國道(motorway) / 快速道路(trunk)
//
// 資料源 shared/geo/osm-roads-index.json 由 scripts/build-osm-roads-index.mjs 一次性產出。
// 首次查詢時把全部道路線段灌入 in-memory R-tree（rbush），之後常駐重用，避免每次估價重建。
//
// Fare V2 — Phase 1.3。

import RBush from 'rbush';
import osmIndexRaw from '~shared/geo/osm-roads-index.json';

export type RoadClass = 'motorway' | 'trunk' | 'other';

interface OsmRoad {
  id: number;
  highway: 'motorway' | 'trunk';
  ref: string;
  name: string;
  geometry: ReadonlyArray<readonly [number, number]>; // [lng, lat]
}

interface OsmRoadsIndexFile {
  version: string;
  source: string;
  bbox: [number, number, number, number];
  roads: OsmRoad[];
}

// R-tree 葉節點：一條道路的單一線段
interface SegmentItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  ax: number; // 端點 A 經度
  ay: number; // 端點 A 緯度
  bx: number; // 端點 B 經度
  by: number; // 端點 B 緯度
  cls: 'motorway' | 'trunk';
}

const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

let tree: RBush<SegmentItem> | null = null;
let segmentCount = 0;

function buildTree(): RBush<SegmentItem> {
  if (tree) return tree;
  const idx = osmIndexRaw as unknown as OsmRoadsIndexFile;
  const items: SegmentItem[] = [];
  for (const road of idx.roads) {
    const g = road.geometry;
    for (let i = 0; i < g.length - 1; i++) {
      const [ax, ay] = g[i]!;
      const [bx, by] = g[i + 1]!;
      items.push({
        minX: Math.min(ax, bx),
        minY: Math.min(ay, by),
        maxX: Math.max(ax, bx),
        maxY: Math.max(ay, by),
        ax,
        ay,
        bx,
        by,
        cls: road.highway,
      });
    }
  }
  const built = new RBush<SegmentItem>();
  built.load(items);
  tree = built;
  segmentCount = items.length;
  return built;
}

// 點到線段最短距離（公尺）。以查詢點緯度做等距方位投影，台灣尺度誤差可忽略。
function pointToSegmentMeters(
  pLat: number,
  pLng: number,
  seg: SegmentItem,
): number {
  const mLat = METERS_PER_DEG_LAT;
  const mLng = metersPerDegLng(pLat);
  const px = pLng * mLng;
  const py = pLat * mLat;
  const aX = seg.ax * mLng;
  const aY = seg.ay * mLat;
  const bX = seg.bx * mLng;
  const bY = seg.by * mLat;
  const dx = bX - aX;
  const dy = bY - aY;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = ((px - aX) * dx + (py - aY) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = aX + t * dx;
  const cy = aY + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * 判定座標點落在哪一種道路層級。
 * @param point 經緯度
 * @param toleranceM 容差（公尺）；點與道路線段距離在此範圍內才算命中
 * @returns 'motorway' | 'trunk' | 'other'（容差內無國道/快速道路即 'other'）
 */
export function nearestRoadClass(
  point: { lat: number; lng: number },
  toleranceM: number,
): RoadClass {
  const t = buildTree();
  const dLat = toleranceM / METERS_PER_DEG_LAT;
  const dLng = toleranceM / metersPerDegLng(point.lat);
  const candidates = t.search({
    minX: point.lng - dLng,
    minY: point.lat - dLat,
    maxX: point.lng + dLng,
    maxY: point.lat + dLat,
  });
  let best: RoadClass = 'other';
  let bestDist = toleranceM;
  for (const seg of candidates) {
    const d = pointToSegmentMeters(point.lat, point.lng, seg);
    if (d <= bestDist) {
      bestDist = d;
      best = seg.cls;
    }
  }
  return best;
}

/** 索引中介資訊 — 供 route-metrics 回報 apiSourcesOk.osm 與 debug */
export function getOsmIndexMeta(): {
  version: string;
  roadCount: number;
  segmentCount: number;
  loaded: boolean;
} {
  const idx = osmIndexRaw as unknown as OsmRoadsIndexFile;
  buildTree();
  return {
    version: idx.version,
    roadCount: idx.roads.length,
    segmentCount,
    loaded: Array.isArray(idx.roads) && idx.roads.length > 0,
  };
}
