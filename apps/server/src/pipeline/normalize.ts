import type { ListingContext } from '@outside/shared';
import { z } from 'zod';
import { scrapeKey } from '../cache/keys';
import { CreditsExhaustedError, realFetchedAt } from '../contextdev/client';
import { NumericSchema } from '../sources/geo';
import { MapsResultsSchema, mapsSearchRequest } from '../sources/places';
import type { LatLng, SourceDeps } from '../sources/types';

export interface NormalizedPlace {
  city: string;
  country: string;
  locationText: string;
  lat: number;
  lng: number;
}

const GEOCODE_SOURCE_ID = 'geocode';
const CoordinatesSchema = z.object({ latitude: NumericSchema, longitude: NumericSchema });

/** "Alfama, Lisbon, Portugal" → city "Alfama", country "Portugal". A single part is both. */
export function splitLocation(locationText: string): { city: string; country: string } {
  const parts = locationText
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const city = parts[0] ?? locationText.trim();
  return { city, country: parts[parts.length - 1] ?? city };
}

function coordinatesOf(raw: unknown): LatLng | null {
  const parsed = CoordinatesSchema.safeParse(raw);
  return parsed.success ? { lat: parsed.data.latitude, lng: parsed.data.longitude } : null;
}

/** The first Maps result with coordinates for the listing's location text, or null. */
async function lookupCoordinates(deps: SourceDeps, locationText: string): Promise<LatLng | null> {
  const key = scrapeKey(GEOCODE_SOURCE_ID, { q: locationText.trim().toLowerCase() });
  const cached = deps.cache.get<LatLng>(key, deps.now());
  if (cached) {
    return cached.value;
  }
  return deps.dedupe(key, async () => {
    const res = await deps.client.scrape(mapsSearchRequest(locationText));
    const results = res.parsed.success === true ? MapsResultsSchema.safeParse(res.parsed.data) : null;
    const found = results?.success
      ? (results.data.results.map(coordinatesOf).find((point) => point !== null) ?? null)
      : null;
    if (found) {
      deps.cache.set(key, found, { fetchedAt: realFetchedAt(res, deps.now()) });
    }
    return found;
  });
}

/**
 * Where the video is about. Uses the listing's coordinates when it has them, otherwise asks Maps.
 * Null means the place could not be located; the caller must not guess a city.
 */
export async function normalizePlace(deps: SourceDeps, listing: ListingContext): Promise<NormalizedPlace | null> {
  const base = { ...splitLocation(listing.locationText), locationText: listing.locationText };
  if (listing.lat !== undefined && listing.lng !== undefined) {
    return { ...base, lat: listing.lat, lng: listing.lng };
  }
  try {
    const point = await lookupCoordinates(deps, listing.locationText);
    return point ? { ...base, ...point } : null;
  } catch (error: unknown) {
    if (error instanceof CreditsExhaustedError) {
      throw error;
    }
    deps.onSourceError?.(GEOCODE_SOURCE_ID, error);
    return null;
  }
}
