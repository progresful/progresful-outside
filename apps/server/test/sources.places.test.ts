import { describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError } from '../src/contextdev/client';
import { fetchPlaces, haversineM, placesUrl, toPlaceFact } from '../src/sources/places';
import { NOW, makeDeps, stubClient } from './helpers';

const lisbon = { lat: 38.7223, lng: -9.1393 };

/** Field names as documented for Context.dev's prebuilt google-maps parser. */
const rawPlace = {
  place_id: 'ChIJabc',
  name: 'Mercado da Ribeira',
  rating: 4.5,
  number_of_reviews: 1240,
  latitude: 38.7069,
  longitude: -9.1459,
  google_image: 'https://lh3.googleusercontent.com/p/abc=w800',
  google_category: 'Food court',
};

function scrapeResponse(results: unknown[], ageMs = 0): unknown {
  return {
    url: 'https://www.google.com/maps/search/x',
    parsed: { success: true, data: { results } },
    json: { success: null, data: null },
    images: { success: null, data: null },
    cache_metadata: { status: ageMs > 0 ? 'hit' : 'miss', age_ms: ageMs },
  };
}

describe('placesUrl', () => {
  it('builds the maps search url', () => {
    expect(placesUrl('food market', 'Lisbon, Portugal')).toBe(
      'https://www.google.com/maps/search/food%20market%20near%20Lisbon%2C%20Portugal',
    );
  });
});

describe('haversineM', () => {
  it('measures a known distance', () => {
    const sintra = { lat: 38.8029, lng: -9.3817 };
    expect(haversineM(lisbon, sintra)).toBeGreaterThan(22_000);
    expect(haversineM(lisbon, sintra)).toBeLessThan(24_000);
  });

  it('is zero for the same point', () => {
    expect(haversineM(lisbon, lisbon)).toBe(0);
  });
});

describe('toPlaceFact', () => {
  it('maps a parser record to a PlaceFact with distance and timezone', () => {
    const fact = toPlaceFact(rawPlace, 'food', lisbon, 'google-maps:food');

    expect(fact).toMatchObject({
      id: 'place:ChIJabc',
      kind: 'place',
      interest: 'food',
      name: 'Mercado da Ribeira',
      rating: 4.5,
      reviewCount: 1240,
      lat: 38.7069,
      lng: -9.1459,
      imageUrl: 'https://lh3.googleusercontent.com/p/abc=w800',
      timezone: 'Europe/Lisbon',
      sourceId: 'google-maps:food',
    });
    expect(fact?.distanceM).toBeGreaterThan(1_500);
    expect(fact?.distanceM).toBeLessThan(2_000);
  });

  it('accepts numbers that arrive as strings', () => {
    const fact = toPlaceFact({ ...rawPlace, rating: '4.5', number_of_reviews: '1240' }, 'food', lisbon, 's');
    expect([fact?.rating, fact?.reviewCount]).toEqual([4.5, 1240]);
  });

  it.each([
    ['no image', { ...rawPlace, google_image: null }],
    ['no rating', { ...rawPlace, rating: null }],
    ['no coordinates', { ...rawPlace, latitude: null }],
    ['no name', { ...rawPlace, name: '' }],
    ['no place id', { ...rawPlace, place_id: undefined }],
    ['a non-object', 'nope'],
  ])('drops a record with %s', (_name, raw) => {
    expect(toPlaceFact(raw, 'food', lisbon, 's')).toBeNull();
  });
});

describe('fetchPlaces', () => {
  const params = { interest: 'food' as const, locationText: 'Lisbon, Portugal', origin: lisbon };

  it('scrapes maps with the prebuilt parser and returns facts with their source', async () => {
    const scrape = vi.fn().mockResolvedValue(scrapeResponse([rawPlace, { name: 'broken' }], 60_000));
    const deps = makeDeps({ client: stubClient({ scrape }) });

    const result = await fetchPlaces(deps, params);

    expect(scrape).toHaveBeenCalledWith({
      url: 'https://www.google.com/maps/search/local%20restaurants%20near%20Lisbon%2C%20Portugal',
      formats: { parse: true },
      parseParams: { type: 'prebuilt', parser: 'google-maps' },
    });
    expect(result.facts.map((fact) => fact.name)).toEqual(['Mercado da Ribeira']);
    expect(result.source).toEqual({
      id: 'google-maps:food',
      label: 'Google Maps',
      url: 'https://www.google.com/maps/search/local%20restaurants%20near%20Lisbon%2C%20Portugal',
      fetchedAt: new Date(NOW - 60_000).toISOString(),
    });
  });

  it('serves a nearby listing from the cache, with its own distances', async () => {
    const scrape = vi.fn().mockImplementation(async () => scrapeResponse([rawPlace]));
    const deps = makeDeps({ client: stubClient({ scrape }) });

    const first = await fetchPlaces(deps, params);
    const neighbour = { lat: lisbon.lat + 0.002, lng: lisbon.lng };
    const second = await fetchPlaces(deps, { ...params, origin: neighbour });

    expect(scrape).toHaveBeenCalledTimes(1);
    expect(second.source).toEqual(first.source);
    expect(second.facts[0]?.distanceM).toBeGreaterThan(first.facts[0]?.distanceM ?? 0);
  });

  it('returns nothing, and reports why, when the scrape fails', async () => {
    const onSourceError = vi.fn();
    const scrape = vi.fn().mockRejectedValue(new Error('timeout'));
    const deps = makeDeps({ client: stubClient({ scrape }), onSourceError });

    expect(await fetchPlaces(deps, params)).toEqual({ facts: [], source: null });
    expect(onSourceError).toHaveBeenCalledWith('google-maps:food', expect.any(Error));
  });

  it('returns nothing when the parser output failed', async () => {
    const failed = { parsed: { success: false, data: null, error_code: 'PARSE_FAILED' } };
    const deps = makeDeps({ client: stubClient({ scrape: vi.fn().mockResolvedValue(failed) }) });

    expect(await fetchPlaces(deps, params)).toEqual({ facts: [], source: null });
  });

  it('lets exhausted credits through instead of hiding them', async () => {
    const scrape = vi.fn().mockRejectedValue(new CreditsExhaustedError());
    const deps = makeDeps({ client: stubClient({ scrape }) });

    await expect(fetchPlaces(deps, params)).rejects.toBeInstanceOf(CreditsExhaustedError);
  });
});
