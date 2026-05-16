import { describe, it, expect } from 'vitest';
import osmIndexRaw from '~shared/geo/osm-roads-index.json';
import { nearestRoadClass, getOsmIndexMeta } from './osm-roads-index';

interface TestRoad {
  highway: 'motorway' | 'trunk';
  geometry: [number, number][];
}
const idx = osmIndexRaw as unknown as { roads: TestRoad[] };

// 取某層級道路中線形最長者的中點頂點 — 中點遠離交流道，最可能與其他層級道路隔離
function midVertexOfLongest(highway: 'motorway' | 'trunk'): { lat: number; lng: number } {
  const road = idx.roads
    .filter((r) => r.highway === highway && r.geometry.length >= 3)
    .sort((a, b) => b.geometry.length - a.geometry.length)[0];
  const g = road.geometry;
  const [lng, lat] = g[Math.floor(g.length / 2)];
  return { lat, lng };
}

describe('osm-roads-index', () => {
  it('索引中介資訊：已載入且含道路與線段', () => {
    const meta = getOsmIndexMeta();
    expect(meta.loaded).toBe(true);
    expect(meta.roadCount).toBeGreaterThan(0);
    expect(meta.segmentCount).toBeGreaterThan(meta.roadCount);
    expect(meta.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('國道線形上的點 → motorway', () => {
    const p = midVertexOfLongest('motorway');
    expect(nearestRoadClass(p, 20)).toBe('motorway');
  });

  it('快速道路線形上的點 → trunk', () => {
    const p = midVertexOfLongest('trunk');
    expect(nearestRoadClass(p, 20)).toBe('trunk');
  });

  it('遠離任何道路的外海點 → other', () => {
    // 台灣海峽外海，遠在索引 bbox 西界（~120.08）之外
    expect(nearestRoadClass({ lat: 24.0, lng: 119.5 }, 2000)).toBe('other');
  });

  it('容差：道路上的點即使極小容差仍命中；遠點即使大容差仍 other', () => {
    const onMotorway = midVertexOfLongest('motorway');
    expect(nearestRoadClass(onMotorway, 1)).toBe('motorway');
    expect(nearestRoadClass({ lat: 24.0, lng: 119.5 }, 5000)).toBe('other');
  });
});
