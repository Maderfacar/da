// 訂單需求單 / 司機喊單配對 — Phase 1E（前後端共用純函式）
//
// 設計：
//   - admin 看 bids 時即時計算 matchCount（不存進 bid，避免 driver 改車輛後失準）
//   - 命中規則：交集就是交集，不分 scope。乘客 preference（vehicle-scope）對上司機
//     `vehicleProfile.tags + driver-scope tags` 任一相符即 +1
//   - 缺翻譯 fallback 繁中（與 1A localizedTagName 一致）

import { TAG_GROUPS, type TagGroup, type TagLang } from './tagTaxonomy';

export interface DriverTagSnapshot {
  driverId: string;
  /** vehicleProfile.tags（vehicle-scope；admin 已 approve 的版本） */
  vehicleProfileTags: string[];
  /** driver-scope tags（driverSkill；driver 自編，立即生效） */
  driverScopeTags: string[];
}

export interface MatchedTag {
  id: string;
  name: string;
  group: TagGroup;
}

export interface DriverMatchResult {
  matchCount: number;
  matched: MatchedTag[];
  preferenceCount: number;
}

export interface DispatchTagIndexEntry {
  id: string;
  name: { zh_tw: string; en?: string; ja?: string };
  group: TagGroup;
}

/**
 * 計算單一司機對某筆訂單偏好的命中標籤數。
 *
 * 規則：
 *   - 司機可用 tag = `vehicleProfileTags ∪ driverScopeTags`（去重）
 *   - matched = preferenceTagIds.filter(id => driver 擁有 && tagIndex 內存在)
 *   - 不存在於 tagIndex 的 id（archived / 已刪 / 拼錯）一律忽略
 *   - sort：依 group.sortOrder → id（穩定排序，方便 UI 顯示）
 */
export function computeDriverMatch(
  preferenceTagIds: ReadonlyArray<string>,
  driver: DriverTagSnapshot,
  tagIndex: ReadonlyMap<string, DispatchTagIndexEntry>,
  lang: TagLang,
): DriverMatchResult {
  const preferenceCount = Array.isArray(preferenceTagIds) ? preferenceTagIds.length : 0;
  if (preferenceCount === 0) {
    return { matchCount: 0, matched: [], preferenceCount: 0 };
  }

  const driverOwned = new Set<string>([
    ...(Array.isArray(driver.vehicleProfileTags) ? driver.vehicleProfileTags : []),
    ...(Array.isArray(driver.driverScopeTags) ? driver.driverScopeTags : []),
  ]);

  const seen = new Set<string>();
  const matched: MatchedTag[] = [];
  for (const id of preferenceTagIds) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!driverOwned.has(id)) continue;
    const entry = tagIndex.get(id);
    if (!entry) continue;
    matched.push({
      id: entry.id,
      name: entry.name[lang]?.trim() || entry.name.zh_tw,
      group: entry.group,
    });
  }

  matched.sort((a, b) => {
    const ga = TAG_GROUPS[a.group]?.sortOrder ?? 0;
    const gb = TAG_GROUPS[b.group]?.sortOrder ?? 0;
    if (ga !== gb) return ga - gb;
    return a.id.localeCompare(b.id);
  });

  return {
    matchCount: matched.length,
    matched,
    preferenceCount,
  };
}

/**
 * 從 active tags collection DTO 陣列建 DispatchTagIndexEntry map。
 *
 * 注意：本 helper 對「scope」不做過濾，因為 1E 配對允許 driver-scope 命中
 * 乘客 preference（雖然乘客只能勾 vehicle-scope，但實際資料若已有 driver-scope id
 * 存進 order.preferences.tagIds 也應該被計入；1D snapshot 邏輯已過濾，這裡守第二道）。
 */
export function buildDispatchTagIndex(
  tags: ReadonlyArray<{ id: string; name: { zh_tw: string; en?: string; ja?: string }; group: TagGroup }>,
): Map<string, DispatchTagIndexEntry> {
  const map = new Map<string, DispatchTagIndexEntry>();
  for (const t of tags) {
    if (!t || typeof t.id !== 'string' || t.id.length === 0) continue;
    map.set(t.id, {
      id: t.id,
      name: {
        zh_tw: t.name?.zh_tw ?? '',
        ...(t.name?.en ? { en: t.name.en } : {}),
        ...(t.name?.ja ? { ja: t.name.ja } : {}),
      },
      group: t.group,
    });
  }
  return map;
}
