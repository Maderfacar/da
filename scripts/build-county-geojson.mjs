// 一次性預處理：從 g0v/twgeojson 22 縣市邊界產出精簡版 shared/geo/taiwan-counties.json
// （內容為 GeoJSON FeatureCollection；副檔名用 .json 以便 server 端原生靜態 import）
//
// 用法：node scripts/build-county-geojson.mjs
// 來源檔不存在時自動下載並快取於 scripts/.geo-build/（該目錄已 gitignore）。
//
// Fare V2 — Phase 1.1。國道/縣市資料更新極少，本腳本為一次性產出，需要時手動重跑。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_URL = 'https://raw.githubusercontent.com/g0v/twgeojson/master/json/twCounty2010.geo.json';
const CACHE = resolve(__dirname, '.geo-build', 'twCounty2010.geo.json');
const OUT = resolve(ROOT, 'shared', 'geo', 'taiwan-counties.json');

// 簡化容差（經緯度），~0.002° ≈ 200m。縣市級偵測沿路線每 500m 取樣，200m 邊界誤差無影響。
const SIMPLIFY_TOLERANCE_DEG = 0.002;
// 座標精度：5 位小數 ≈ 1m
const COORD_PRECISION = 5;

// COUNTYNAME（g0v 2010 資料用「台」字）→ 自定 code
const NAME_TO_CODE = {
  台北市: 'TPE', 新北市: 'NTPE', 桃園縣: 'TYN', 基隆市: 'KEE',
  新竹市: 'HSC', 新竹縣: 'HSZ', 苗栗縣: 'MIA', 台中市: 'TXG',
  彰化縣: 'CHA', 南投縣: 'NAN', 雲林縣: 'YUN', 嘉義市: 'CYI',
  嘉義縣: 'CYQ', 台南市: 'TNN', 高雄市: 'KHH', 屏東縣: 'PIF',
  宜蘭縣: 'ILA', 花蓮縣: 'HUA', 台東縣: 'TTT', 澎湖縣: 'PEH',
  金門縣: 'KIN', 連江縣: 'LIE',
};

// code → 現代繁中名（geojson 內嵌 name 供 debug）
const CODE_TO_ZH = {
  TPE: '台北市', NTPE: '新北市', TYN: '桃園市', KEE: '基隆市',
  HSC: '新竹市', HSZ: '新竹縣', MIA: '苗栗縣', TXG: '台中市',
  CHA: '彰化縣', NAN: '南投縣', YUN: '雲林縣', CYI: '嘉義市',
  CYQ: '嘉義縣', TNN: '台南市', KHH: '高雄市', PIF: '屏東縣',
  ILA: '宜蘭縣', HUA: '花蓮縣', TTT: '台東縣', PEH: '澎湖縣',
  KIN: '金門縣', LIE: '連江縣',
};

function round(n) {
  const f = 10 ** COORD_PRECISION;
  return Math.round(n * f) / f;
}

// 點到線段的垂直距離（經緯度當平面，台灣尺度誤差可忽略）
function perpDistance(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Douglas-Peucker
function douglasPeucker(points, tol) {
  if (points.length < 3) return points;
  let maxD = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tol) {
    const left = douglasPeucker(points.slice(0, idx + 1), tol);
    const right = douglasPeucker(points.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// 簡化單一封閉環；過度塌縮（< 4 點）則保留原環，避免小島消失
function simplifyRing(ring, tol) {
  if (ring.length <= 5) return ring;
  let s = douglasPeucker(ring, tol);
  if (s.length < 4) return ring;
  const a = s[0];
  const b = s[s.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) s = s.concat([a]);
  return s;
}

function simplifyGeometry(geom) {
  const ring = (r) => simplifyRing(r, SIMPLIFY_TOLERANCE_DEG).map(([x, y]) => [round(x), round(y)]);
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(ring) };
  }
  if (geom.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geom.coordinates.map((poly) => poly.map(ring)) };
  }
  throw new Error(`不支援的 geometry 型別：${geom.type}`);
}

function countPoints(geom) {
  if (geom.type === 'Polygon') {
    return geom.coordinates.reduce((s, r) => s + r.length, 0);
  }
  return geom.coordinates.reduce((s, poly) => s + poly.reduce((ss, r) => ss + r.length, 0), 0);
}

async function loadSource() {
  if (existsSync(CACHE)) {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  console.log(`下載來源檔：${SRC_URL}`);
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`下載失敗 HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, text);
  return JSON.parse(text);
}

async function main() {
  const src = await loadSource();
  if (src.type !== 'FeatureCollection' || !Array.isArray(src.features)) {
    throw new Error('來源檔不是 FeatureCollection');
  }

  let pointsBefore = 0;
  let pointsAfter = 0;
  const features = [];

  for (const f of src.features) {
    const rawName = f.properties?.COUNTYNAME ?? f.properties?.name;
    const code = NAME_TO_CODE[rawName];
    if (!code) throw new Error(`未知縣市名稱：${rawName}`);
    pointsBefore += countPoints(f.geometry);
    const geometry = simplifyGeometry(f.geometry);
    pointsAfter += countPoints(geometry);
    features.push({
      type: 'Feature',
      properties: { code, name: CODE_TO_ZH[code] },
      geometry,
    });
  }

  if (features.length !== 22) throw new Error(`預期 22 縣市，實得 ${features.length}`);

  features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));

  const out = {
    type: 'FeatureCollection',
    name: 'taiwan-counties',
    generatedAt: new Date().toISOString().slice(0, 10),
    features,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));

  const bytes = readFileSync(OUT).length;
  console.log('--- 縣市 GeoJSON 產出完成 ---');
  console.log(`縣市數     : ${features.length}`);
  console.log(`座標點     : ${pointsBefore} → ${pointsAfter}（簡化率 ${(100 - (pointsAfter / pointsBefore) * 100).toFixed(1)}%）`);
  console.log(`輸出檔     : ${OUT}`);
  console.log(`檔案大小   : ${(bytes / 1024).toFixed(1)} KB`);
  if (bytes > 1024 * 1024) console.warn('⚠ 超過 1MB，建議調高 SIMPLIFY_TOLERANCE_DEG');
}

main().catch((err) => {
  console.error('建置失敗：', err.message);
  process.exit(1);
});
