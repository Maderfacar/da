import { describe, it, expect } from 'vitest';
import {
  computeDriverMatch,
  buildDispatchTagIndex,
  isSoftMatch,
  type DriverTagSnapshot,
} from './orderDispatch';
import type { TagGroup } from './tagTaxonomy';

const TAG_ROWS: Array<{ id: string; name: { zh_tw: string; en?: string; ja?: string }; group: TagGroup }> = [
  { id: 't-power-ev',     name: { zh_tw: '純電', en: 'EV',     ja: 'EV' },           group: 'power' },
  { id: 't-power-hybrid', name: { zh_tw: '油電', en: 'Hybrid', ja: 'ハイブリッド' }, group: 'power' },
  { id: 't-int-captain',  name: { zh_tw: '航空椅', en: 'Captain' },                   group: 'interior' },
  { id: 't-int-leather',  name: { zh_tw: '真皮' },                                    group: 'interior' },
  { id: 't-equip-child',  name: { zh_tw: '兒童座椅' },                                 group: 'equipment' },
  { id: 't-driver-en',    name: { zh_tw: '英文', en: 'English', ja: '英語' },         group: 'driverSkill' },
];

const TAG_INDEX = buildDispatchTagIndex(TAG_ROWS);

const _driver = (vehicleProfileTags: string[], driverScopeTags: string[] = []): DriverTagSnapshot => ({
  driverId: 'Udriver-x',
  vehicleProfileTags,
  driverScopeTags,
});

describe('computeDriverMatch', () => {
  it('乘客 0 偏好 → matchCount=0、matched=[]、preferenceCount=0', () => {
    const r = computeDriverMatch([], _driver(['t-power-ev']), TAG_INDEX, 'zh_tw');
    expect(r.matchCount).toBe(0);
    expect(r.matched).toEqual([]);
    expect(r.preferenceCount).toBe(0);
  });

  it('乘客 3 偏好、driver 全擁有 → matchCount=3', () => {
    const r = computeDriverMatch(
      ['t-power-ev', 't-int-captain', 't-int-leather'],
      _driver(['t-power-ev', 't-int-captain', 't-int-leather']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(3);
    expect(r.preferenceCount).toBe(3);
    // 排序：power(1) → interior(4)；同 group 依 id
    expect(r.matched.map((m) => m.id)).toEqual(['t-power-ev', 't-int-captain', 't-int-leather']);
  });

  it('乘客 3 偏好、driver 全無 → matchCount=0', () => {
    const r = computeDriverMatch(
      ['t-power-ev', 't-int-captain', 't-int-leather'],
      _driver([]),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(0);
    expect(r.preferenceCount).toBe(3);
  });

  it('乘客 3 偏好、driver 部分擁有 → matchCount=部分', () => {
    const r = computeDriverMatch(
      ['t-power-ev', 't-int-captain', 't-int-leather'],
      _driver(['t-power-ev', 't-int-leather']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(2);
    expect(r.preferenceCount).toBe(3);
    expect(r.matched.map((m) => m.id).sort()).toEqual(['t-int-leather', 't-power-ev']);
  });

  it('archived / 不存在的 tag id → 不算 match', () => {
    const r = computeDriverMatch(
      ['t-archived-removed', 't-int-captain'],
      _driver(['t-archived-removed', 't-int-captain']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(1);
    expect(r.matched[0]?.id).toBe('t-int-captain');
  });

  it('driver-scope tag 也算 match（不分 scope）', () => {
    // 乘客理論上不會勾 driverSkill，但 server 端萬一帶進來也要正確處理
    const r = computeDriverMatch(
      ['t-driver-en'],
      _driver([], ['t-driver-en']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(1);
    expect(r.matched[0]?.id).toBe('t-driver-en');
  });

  it('lang fallback：en 缺則用繁中', () => {
    const r = computeDriverMatch(
      ['t-int-leather'], // 此 tag 只有 zh_tw
      _driver(['t-int-leather']),
      TAG_INDEX,
      'en',
    );
    expect(r.matched[0]?.name).toBe('真皮');
  });

  it('lang 命中 en', () => {
    const r = computeDriverMatch(
      ['t-power-ev'],
      _driver(['t-power-ev']),
      TAG_INDEX,
      'en',
    );
    expect(r.matched[0]?.name).toBe('EV');
  });

  it('重複 id 不重複計算', () => {
    const r = computeDriverMatch(
      ['t-power-ev', 't-power-ev', 't-int-captain'],
      _driver(['t-power-ev', 't-int-captain']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(2);
    expect(r.preferenceCount).toBe(3); // input count 仍是 3
  });

  it('vehicleProfileTags 與 driverScopeTags 取聯集；同時擁有不重複加分', () => {
    const r = computeDriverMatch(
      ['t-power-ev'],
      _driver(['t-power-ev'], ['t-power-ev']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(1);
  });
});

describe('isSoftMatch (Phase 1F)', () => {
  it('preferenceCount=0 → 不可能 soft（拍版 #4）', () => {
    expect(isSoftMatch([], { matchCount: 0 })).toBe(false);
  });

  it('preferenceCount=3、matchCount=3 → 完全命中 → 非 soft', () => {
    expect(isSoftMatch(['a', 'b', 'c'], { matchCount: 3 })).toBe(false);
  });

  it('preferenceCount=3、matchCount=2 → 部分命中 → soft', () => {
    expect(isSoftMatch(['a', 'b', 'c'], { matchCount: 2 })).toBe(true);
  });

  it('preferenceCount=3、matchCount=0 → 0 命中也算 soft（拍版 #3）', () => {
    expect(isSoftMatch(['a', 'b', 'c'], { matchCount: 0 })).toBe(true);
  });

  it('matchCount > preferenceCount（理論上不會發生）→ 視為非 soft', () => {
    expect(isSoftMatch(['a'], { matchCount: 5 })).toBe(false);
  });
});

describe('buildDispatchTagIndex', () => {
  it('忽略空 id', () => {
    const map = buildDispatchTagIndex([
      ...TAG_ROWS,
      { id: '', name: { zh_tw: '空' }, group: 'power' },
    ]);
    expect(map.size).toBe(TAG_ROWS.length);
  });

  // ─── Phase 1G 邊界補強 ─────────────────────────────────────
  it('Phase 1G — preferenceTagIds 含 null/空字串 → 忽略不算', () => {
    const r = computeDriverMatch(
      // @ts-expect-error 模擬 firestore array 含意外值
      [null, '', 't-power-ev'],
      _driver(['t-power-ev']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(1);
    expect(r.matched[0]?.id).toBe('t-power-ev');
  });

  it('Phase 1G — tagIndex 為空 map → matched=[]，但 preferenceCount 仍是 input length', () => {
    const empty = buildDispatchTagIndex([]);
    const r = computeDriverMatch(
      ['t-power-ev', 't-int-captain'],
      _driver(['t-power-ev', 't-int-captain']),
      empty,
      'zh_tw',
    );
    expect(r.matchCount).toBe(0);
    expect(r.matched).toEqual([]);
    expect(r.preferenceCount).toBe(2);
  });

  it('Phase 1G — preferenceTagIds 非陣列 → 不崩潰、回 0 命中', () => {
    const r = computeDriverMatch(
      // @ts-expect-error 模擬 server bug
      null,
      _driver(['t-power-ev']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(0);
    expect(r.preferenceCount).toBe(0);
  });

  it('Phase 1G — driver 雙陣列皆 undefined → 不崩潰、回 0 命中', () => {
    const r = computeDriverMatch(
      ['t-power-ev'],
      // @ts-expect-error 模擬 driver doc 缺欄
      { driverId: 'X', vehicleProfileTags: undefined, driverScopeTags: undefined },
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(0);
    expect(r.preferenceCount).toBe(1);
  });

  it('Phase 1G — sort 跨 group 穩定（power→interior→equipment→driverSkill）', () => {
    const r = computeDriverMatch(
      ['t-equip-child', 't-int-captain', 't-power-ev', 't-driver-en'],
      _driver(['t-equip-child', 't-int-captain', 't-power-ev'], ['t-driver-en']),
      TAG_INDEX,
      'zh_tw',
    );
    expect(r.matchCount).toBe(4);
    const groups = r.matched.map((m) => m.group);
    expect(groups).toEqual(['power', 'interior', 'equipment', 'driverSkill']);
  });

  it('Phase 1G — ja lang 命中（與 en fallback 對照）', () => {
    const r = computeDriverMatch(
      ['t-power-hybrid'],
      _driver(['t-power-hybrid']),
      TAG_INDEX,
      'ja',
    );
    expect(r.matched[0]?.name).toBe('ハイブリッド');
  });

  it('Phase 1G — isSoftMatch：match.matchCount undefined → 視為 0 → 0 < pref → soft', () => {
    // @ts-expect-error 容錯：呼叫端忘了帶 matchCount
    expect(isSoftMatch(['a', 'b'], {})).toBe(true);
  });
});
