import { describe, expect, it, vi } from 'vitest';
import { fetchWeather } from '../src/sources/weather';
import { NOW, TODAY, jsonResponse, makeDeps } from './helpers';

const lisbon = { lat: 38.7223, lng: -9.1393 };
const nearWindow = { start: '2026-11-16', end: '2026-11-18', fromListing: true };

const daily = {
  daily: {
    time: ['2026-11-16', '2026-11-17', '2026-11-18'],
    temperature_2m_max: [15.2, 17.4, 16.1],
    temperature_2m_min: [9.6, 8.3, 10.2],
    precipitation_probability_max: [20, 60, 40],
  },
};

describe('fetchWeather', () => {
  it('reduces the daily values to one fact', async () => {
    const deps = makeDeps({ fetch: vi.fn().mockResolvedValue(jsonResponse(daily)) });

    const result = await fetchWeather(deps, { ...lisbon, window: nearWindow, today: TODAY });

    expect(result.facts).toEqual([
      { id: 'weather:stay', kind: 'weather', tempMinC: 8, tempMaxC: 17, precipitationChance: 60, sourceId: 'open-meteo' },
    ]);
    expect(result.source).toEqual({
      id: 'open-meteo',
      label: 'Open-Meteo',
      url: 'https://open-meteo.com',
      fetchedAt: new Date(NOW).toISOString(),
    });
  });

  it('asks Open-Meteo for the stay dates at the listing coordinates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(daily));

    await fetchWeather(makeDeps({ fetch: fetchMock }), { ...lisbon, window: nearWindow, today: TODAY });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=38.7223&longitude=-9.1393' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&start_date=2026-11-16&end_date=2026-11-18&timezone=auto',
    );
  });

  it('clamps the end date to 15 days from today', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(daily));
    const window = { start: '2026-11-24', end: '2026-12-05', fromListing: true };

    await fetchWeather(makeDeps({ fetch: fetchMock }), { ...lisbon, window, today: TODAY });

    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('start_date=2026-11-24&end_date=2026-11-29');
  });

  it('returns no weather for a stay more than 15 days out, without calling fetch', async () => {
    const fetchMock = vi.fn();
    const window = { start: '2026-12-12', end: '2026-12-16', fromListing: true };

    const result = await fetchWeather(makeDeps({ fetch: fetchMock }), { ...lisbon, window, today: TODAY });

    expect(result).toEqual({ facts: [], source: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores missing daily values', async () => {
    const sparse = {
      daily: {
        temperature_2m_max: [15.2, null],
        temperature_2m_min: [null, 8.3],
        precipitation_probability_max: [null, null],
      },
    };
    const deps = makeDeps({ fetch: vi.fn().mockResolvedValue(jsonResponse(sparse)) });

    const result = await fetchWeather(deps, { ...lisbon, window: nearWindow, today: TODAY });

    expect(result.facts[0]).toMatchObject({ tempMinC: 8, tempMaxC: 15, precipitationChance: 0 });
  });

  it.each([
    ['a failed request', () => vi.fn().mockResolvedValue(jsonResponse({}, 500))],
    ['a network error', () => vi.fn().mockRejectedValue(new Error('offline'))],
    ['a body with no temperatures', () => vi.fn().mockResolvedValue(jsonResponse({ daily: {} }))],
  ])('returns no facts, not a throw, on %s', async (_name, makeFetch) => {
    const result = await fetchWeather(makeDeps({ fetch: makeFetch() }), { ...lisbon, window: nearWindow, today: TODAY });

    expect(result).toEqual({ facts: [], source: null });
  });

  it('serves a repeat call from the cache', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(daily));
    const deps = makeDeps({ fetch: fetchMock });
    const params = { ...lisbon, window: nearWindow, today: TODAY };

    const first = await fetchWeather(deps, params);
    const second = await fetchWeather(deps, params);

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
