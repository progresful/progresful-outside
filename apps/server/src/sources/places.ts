import type { InterestId, PlaceActivity, PlaceFact, Source } from '@outside/shared';
import tzlookup from 'tz-lookup';
import { z } from 'zod';
import { scrapeKey } from '../cache/keys';
import { CreditsExhaustedError, realFetchedAt } from '../contextdev/client';
import { NumericSchema, haversineM, round2 } from './geo';
import { parseGoogleHours } from './hours';
import { emptyResult, type LatLng, type SourceDeps, type SourceResult } from './types';

export { haversineM } from './geo';

const MAPS_SEARCH = 'https://www.google.com/maps/search/';

/** The fields we use from Context.dev's prebuilt google-maps parser. */
const RawPlaceSchema = z.object({
  place_id: z.string().min(1),
  name: z.string().min(1),
  rating: NumericSchema.refine((value) => value > 0),
  number_of_reviews: NumericSchema.nullish().transform((value) => value ?? 0),
  latitude: NumericSchema,
  longitude: NumericSchema,
  google_image: z.url(),
  google_hours: z.unknown().optional(),
  google_category: z.unknown().optional(),
  google_description: z.unknown().optional(),
});

export const MapsResultsSchema = z.object({ results: z.array(z.unknown()) });

/** A Maps search for free text, read with Context.dev's prebuilt google-maps parser. */
export function mapsSearchRequest(searchText: string): Record<string, unknown> & { url: string } {
  return {
    url: `${MAPS_SEARCH}${encodeURIComponent(searchText)}`,
    formats: { parse: true },
    parseParams: { type: 'prebuilt', parser: 'google-maps' },
  };
}

export interface PlacesParams {
  interest: InterestId;
  /** What to search Maps for: the interest's usual query, or one that suits the season. */
  query: string;
  /** Set when the search is for somewhere to do an activity; the places found are marked with it. */
  activity?: PlaceActivity;
  locationText: string;
  origin: LatLng;
}

export function placesUrl(query: string, locationText: string): string {
  return mapsSearchRequest(`${query} near ${locationText}`).url;
}

/** Maps gives categories as a list and descriptions as text or nothing; anything else is ignored. */
function firstText(raw: unknown): string | undefined {
  const first: unknown = Array.isArray(raw) ? raw[0] : raw;
  const text = typeof first === 'string' ? first.trim() : '';
  return text.length > 0 ? text : undefined;
}

const GOOGLE_PHOTO = /^(https:\/\/[a-z0-9]+\.googleusercontent\.com\/.+=)w\d+-h\d+(-[a-z-]+)?$/;
const VIDEO_PHOTO_SIZE = 'w1280-h720';

/** Maps hands out thumbnails; the same photo is served at any size named at the end of its address. */
function videoSized(imageUrl: string): string {
  return imageUrl.replace(GOOGLE_PHOTO, (_all, base: string, flags: string | undefined) => `${base}${VIDEO_PHOTO_SIZE}${flags ?? ''}`);
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
export function toPlaceFact(raw: unknown, interest: InterestId, origin: LatLng, sourceId: string, rank?: number): PlaceFact | null {
  const parsed = RawPlaceSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const place = parsed.data;
  const point = { lat: place.latitude, lng: place.longitude };
  const hours = parseGoogleHours(place.google_hours);
  const category = firstText(place.google_category);
  const description = firstText(place.google_description);
  return {
    id: `place:${place.place_id}`,
    kind: 'place',
    interest,
    name: place.name,
    ...(category ? { category } : {}),
    ...(description ? { description } : {}),
    rating: place.rating,
    reviewCount: place.number_of_reviews,
    lat: point.lat,
    lng: point.lng,
    imageUrl: videoSized(place.google_image),
    distanceM: Math.round(haversineM(origin, point)),
    ...(rank === undefined ? {} : { rank }),
    timezone: timezoneAt(point),
    ...(hours ? { hours } : {}),
    sourceId,
  };
}

/** A name longer than this is checked for keywords tacked onto it. */
const LONG_NAME_CHARS = 36;
/** A single word shorter than this before the separator is a town or a keyword, not the business. */
const MIN_ONE_WORD_NAME_CHARS = 8;
const NAME_SEPARATOR = /\s+[-–—·]\s+|\s*[|•]\s*/u;

/**
 * Businesses pad their Maps name with what they sell: "SOURCE TO SEA - Kayak School - Shop -
 * Rafting". A name that long is cut back to what stands before the first separator; one of
 * ordinary length that merely has a dash in it ("Innsbruck - Nordkette") is left alone, and so is
 * one whose first part is a single short word ("Lagos | Boat Trips…", "Rafting - Canyoning…").
 */
export function shortName(name: string): string {
  if (name.length <= LONG_NAME_CHARS) {
    return name;
  }
  const head = name.split(NAME_SEPARATOR)[0]?.trim() ?? '';
  const isName = /\s/u.test(head) || head.length >= MIN_ONE_WORD_NAME_CHARS;
  return isName && head.length < name.length ? head : name;
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
  const request = mapsSearchRequest(`${p.query} near ${p.locationText}`);
  const { url } = request;
  const res = await deps.client.scrape(request);
  const results = res.parsed.success === true ? MapsResultsSchema.safeParse(res.parsed.data) : null;
  if (!results?.success) {
    return emptyResult();
  }
  const facts = results.data.results
    .map((raw, rank) => toPlaceFact(raw, p.interest, p.origin, sourceId, rank))
    .filter((fact): fact is PlaceFact => fact !== null);
  const fetchedAt = realFetchedAt(res, deps.now());
  const source: Source = { id: sourceId, label: 'Google Maps', url, fetchedAt: new Date(fetchedAt).toISOString() };
  const result = { facts, source };
  if (facts.length > 0) {
    deps.cache.set(key, result, { fetchedAt });
  }
  return result;
}

/**
 * The same Maps results serve a search made for an activity and one made for the interest at
 * large, so what a place is "for" is stamped on per asker, never stored.
 */
function forAsker(result: SourceResult<PlaceFact>, p: PlacesParams): SourceResult<PlaceFact> {
  const facts = withDistances(result, p.origin).facts.map(({ activity: _stored, ...fact }, index) => ({
    ...fact,
    // Results stored before positions were recorded still hold Maps' order.
    rank: fact.rank ?? index,
    ...(p.activity ? { activity: p.activity } : {}),
  }));
  return { ...result, facts };
}

/** Places for one interest near the listing. A failed scrape yields nothing; exhausted credits propagate. */
export async function fetchPlaces(deps: SourceDeps, p: PlacesParams): Promise<SourceResult<PlaceFact>> {
  const sourceId = `google-maps:${p.interest}`;
  const key = scrapeKey('places', {
    interest: p.interest,
    query: p.query.trim().toLowerCase(),
    lat: round2(p.origin.lat),
    lng: round2(p.origin.lng),
  });
  const cached = deps.cache.get<SourceResult<PlaceFact>>(key, deps.now());
  if (cached) {
    return forAsker(cached.value, p);
  }
  try {
    const fresh = await deps.dedupe(key, () => scrapePlaces(deps, p, sourceId, key));
    return forAsker(fresh, p);
  } catch (error: unknown) {
    if (error instanceof CreditsExhaustedError) {
      throw error;
    }
    deps.onSourceError?.(sourceId, error);
    return emptyResult();
  }
}
