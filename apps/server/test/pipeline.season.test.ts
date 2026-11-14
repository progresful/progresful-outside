import type { ClimateFact } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { placeQuery, seasonOf, seasonPhotoQuery, seasonalWords } from '../src/pipeline/season';

const january = { start: '2027-01-15', end: '2027-01-20', fromListing: true };
const july = { start: '2027-07-10', end: '2027-07-17', fromListing: true };

function climate(overrides: Partial<ClimateFact> = {}): ClimateFact {
  return {
    id: 'climate:stay',
    kind: 'climate',
    month: 'January',
    tempMinC: -6,
    tempMaxC: 3,
    wetDaysPercent: 40,
    snowDaysPercent: 35,
    conditions: 'some snow',
    sourceId: 'open-meteo-archive',
    ...overrides,
  };
}

describe('seasonOf', () => {
  it.each([
    ['snow on a quarter of the days', { snowDaysPercent: 25, tempMaxC: 6 }, 'snowy'],
    ['highs at freezing', { snowDaysPercent: 0, tempMaxC: 2 }, 'snowy'],
    ['highs under 10', { snowDaysPercent: 0, tempMaxC: 9 }, 'cold'],
    ['highs under 20', { snowDaysPercent: 0, tempMaxC: 15 }, 'mild'],
    ['highs under 28', { snowDaysPercent: 0, tempMaxC: 26 }, 'warm'],
    ['highs of 28 and up', { snowDaysPercent: 0, tempMaxC: 31 }, 'hot'],
  ])('reads %s as %s', (_label, overrides, kind) => {
    expect(seasonOf(climate(overrides), january, 47).kind).toBe(kind);
  });

  it('names the season by month and hemisphere', () => {
    expect(seasonOf(climate(), january, 47)).toMatchObject({ name: 'winter', month: 'January' });
    expect(seasonOf(climate({ month: 'January', tempMaxC: 27, snowDaysPercent: 0 }), january, -33.9).name).toBe('summer');
    expect(seasonOf(climate({ month: 'July', tempMaxC: 27, snowDaysPercent: 0 }), july, 47).name).toBe('summer');
  });

  it('assumes nothing about the weather when the usual weather is not known', () => {
    // January is beach weather in Tenerife: without data, no seasonal search is safer than a wrong one.
    expect(seasonOf(undefined, january, 47)).toMatchObject({ kind: 'mild', name: 'winter', month: 'January' });
    expect(seasonOf(undefined, july, 47)).toMatchObject({ kind: 'mild', name: 'summer', month: 'July' });
    expect(seasonOf(undefined, january, -33.9)).toMatchObject({ kind: 'mild', name: 'summer' });
  });

  it('knows the weeks before Christmas', () => {
    expect(seasonOf(climate(), { start: '2026-12-10', end: '2026-12-14', fromListing: true }, 47).festive).toBe(true);
    expect(seasonOf(climate(), { start: '2026-11-15', end: '2026-11-21', fromListing: true }, 47).festive).toBe(true);
    expect(seasonOf(climate(), january, 47).festive).toBe(false);
    expect(seasonOf(climate(), { start: '2026-12-27', end: '2027-01-02', fromListing: true }, 47).festive).toBe(false);
  });
});

describe('placeQuery', () => {
  const snowy = seasonOf(climate(), january, 47);
  const mild = seasonOf(climate({ tempMaxC: 15, snowDaysPercent: 0 }), january, 38);
  const hot = seasonOf(climate({ month: 'July', tempMaxC: 31, snowDaysPercent: 0 }), july, 38);

  it('searches for what suits snow, and keeps the usual search as a fallback', () => {
    expect(placeQuery('nature', snowy)).toEqual({ query: 'winter activities', fallback: 'park' });
    expect(placeQuery('adventure', snowy)).toEqual({ query: 'ski resort', fallback: 'outdoor activities' });
    expect(placeQuery('water', snowy)).toEqual({ query: 'thermal bath', fallback: 'beach' });
    expect(placeQuery('food', snowy)).toEqual({ query: 'cosy restaurant', fallback: 'local restaurants' });
  });

  it('uses the usual search when the season changes nothing', () => {
    expect(placeQuery('nature', mild)).toEqual({ query: 'park' });
    expect(placeQuery('culture', snowy)).toEqual({ query: 'museum' });
  });

  it('searches for shade and terraces in the heat', () => {
    expect(placeQuery('food', hot)).toEqual({ query: 'restaurant with terrace', fallback: 'local restaurants' });
    expect(placeQuery('nightlife', hot)).toEqual({ query: 'rooftop bar', fallback: 'cocktail bar' });
  });

  it('looks for Christmas markets before Christmas', () => {
    const advent = seasonOf(climate(), { start: '2026-12-10', end: '2026-12-14', fromListing: true }, 47);

    expect(placeQuery('shopping', advent)).toEqual({ query: 'Christmas market', fallback: 'local market' });
    expect(placeQuery('shopping', snowy)).toEqual({ query: 'local market' });
  });
});

describe('seasonPhotoQuery', () => {
  it('asks for the place in its season, with snow when it snows', () => {
    expect(seasonPhotoQuery('Innsbruck', seasonOf(climate(), january, 47))).toBe('Innsbruck winter snow');
    expect(seasonPhotoQuery('Lisbon', seasonOf(climate({ tempMaxC: 15, snowDaysPercent: 0 }), january, 38))).toBe('Lisbon winter');
    expect(seasonPhotoQuery('Lisbon', seasonOf(climate({ month: 'July', tempMaxC: 29, snowDaysPercent: 0 }), july, 38))).toBe('Lisbon summer');
  });
});

describe('seasonalWords', () => {
  it('lists what marks an offer as right for the season', () => {
    expect(seasonalWords(seasonOf(climate(), january, 47))).toEqual(expect.arrayContaining(['ski', 'snowshoe', 'sleigh']));
    expect(seasonalWords(seasonOf(climate({ month: 'July', tempMaxC: 29, snowDaysPercent: 0 }), july, 38))).toEqual(expect.arrayContaining(['boat', 'kayak']));
    expect(seasonalWords(seasonOf(climate({ tempMaxC: 15, snowDaysPercent: 0 }), january, 38))).toEqual([]);
    expect(seasonalWords(seasonOf(climate(), { start: '2026-12-10', end: '2026-12-14', fromListing: true }, 47))).toContain('christmas');
  });
});
