import { describe, expect, it } from 'vitest';
import {
  validateVehicleProfileShape,
  type TagIndexLookupEntry,
} from './vehicleProfile';

const _buildIndex = (
  entries: Array<[string, TagIndexLookupEntry]>,
): ReadonlyMap<string, TagIndexLookupEntry> => new Map(entries);

describe('validateVehicleProfileShape', () => {
  it('returns [] for empty input', () => {
    expect(validateVehicleProfileShape({})).toEqual([]);
  });

  it('reports too_many when photos length > 8', () => {
    const photos = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.jpg`);
    const errs = validateVehicleProfileShape({ photos });
    expect(errs).toContainEqual({ field: 'photos', code: 'too_many' });
  });

  it('reports invalid for non-string photo', () => {
    const errs = validateVehicleProfileShape({ photos: ['ok.jpg', 123 as unknown as string] });
    expect(errs).toContainEqual({ field: 'photos[1]', code: 'invalid' });
  });

  it('reports invalid for non-array photos field', () => {
    const errs = validateVehicleProfileShape({ photos: 'not-array' as unknown as string[] });
    expect(errs).toContainEqual({ field: 'photos', code: 'invalid' });
  });

  it('reports invalid when tag id missing from index', () => {
    const tagIndex = _buildIndex([['t-power-ev', { group: 'power', scope: 'vehicle' }]]);
    const errs = validateVehicleProfileShape({ tags: ['t-unknown'] }, { tagIndex });
    expect(errs).toContainEqual({ field: 'tags[0]', code: 'invalid' });
  });

  it('reports mismatch when tag scope is driver (vehicleProfile only accepts vehicle scope)', () => {
    const tagIndex = _buildIndex([
      ['t-driver-en', { group: 'driverSkill', scope: 'driver' }],
    ]);
    const errs = validateVehicleProfileShape({ tags: ['t-driver-en'] }, { tagIndex });
    expect(errs).toContainEqual({ field: 'tags[0]', code: 'mismatch' });
  });

  it('reports mutex_violation when two tags belong to the same single group', () => {
    const tagIndex = _buildIndex([
      ['t-power-ev', { group: 'power', scope: 'vehicle' }],
      ['t-power-hybrid', { group: 'power', scope: 'vehicle' }],
    ]);
    const errs = validateVehicleProfileShape(
      { tags: ['t-power-ev', 't-power-hybrid'] },
      { tagIndex },
    );
    expect(errs).toContainEqual({ field: 'tags[1]', code: 'mutex_violation' });
  });

  it('accepts two tags in the same multi group (interior)', () => {
    const tagIndex = _buildIndex([
      ['t-int-captain', { group: 'interior', scope: 'vehicle' }],
      ['t-int-leather', { group: 'interior', scope: 'vehicle' }],
    ]);
    const errs = validateVehicleProfileShape(
      { tags: ['t-int-captain', 't-int-leather'] },
      { tagIndex },
    );
    expect(errs).toEqual([]);
  });

  it('accepts valid mixed tags + photos', () => {
    const tagIndex = _buildIndex([
      ['t-power-ev', { group: 'power', scope: 'vehicle' }],
      ['t-int-captain', { group: 'interior', scope: 'vehicle' }],
      ['t-int-leather', { group: 'interior', scope: 'vehicle' }],
    ]);
    const errs = validateVehicleProfileShape(
      {
        photos: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
        tags: ['t-power-ev', 't-int-captain', 't-int-leather'],
      },
      { tagIndex },
    );
    expect(errs).toEqual([]);
  });

  it('skips id-level checks when tagIndex absent (shape-only mode)', () => {
    const errs = validateVehicleProfileShape({ tags: ['unknown-id-without-index'] });
    expect(errs).toEqual([]);
  });

  it('rejects empty string photo / tag entries', () => {
    const errs = validateVehicleProfileShape({ photos: [''], tags: ['  '] });
    expect(errs).toContainEqual({ field: 'photos[0]', code: 'invalid' });
    expect(errs).toContainEqual({ field: 'tags[0]', code: 'invalid' });
  });
});
