import { describe, expect, it, vi } from 'vitest';
import { conditionsOf, fetchClimate, sameDatesInPastYears } from '../src/sources/climate';
import { NOW, jsonResponse, makeDeps } from './helpers';

const innsbruck = { lat: 47.2692, lng: 11.4041 };
const january = { start: '2027-01-15', end: '2027-01-20', fromListing: true };

/** One past year of the archive's daily values. */
function year(max: number[], min: number[], rain: number[], snow: number[]): unknown {
  return {
    daily: {
      time: max.map((_, index) => `2026-01-${String(12 + index).padStart(2, '0')}`),
      temperature_2m_max: max,
      temperature_2m_min: min,
      precipitation_sum: rain,
      snowfall_sum: snow,
    },
  };
}

const coldYear = year([2, 1, 4, 9], [-10, -15, -16, -3], [2.6, 2.3, 1.4, 0], [1.2, 1.6, 0.5, 0]);

describe('sameDatesInPastYears', () => {
  it('takes the stay, padded by three days, in each of the last three years', () => {
    expect(sameDatesInPastYears(january, '2026-11-14')).toEqual([
      { start: '2026-01-12', end: '2026-01-23' },
      { start: '2025-01-12', end: '2025-01-23' },
      { start: '2024-01-12', end: '2024-01-23' },
    ]);
  });

  it('skips a year whose dates have not happened yet', () => {
    const soon = { start: '2026-11-20', end: '2026-11-24', fromListing: true };

    expect(sameDatesInPastYears(soon, '2026-11-14').map((range) => range.start)).toEqual(['2025-11-17', '2024-11-17', '2023-11-17']);
  });

  it('caps a long stay at a month of history per year', () => {
    const long = { start: '2027-01-01', end: '2027-03-31', fromListing: true };
    const [first] = sameDatesInPastYears(long, '2026-11-14');

    expect(first).toEqual({ start: '2025-12-29', end: '2026-01-28' });
  });
});

describe('conditionsOf', () => {
  it.each([
    [{ snowDaysPercent: 55, wetDaysPercent: 60 }, 'snowy'],
    [{ snowDaysPercent: 20, wetDaysPercent: 30 }, 'some snow'],
    [{ snowDaysPercent: 0, wetDaysPercent: 55 }, 'often rainy'],
    [{ snowDaysPercent: 0, wetDaysPercent: 30 }, 'some rain'],
    [{ snowDaysPercent: 0, wetDaysPercent: 10 }, 'mostly dry'],
  ])('describes %j as %s', (shares, expected) => {
    expect(conditionsOf(shares)).toBe(expected);
  });
});

describe('fetchClimate', () => {
  it('averages the same dates of past years into one fact', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(coldYear));

    const result = await fetchClimate(makeDeps({ fetch: fetchMock }), { ...innsbruck, window: january, today: '2026-11-14' });

    expect(result.facts).toEqual([
      {
        id: 'climate:stay',
        kind: 'climate',
        month: 'January',
        tempMinC: -11,
        tempMaxC: 4,
        wetDaysPercent: 75,
        snowDaysPercent: 50,
        conditions: 'snowy',
        sourceId: 'open-meteo-archive',
      },
    ]);
    expect(result.source).toMatchObject({ id: 'open-meteo-archive', label: 'Open-Meteo (past years)', fetchedAt: new Date(NOW).toISOString() });
  });

  it('asks the archive for each past year at the listing coordinates', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(coldYear));

    await fetchClimate(makeDeps({ fetch: fetchMock }), { ...innsbruck, window: january, today: '2026-11-14' });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(
      'https://archive-api.open-meteo.com/v1/archive?latitude=47.2692&longitude=11.4041' +
        '&start_date=2026-01-12&end_date=2026-01-23' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=auto',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('uses the years that answered when one fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockImplementation(async () => jsonResponse(coldYear));

    const result = await fetchClimate(makeDeps({ fetch: fetchMock }), { ...innsbruck, window: january, today: '2026-11-14' });

    expect(result.facts[0]).toMatchObject({ tempMinC: -11, tempMaxC: 4 });
  });

  it('asks a year again when its first request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('stalled'))
      .mockRejectedValueOnce(new Error('stalled'))
      .mockRejectedValueOnce(new Error('stalled'))
      .mockImplementation(async () => jsonResponse(coldYear));

    const result = await fetchClimate(makeDeps({ fetch: fetchMock }), { ...innsbruck, window: january, today: '2026-11-14' });

    expect(result.facts[0]).toMatchObject({ tempMinC: -11, tempMaxC: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('returns nothing, not a throw, when no year answers', async () => {
    const onSourceError = vi.fn();
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));

    const result = await fetchClimate(makeDeps({ fetch: fetchMock, onSourceError }), { ...innsbruck, window: january, today: '2026-11-14' });

    expect(result).toEqual({ facts: [], source: null });
    expect(onSourceError).toHaveBeenCalledWith('open-meteo-archive', expect.any(Error));
  });

  it('serves the second call from cache', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(coldYear));
    const deps = makeDeps({ fetch: fetchMock });

    await fetchClimate(deps, { ...innsbruck, window: january, today: '2026-11-14' });
    await fetchClimate(deps, { ...innsbruck, window: january, today: '2026-11-14' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('names the month the stay is mostly in', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(coldYear));
    const overNewYear = { start: '2026-12-30', end: '2027-01-08', fromListing: true };

    const result = await fetchClimate(makeDeps({ fetch: fetchMock }), { ...innsbruck, window: overNewYear, today: '2026-11-14' });

    expect(result.facts[0]?.month).toBe('January');
  });
});
