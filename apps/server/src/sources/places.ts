import { interestById, type InterestId, type PlaceFact, type Source } from '@outside/shared';
import tzlookup from 'tz-lookup';
import { z } from 'zod';
import { scrapeKey } from '../cache/keys';
import { CreditsExhaustedError, realFetchedAt } from '../contextdev/client';
import { haversineM, round2 } from './geo';
import { emptyResult, type LatLng, type SourceDeps, type SourceResult } from './types';

export { haversineM } from './geo';

const MAPS_SEARCH = 'https://www.google.com/maps/search/';

/** A number, or a numeric string. Null and blank are not numbers. */
const Numeric = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

/** The fields we use from Context.dev's prebuilt google-maps parser. */
const RawPlaceSchema = z.object({
  place_id: z.string().min(1),
  name: z.string().min(1),
  rating: Numeric.refine((value) => value > 0),
  number_of_reviews: Numeric.nullish().transform((value) => value ?? 0),
  latitude: Numeric,
  longitude: Numeric,
  google_image: z.url(),
});

const ResultsSchema = z.object({ results: z.array(z.unknown()) });

export interface PlacesParams {
  interest: InterestId;
  locationText: string;
  origin: LatLng;
}

export function placesUrl(query: string, locationText: string): string {
  return `${MAPS_SEARCH}${encodeURIComponent(`${query} near ${locationText}`)}`;
}

function timezoneAt(point: LatLng): string | undefined {
  try {
    return tzlookup(point.lat, point.lng);
  } catch {
    // Coordinates outside the valid range have no timezone; the open-now chip is simply left out.
    return undefined;
  }
}

/** Null when the record lacks a name, rating, coordinates or image: such a place cannot fill a scene. */
export function toPlaceFact(raw: unknown, interest: InterestId, origin: LatLng, sourceId: string): PlaceFact | null {
  const parsed = RawPlaceSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const place = parsed.data;
  const point = { lat: place.latitude, lng: place.longitude };
  return {
    id: `place:${place.place_id}`,
    kind: 'place',
    interest,
    name: place.name,
    rating: place.rating,
    reviewCount: place.number_of_reviews,
    lat: point.lat,
    lng: point.lng,
    imageUrl: place.google_image,
    distanceM: Math.round(haversineM(origin, point)),
    timezone: timezoneAt(point),
    sourceId,
  };
}

/** Cached places are shared by nearby listings, so distances are always recomputed for the asking listing. */
function withDistances(result: SourceResult<PlaceFact>, origin: LatLng): SourceResult<PlaceFact> {
  return {
    ...result,
    facts: result.facts.map((fact) => ({ ...fact, distanceM: Math.round(haversineM(origin, fact)) })),
  };
}

async function scrapePlaces(
  deps: SourceDeps,
  p: PlacesParams,
  sourceId: string,
  key: string,
): Promise<SourceResult<PlaceFact>> {
  const query = interestById(p.interest).mapsQueries[0] ?? p.interest;
  const url = placesUrl(query, p.locationText);
  const res = await deps.client.scrape({
    url,
    formats: { parse: true },
    parseParams: { type: 'prebuilt', parser: 'google-maps' },
  });
  const results = res.parsed.success === true ? ResultsSchema.safeParse(res.parsed.data) : null;
  if (!results?.success) {
    return emptyResult();
  }
  const facts = results.data.results
    .map((raw) => toPlaceFact(raw, p.interest, p.origin, sourceId))
    .filter((fact): fact is PlaceFact => fact !== null);
  const fetchedAt = realFetchedAt(res, deps.now());
  const source: Source = { id: sourceId, label: 'Google Maps', url, fetchedAt: new Date(fetchedAt).toISOString() };
  const result = { facts, source };
  if (facts.length > 0) {
    deps.cache.set(key, result, { fetchedAt });
  }
  return result;
}

/** Places for one interest near the listing. A failed scrape yields nothing; exhausted credits propagate. */
export async function fetchPlaces(deps: SourceDeps, p: PlacesParams): Promise<SourceResult<PlaceFact>> {
  const sourceId = `google-maps:${p.interest}`;
  const key = scrapeKey('places', {
    interest: p.interest,
    lat: round2(p.origin.lat),
    lng: round2(p.origin.lng),
  });
  const cached = deps.cache.get<SourceResult<PlaceFact>>(key, deps.now());
  if (cached) {
    return withDistances(cached.value, p.origin);
  }
  try {
    const fresh = await deps.dedupe(key, () => scrapePlaces(deps, p, sourceId, key));
    return withDistances(fresh, p.origin);
  } catch (error: unknown) {
    if (error instanceof CreditsExhaustedError) {
      throw error;
    }
    deps.onSourceError?.(sourceId, error);
    return emptyResult();
  }
}
