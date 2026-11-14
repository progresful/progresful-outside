import type { ListingContext } from '@outside/shared';
import { describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError } from '../src/contextdev/client';
import { normalizePlace, splitLocation } from '../src/pipeline/normalize';
import { makeDeps, stubClient } from './helpers';

const listing: ListingContext = {
  site: 'airbnb',
  listingId: '1',
  url: 'https://www.airbnb.com/rooms/1',
  title: 'Flat with a view',
  locationText: 'Sintra, Portugal',
  photos: [],
};

function mapsResponse(results: unknown[]): unknown {
  return { parsed: { success: true, data: { results } }, cache_metadata: { status: 'miss', age_ms: 0 } };
}

describe('splitLocation', () => {
  it.each([
    ['Lisbon, Portugal', { city: 'Lisbon', country: 'Portugal' }],
    ['Alfama, Lisbon, Portugal', { city: 'Alfama', country: 'Portugal' }],
    ['  Lisbon ,  Portugal ', { city: 'Lisbon', country: 'Portugal' }],
    ['Portugal', { city: 'Portugal', country: 'Portugal' }],
  ])('splits %j', (text, expected) => {
    expect(splitLocation(text)).toEqual(expected);
  });
});

describe('normalizePlace', () => {
  it('uses listing coordinates when present, without a lookup', async () => {
    const scrape = vi.fn();
    const deps = makeDeps({ client: stubClient({ scrape }) });

    const place = await normalizePlace(deps, { ...listing, lat: 38.8, lng: -9.39 });

    expect(place).toEqual({ city: 'Sintra', country: 'Portugal', locationText: 'Sintra, Portugal', lat: 38.8, lng: -9.39 });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('geocodes a location with no coordinates through Maps', async () => {
    const scrape = vi
      .fn()
      .mockResolvedValue(mapsResponse([{ name: 'no coords' }, { latitude: 38.8029, longitude: '-9.3817' }]));
    const deps = makeDeps({ client: stubClient({ scrape }) });

    const place = await normalizePlace(deps, listing);

    expect(scrape).toHaveBeenCalledWith({
      url: 'https://www.google.com/maps/search/Sintra%2C%20Portugal',
      formats: { parse: true },
      parseParams: { type: 'prebuilt', parser: 'google-maps' },
    });
    expect(place).toMatchObject({ city: 'Sintra', country: 'Portugal', lat: 38.8029, lng: -9.3817 });
  });

  it('returns null for a location Maps cannot resolve', async () => {
    const deps = makeDeps({ client: stubClient({ scrape: vi.fn().mockResolvedValue(mapsResponse([])) }) });

    expect(await normalizePlace(deps, { ...listing, locationText: 'Entire home in Portugal' })).toBeNull();
  });

  it('returns null, and reports why, when the lookup fails', async () => {
    const onSourceError = vi.fn();
    const deps = makeDeps({
      client: stubClient({ scrape: vi.fn().mockRejectedValue(new Error('timeout')) }),
      onSourceError,
    });

    expect(await normalizePlace(deps, listing)).toBeNull();
    expect(onSourceError).toHaveBeenCalledWith('geocode', expect.any(Error));
  });

  it('lets exhausted credits through', async () => {
    const deps = makeDeps({ client: stubClient({ scrape: vi.fn().mockRejectedValue(new CreditsExhaustedError()) }) });

    await expect(normalizePlace(deps, listing)).rejects.toBeInstanceOf(CreditsExhaustedError);
  });

  it('remembers a lookup for the same location text', async () => {
    const scrape = vi.fn().mockImplementation(async () => mapsResponse([{ latitude: 38.8029, longitude: -9.3817 }]));
    const deps = makeDeps({ client: stubClient({ scrape }) });

    await normalizePlace(deps, listing);
    await normalizePlace(deps, { ...listing, listingId: '2', locationText: 'sintra, portugal' });

    expect(scrape).toHaveBeenCalledTimes(1);
  });
});
