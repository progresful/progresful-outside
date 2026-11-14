import type { InterestId, PlaceFact } from '@outside/shared';

/** A video needs at least this many places to be worth making. */
export const MIN_PLACES = 3;

const MAX_ACTIVITY_SCENES = 3;
const MIN_RATING = 4.2;
const MIN_REVIEWS = 50;
const NEAR_RADIUS_M = 3_000;
const WIDE_RADIUS_M = 25_000;

const WALK_LIMIT_M = 2_000;
const WALK_M_PER_MIN = 80;
const DRIVE_M_PER_MIN = 500;
/** Straight-line distance is stretched by 13/10 to approximate the real route. */
const DETOUR_NUMERATOR = 13;
const DETOUR_DENOMINATOR = 10;

export function scorePlace(place: PlaceFact): number {
  return (place.rating * Math.log10(place.reviewCount + 1)) / (1 + place.distanceM / 1000);
}

function byScoreDescending(a: PlaceFact, b: PlaceFact): number {
  return scorePlace(b) - scorePlace(a);
}

function eligible(places: readonly PlaceFact[], radiusM: number): PlaceFact[] {
  return places.filter(
    (place) => place.rating >= MIN_RATING && place.reviewCount >= MIN_REVIEWS && place.distanceM <= radiusM,
  );
}

function distinctCount(places: readonly PlaceFact[]): number {
  return new Set(places.map((place) => place.id)).size;
}

function withoutPicked(pool: readonly PlaceFact[], picked: readonly PlaceFact[]): PlaceFact[] {
  const taken = new Set(picked.map((place) => place.id));
  return pool.filter((place) => !taken.has(place.id));
}

/**
 * Up to three places for the activity scenes: the best one for each interest in the order the
 * user picked them, then the best of the rest. Looks within 3 km, or 25 km when that is too thin.
 */
export function selectPlaces(places: readonly PlaceFact[], interests: readonly InterestId[]): PlaceFact[] {
  const near = eligible(places, NEAR_RADIUS_M);
  const pool = distinctCount(near) >= MIN_PLACES ? near : eligible(places, WIDE_RADIUS_M);

  const perInterest = interests.reduce<PlaceFact[]>((picked, interest) => {
    if (picked.length >= MAX_ACTIVITY_SCENES) {
      return picked;
    }
    const best = withoutPicked(pool, picked)
      .filter((place) => place.interest === interest)
      .sort(byScoreDescending)[0];
    return best ? [...picked, best] : picked;
  }, []);

  return withoutPicked(pool, perInterest)
    .sort(byScoreDescending)
    .reduce<PlaceFact[]>((picked, place) => {
      const full = picked.length >= MAX_ACTIVITY_SCENES;
      return full || picked.some((taken) => taken.id === place.id) ? picked : [...picked, place];
    }, perInterest);
}

/** "≈ 13 min walk" up to 2 km, "≈ 24 min drive" beyond. Approximate by design: listing coordinates are fuzzy. */
export function travelLabel(distanceM: number): string {
  const walking = distanceM <= WALK_LIMIT_M;
  const metresPerMinute = walking ? WALK_M_PER_MIN : DRIVE_M_PER_MIN;
  const minutes = Math.max(
    1,
    Math.ceil((distanceM * DETOUR_NUMERATOR) / (DETOUR_DENOMINATOR * metresPerMinute)),
  );
  return `≈ ${minutes} min ${walking ? 'walk' : 'drive'}`;
}
