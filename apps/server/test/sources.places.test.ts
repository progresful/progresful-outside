import { readFileSync } from 'node:fs';
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

  it('maps every usable place of the recorded Maps response', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/contextdev/places-food.json', import.meta.url), 'utf8')) as {
      parsed: { data: { results: unknown[] } };
    };
    const facts = fixture.parsed.data.results.flatMap((raw) => toPlaceFact(raw, 'food', lisbon, 's') ?? []);

    expect(facts).toHaveLength(20);
    expect(facts[0]).toMatchObject({ name: 'Time Out Market', category: 'Food court', rating: 4.4, reviewCount: 77120 });
    expect(facts.every((fact) => fact.hours !== undefined && fact.timezone === 'Europe/Lisbon')).toBe(true);
  });

  it('asks Google for the photo at video size instead of the thumbnail', () => {
    const thumb = 'https://lh3.googleusercontent.com/grass-cs/AABkmLe1Z10=w433-h240-k-no';

    expect(toPlaceFact({ ...rawPlace, google_image: thumb }, 'food', lisbon, 's')?.imageUrl).toBe(
      'https://lh3.googleusercontent.com/grass-cs/AABkmLe1Z10=w1280-h720-k-no',
    );
    expect(toPlaceFact({ ...rawPlace, google_image: 'https://lh3.googleusercontent.com/p/abc=s1600' }, 'food', lisbon, 's')?.imageUrl).toBe(
      'https://lh3.googleusercontent.com/p/abc=s1600',
    );
    expect(toPlaceFact({ ...rawPlace, google_image: 'https://example.com/a=w100-h100' }, 'food', lisbon, 's')?.imageUrl).toBe(
      'https://example.com/a=w100-h100',
    );
  });

  it('carries what kind of place it is, when Maps says', () => {
    expect(toPlaceFact(rawPlace, 'food', lisbon, 's')?.category).toBe('Food court');
    expect(toPlaceFact({ ...rawPlace, google_category: ['Market', 'Tourist attraction'] }, 'food', lisbon, 's')?.category).toBe('Market');
    expect(toPlaceFact({ ...rawPlace, google_category: [] }, 'food', lisbon, 's')).not.toHaveProperty('category');
    expect(toPlaceFact({ ...rawPlace, google_category: { odd: true } }, 'food', lisbon, 's')).not.toBeNull();
  });

  it('carries the short description Maps gives, when there is one', () => {
    const described = { ...rawPlace, google_description: ' Trendy flea market open Sundays. ' };

    expect(toPlaceFact(described, 'food', lisbon, 's')?.description).toBe('Trendy flea market open Sundays.');
    expect(toPlaceFact({ ...rawPlace, google_description: null }, 'food', lisbon, 's')).not.toHaveProperty('description');
    expect(toPlaceFact({ ...rawPlace, google_category: '  ' }, 'food', lisbon, 's')).not.toHaveProperty('category');
    expect(toPlaceFact({ ...rawPlace, google_category: null }, 'food', lisbon, 's')).not.toHaveProperty('category');
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
  const params = { interest: 'food' as const, query: 'local restaurants', locationText: 'Lisbon, Portugal', origin: lisbon };

  it('remembers the order Maps returned the places in', async () => {
    const second = { ...rawPlace, place_id: 'ChIJdef', name: 'Second' };
    const scrape = vi.fn().mockResolvedValue(scrapeResponse([rawPlace, { name: 'broken' }, second]));

    const result = await fetchPlaces(makeDeps({ client: stubClient({ scrape }) }), params);

    expect(result.facts.map((fact) => [fact.name, fact.rank])).toEqual([
      ['Mercado da Ribeira', 0],
      ['Second', 2],
    ]);
  });

  it('searches Maps for the query it is given, whatever the interest usually searches', async () => {
    const scrape = vi.fn().mockResolvedValue(scrapeResponse([rawPlace]));
    const deps = makeDeps({ client: stubClient({ scrape }) });

    await fetchPlaces(deps, { interest: 'nature', query: 'winter activities', locationText: 'Innsbruck, Austria', origin: lisbon });

    expect((scrape.mock.calls[0] as [{ url: string }])[0].url).toBe(
      'https://www.google.com/maps/search/winter%20activities%20near%20Innsbruck%2C%20Austria',
    );
  });

  it('keeps the results of two queries for one interest apart', async () => {
    const scrape = vi.fn().mockResolvedValue(scrapeResponse([rawPlace]));
    const deps = makeDeps({ client: stubClient({ scrape }) });

    await fetchPlaces(deps, { ...params, query: 'cosy restaurant' });
    await fetchPlaces(deps, { ...params, query: 'local restaurants' });
    await fetchPlaces(deps, { ...params, query: 'cosy restaurant' });

    expect(scrape).toHaveBeenCalledTimes(2);
  });

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
