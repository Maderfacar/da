import { describe, it, expect } from 'vitest';
import { pointInCounty, detectCounties, getCountyIndexMeta } from './county-detect';

// 各縣市深處的代表座標（遠離邊界，簡化後仍穩定）
const TAIPEI_STATION = { lat: 25.0478, lng: 121.517 };
const TAOYUAN_AIRPORT = { lat: 25.0797, lng: 121.2342 };
const TAICHUNG_CITYHALL = { lat: 24.1614, lng: 120.6478 };
const KAOHSIUNG = { lat: 22.6273, lng: 120.3014 };
const HUALIEN = { lat: 23.9871, lng: 121.6015 };
const PACIFIC_OCEAN = { lat: 24.0, lng: 123.5 };

describe('county-detect', () => {
  it('索引中介資訊：22 縣市已載入', () => {
    const meta = getCountyIndexMeta();
    expect(meta.loaded).toBe(true);
    expect(meta.countyCount).toBe(22);
  });

  it('pointInCounty：各縣市代表點正確命中', () => {
    expect(pointInCounty(TAIPEI_STATION)).toBe('TPE');
    expect(pointInCounty(TAOYUAN_AIRPORT)).toBe('TYN');
    expect(pointInCounty(TAICHUNG_CITYHALL)).toBe('TXG');
    expect(pointInCounty(KAOHSIUNG)).toBe('KHH');
    expect(pointInCounty(HUALIEN)).toBe('HUA');
  });

  it('pointInCounty：外海點回 null', () => {
    expect(pointInCounty(PACIFIC_OCEAN)).toBeNull();
  });

  it('detectCounties：依出現順序回傳穿越縣市', () => {
    const route = [TAOYUAN_AIRPORT, TAOYUAN_AIRPORT, TAIPEI_STATION];
    expect(detectCounties(route)).toEqual(['TYN', 'TPE']);
  });

  it('detectCounties：重複進入同縣市只記一次（首次出現序）', () => {
    const route = [TAIPEI_STATION, TAOYUAN_AIRPORT, TAIPEI_STATION];
    expect(detectCounties(route)).toEqual(['TPE', 'TYN']);
  });

  it('detectCounties：單一縣市內路線回傳長度 1', () => {
    const route = [TAIPEI_STATION, { lat: 25.033, lng: 121.5654 }];
    expect(detectCounties(route)).toEqual(['TPE']);
  });
});
