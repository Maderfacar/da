// 一次性預處理：產出 shared/geo/osm-roads-index.json — 台灣國道(motorway) + 快速道路(trunk) 線形索引
//
// 用法：node scripts/build-osm-roads-index.mjs
//
// 設計決策（design.md Brain AI 拍板）：
//   - 過濾範圍 A：只留 highway = motorway / trunk
//   - 更新頻率 A：一次性產出，永不自動更新；國道有新建/廢線再手動重跑
//   - host 方式 C：簡化壓縮後 < 5MB 進 git repo
//
// 資料來源改用 Overpass API（而非 design.md 提的 200MB taiwan-latest.osm.pbf）：
//   Overpass `out geom` 直接回傳指定 highway 的 way 線形，免下載整國 PBF、
//   免裝 osmium native 工具、免解析 node reference。一次性查詢最適合。
//   原始回應快取於 scripts/.geo-build/（已 gitignore），重跑不重新查詢。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE = resolve(__dirname, '.geo-build', 'overpass-roads.json');
const OUT = resolve(ROOT, 'shared', 'geo', 'osm-roads-index.json');

// 台灣本島 + 離島涵蓋範圍 bbox（south, west, north, east）
const BBOX = [21.7, 119.3, 25.4, 122.1];

// 線形簡化容差（經緯度）。查詢階段用 20m 容差比對，索引精度 ~6m 綽綽有餘。
const SIMPLIFY_TOLERANCE_DEG = 0.00006;
// 座標精度：6 位小數 ≈ 0.1m
const COORD_PRECISION = 6;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const QUERY = `[out:json][timeout:240];
(
  way["highway"="motorway"](${BBOX.join(',')});
  way["highway"="trunk"](${BBOX.join(',')});
);
out geom;`;

function round(n) {
  const f = 10 ** COORD_PRECISION;
  return Math.round(n * f) / f;
}

function perpDistance(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass(endpoint) {
  // Overpass 公開實例會拒絕無 User-Agent 的請求（視為 scraper）
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'da-fare-v2-build/1.0 (one-time OSM roads index build)',
    Accept: 'application/json',
  };
  const body = new URLSearchParams({ data: QUERY });
  // 針對 429（rate limit）做指數退避重試
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(endpoint, { method: 'POST', headers, body });
    if (res.ok) {
      const text = await res.text();
      const json = JSON.parse(text);
      if (!Array.isArray(json.elements)) throw new Error('回應無 elements 陣列');
      return { text, json };
    }
    if (res.status === 429 && attempt < 4) {
      const wait = 15000 * attempt;
      console.warn(`  HTTP 429 rate limited，${wait / 1000}s 後重試（${attempt}/3）`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error('429 重試耗盡');
}

async function queryOverpass() {
  if (existsSync(CACHE)) {
    console.log(`使用快取：${CACHE}`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`查詢 Overpass：${endpoint}`);
      const { text, json } = await fetchOverpass(endpoint);
      mkdirSync(dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, text);
      return json;
    } catch (err) {
      console.warn(`  失敗：${err.message}`);
      lastErr = err;
    }
  }
  throw new Error(`所有 Overpass endpoint 皆失敗，最後錯誤：${lastErr?.message}`);
}

async function main() {
  const data = await queryOverpass();

  const roads = [];
  let pointsBefore = 0;
  let pointsAfter = 0;
  let skipped = 0;
  let bMinLng = Infinity;
  let bMinLat = Infinity;
  let bMaxLng = -Infinity;
  let bMaxLat = -Infinity;
  const classCount = { motorway: 0, trunk: 0 };

  for (const el of data.elements) {
    if (el.type !== 'way') continue;
    const tags = el.tags ?? {};
    const highway = tags.highway;
    if (highway !== 'motorway' && highway !== 'trunk') continue;
    // 排除多邊形與私有道路
    if (tags.area === 'yes' || tags.access === 'private') {
      skipped++;
      continue;
    }
    const geom = el.geometry;
    if (!Array.isArray(geom) || geom.length < 2) {
      skipped++;
      continue;
    }

    // Overpass out geom → {lat, lon}；轉 [lng, lat]
    const raw = geom.filter((g) => g && typeof g.lat === 'number').map((g) => [g.lon, g.lat]);
    if (raw.length < 2) {
      skipped++;
      continue;
    }
    pointsBefore += raw.length;
    const simplified = douglasPeucker(raw, SIMPLIFY_TOLERANCE_DEG).map(([x, y]) => [round(x), round(y)]);
    pointsAfter += simplified.length;

    for (const [lng, lat] of simplified) {
      if (lng < bMinLng) bMinLng = lng;
      if (lat < bMinLat) bMinLat = lat;
      if (lng > bMaxLng) bMaxLng = lng;
      if (lat > bMaxLat) bMaxLat = lat;
    }
    classCount[highway]++;

    roads.push({
      id: el.id,
      highway,
      ref: tags.ref ?? '',
      name: tags.name ?? '',
      geometry: simplified,
    });
  }

  if (roads.length === 0) throw new Error('過濾後無任何道路，請檢查 Overpass 回應');

  const out = {
    version: new Date().toISOString().slice(0, 10),
    source: 'overpass-api / OpenStreetMap contributors (ODbL)',
    bbox: [round(bMinLng), round(bMinLat), round(bMaxLng), round(bMaxLat)],
    roads,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));

  const bytes = readFileSync(OUT).length;
  console.log('--- OSM 道路索引產出完成 ---');
  console.log(`道路 way   : ${roads.length}（motorway ${classCount.motorway} / trunk ${classCount.trunk}）`);
  console.log(`略過 way   : ${skipped}`);
  console.log(`座標點     : ${pointsBefore} → ${pointsAfter}（簡化率 ${(100 - (pointsAfter / pointsBefore) * 100).toFixed(1)}%）`);
  console.log(`bbox       : ${out.bbox.join(', ')}`);
  console.log(`輸出檔     : ${OUT}`);
  console.log(`檔案大小   : ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (bytes > 5 * 1024 * 1024) console.warn('⚠ 超過 5MB，建議調高 SIMPLIFY_TOLERANCE_DEG');

  // 抽樣驗證：national freeway 1/3/5 應存在
  const refs = new Set(roads.map((r) => r.ref).filter(Boolean));
  console.log(`ref 樣本    : ${[...refs].slice(0, 20).join(', ')}`);
}

main().catch((err) => {
  console.error('建置失敗：', err.message);
  process.exit(1);
});
