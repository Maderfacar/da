import { describe, it, expect } from 'vitest';
import { decodePolyline, haversineKm, samplePointsByDistanceKm } from './polyline';

describe('decodePolyline', () => {
  it('解碼 Google 官方範例字串', () => {
    // 官方文件範例 → [(38.5,-120.2),(40.7,-120.95),(43.252,-126.453)]
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0].lat).toBeCloseTo(38.5, 5);
    expect(pts[0].lng).toBeCloseTo(-120.2, 5);
    expect(pts[2].lat).toBeCloseTo(43.252, 5);
    expect(pts[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('空字串 → 空陣列', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('haversineKm', () => {
  it('台北車站 → 高雄站 約 300km 量級', () => {
    const d = haversineKm({ lat: 25.0478, lng: 121.517 }, { lat: 22.6391, lng: 120.3025 });
    expect(d).toBeGreaterThan(280);
    expect(d).toBeLessThan(320);
  });

  it('同一點 → 0', () => {
    expect(haversineKm({ lat: 25, lng: 121 }, { lat: 25, lng: 121 })).toBe(0);
  });
});

describe('samplePointsByDistanceKm', () => {
  it('每 1km 取樣含首尾', () => {
    // 沿緯度線排 5 點，間距各約 1.11km
    const points = [0, 1, 2, 3, 4].map((i) => ({ lat: 24 + i * 0.01, lng: 121 }));
    const sampled = samplePointsByDistanceKm(points, 1);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled[sampled.length - 1]).toEqual(points[points.length - 1]);
    expect(sampled.length).toBeGreaterThanOrEqual(2);
  });

  it('maxPoints 上限生效', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ lat: 24 + i * 0.01, lng: 121 }));
    const sampled = samplePointsByDistanceKm(points, 1, 50);
    expect(sampled.length).toBeLessThanOrEqual(50);
  });

  it('空陣列 → 空陣列', () => {
    expect(samplePointsByDistanceKm([], 1)).toEqual([]);
  });
});
