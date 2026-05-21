import { describe, it, expect } from 'vitest';
import {
  validateOrderPreferencesShape,
  buildPreferencesSnapshot,
  type FullTagDocForSnapshot,
} from './orderPreferences';
import { buildTagSurchargeIndex } from './pricing';

const TAGS: FullTagDocForSnapshot[] = [
  { id: 't-power-ev',     name: { zh_tw: '純電', en: 'EV', ja: 'EV' },         group: 'power',     scope: 'vehicle', surchargeAmount: 100, status: 'active', sortOrder: 1 },
  { id: 't-power-hybrid', name: { zh_tw: '油電' },                                group: 'power',     scope: 'vehicle', surchargeAmount: 50,  status: 'active', sortOrder: 2 },
  { id: 't-int-captain',  name: { zh_tw: '航空椅', en: 'Captain' },              group: 'interior',  scope: 'vehicle', surchargeAmount: 300, status: 'active', sortOrder: 1 },
  { id: 't-int-leather',  name: { zh_tw: '真皮' },                                group: 'interior',  scope: 'vehicle', surchargeAmount: 200, status: 'active', sortOrder: 2 },
  { id: 't-archived',     name: { zh_tw: '已封存' },                              group: 'power',     scope: 'vehicle', surchargeAmount: 999, status: 'archived', sortOrder: 9 },
  { id: 't-driver-en',    name: { zh_tw: '英文' },                                group: 'driverSkill', scope: 'driver', surchargeAmount: 999, status: 'active', sortOrder: 1 },
];

const INDEX = buildTagSurchargeIndex(TAGS);
const FULL_INDEX = new Map<string, FullTagDocForSnapshot>(TAGS.map((t) => [t.id, t]));

describe('validateOrderPreferencesShape', () => {
  it('空 / undefined → no error', () => {
    expect(validateOrderPreferencesShape({}, INDEX)).toEqual([]);
    expect(validateOrderPreferencesShape({ tagIds: [] }, INDEX)).toEqual([]);
  });

  it('single group 多選 → mutex_violation', () => {
    const errs = validateOrderPreferencesShape({ tagIds: ['t-power-ev', 't-power-hybrid'] }, INDEX);
    expect(errs).toContainEqual({ field: 'tagIds[1]', code: 'mutex_violation' });
  });

  it('multi group 多選 → 通過', () => {
    const errs = validateOrderPreferencesShape({ tagIds: ['t-int-captain', 't-int-leather'] }, INDEX);
    expect(errs).toEqual([]);
  });

  it('不存在 id → 不算 mutex 錯誤（後續 calcTagSurcharge 處理）', () => {
    const errs = validateOrderPreferencesShape({ tagIds: ['t-not-found'] }, INDEX);
    expect(errs).toEqual([]);
  });

  it('空字串 id → invalid', () => {
    const errs = validateOrderPreferencesShape({ tagIds: ['', 't-power-ev'] }, INDEX);
    expect(errs).toContainEqual({ field: 'tagIds[0]', code: 'invalid' });
  });

  it('非陣列 → invalid', () => {
    const errs = validateOrderPreferencesShape(
      { tagIds: 'not-array' as unknown as string[] },
      INDEX,
    );
    expect(errs).toContainEqual({ field: 'tagIds', code: 'invalid' });
  });
});

describe('buildPreferencesSnapshot', () => {
  it('空 input → snapshot 全空、surcharge=0', () => {
    const s = buildPreferencesSnapshot({}, FULL_INDEX);
    expect(s.tagIds).toEqual([]);
    expect(s.tagSnapshot).toEqual([]);
    expect(s.tagSurcharge).toBe(0);
    expect(s.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('多選正常 → snapshot 依 group.sortOrder → tag.sortOrder 排序、surcharge=max', () => {
    const s = buildPreferencesSnapshot(
      { tagIds: ['t-int-leather', 't-power-ev', 't-int-captain'] },
      FULL_INDEX,
    );
    // power.sortOrder=1, interior.sortOrder=4；power 排前
    expect(s.tagSnapshot.map((t) => t.id)).toEqual(['t-power-ev', 't-int-captain', 't-int-leather']);
    expect(s.tagSurcharge).toBe(300); // max(100, 300, 200)
    expect(s.tagIds).toEqual(['t-int-leather', 't-power-ev', 't-int-captain']);
  });

  it('archived / driver-scope / unknown → 不入 snapshot；tagSurcharge 用剩下的', () => {
    const s = buildPreferencesSnapshot(
      { tagIds: ['t-archived', 't-driver-en', 't-not-found', 't-int-captain'] },
      FULL_INDEX,
    );
    expect(s.tagSnapshot.length).toBe(1);
    expect(s.tagSnapshot[0]?.id).toBe('t-int-captain');
    expect(s.tagSurcharge).toBe(300);
    // tagIds 原值保留（用來除錯）
    expect(s.tagIds).toEqual(['t-archived', 't-driver-en', 't-not-found', 't-int-captain']);
  });

  it('name snapshot 含三語完整快照（缺欄位省略）', () => {
    const s = buildPreferencesSnapshot({ tagIds: ['t-power-ev', 't-power-hybrid'] }, FULL_INDEX);
    // mutex 不阻擋 snapshot（validateOrderPreferencesShape 已 catch；這邊純算）
    // 但這 case 是 single group 兩個 → max 取大
    const found = s.tagSnapshot.find((t) => t.id === 't-power-ev');
    expect(found?.name).toEqual({ zh_tw: '純電', en: 'EV', ja: 'EV' });
    const hybrid = s.tagSnapshot.find((t) => t.id === 't-power-hybrid');
    expect(hybrid?.name).toEqual({ zh_tw: '油電' }); // 無 en/ja → 不寫
  });

  it('全部無效 → tagSnapshot=[]、tagSurcharge=0', () => {
    const s = buildPreferencesSnapshot(
      { tagIds: ['t-archived', 't-driver-en', 't-bogus'] },
      FULL_INDEX,
    );
    expect(s.tagSnapshot).toEqual([]);
    expect(s.tagSurcharge).toBe(0);
  });

  // ─── Phase 1G 邊界補強 ─────────────────────────────────────
  it('Phase 1G — snapshotAt 是合法 ISO timestamp（時序內 < 1s）', () => {
    const before = Date.now();
    const s = buildPreferencesSnapshot({ tagIds: ['t-power-ev'] }, FULL_INDEX);
    const after = Date.now();
    const ts = Date.parse(s.snapshotAt);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('Phase 1G — multi multiplicity group（interior）同時兩個 → 不算 mutex（pass）', () => {
    const errs = validateOrderPreferencesShape(
      { tagIds: ['t-int-captain', 't-int-leather'] },
      INDEX,
    );
    expect(errs).toEqual([]);
    // snapshot 也應雙雙列入
    const s = buildPreferencesSnapshot({ tagIds: ['t-int-captain', 't-int-leather'] }, FULL_INDEX);
    expect(s.tagSnapshot.length).toBe(2);
    expect(s.tagSurcharge).toBe(300); // max(300, 200)
  });

  it('Phase 1G — driver-scope id 帶入 snapshot input → 不入 snapshot、不影響 surcharge', () => {
    const s = buildPreferencesSnapshot(
      { tagIds: ['t-driver-en', 't-int-captain'] },
      FULL_INDEX,
    );
    expect(s.tagSnapshot.map((t) => t.id)).toEqual(['t-int-captain']);
    expect(s.tagSurcharge).toBe(300);
    // 原 tagIds 保留（除錯用）
    expect(s.tagIds).toEqual(['t-driver-en', 't-int-captain']);
  });

  it('Phase 1G — input.tagIds = undefined → 不崩潰、回 empty snapshot', () => {
    const s = buildPreferencesSnapshot({ tagIds: undefined }, FULL_INDEX);
    expect(s.tagIds).toEqual([]);
    expect(s.tagSnapshot).toEqual([]);
    expect(s.tagSurcharge).toBe(0);
  });

  it('Phase 1G — validateOrderPreferencesShape：mutex 不影響非 single multiplicity group', () => {
    // driverSkill 也是 multi（理論上乘客不會勾，但確保資料異常時不誤判 mutex）
    const errs = validateOrderPreferencesShape(
      { tagIds: ['t-driver-en'] },
      INDEX,
    );
    expect(errs).toEqual([]); // scope!==vehicle → 不檢 mutex
  });
});
