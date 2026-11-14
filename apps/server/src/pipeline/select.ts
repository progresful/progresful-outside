import { interestById, type EventFact, type ExperienceFact, type InterestId, type PlaceFact } from '@outside/shared';
import type { TripWindow } from '../sources/tripWindow';

/** A video needs at least this many places to be worth making. */
export const MIN_PLACES = 3;

const MAX_ACTIVITY_SCENES = 3;
const MIN_RATING = 4.2;
const MIN_REVIEWS = 50;
const NEAR_RADIUS_M = 3_000;
/** How far a place may be from the listing and still count as "around" it. */
export const WIDE_RADIUS_M = 25_000;

const WALK_LIMIT_M = 2_000;
const WALK_M_PER_MIN = 80;
/** A car averages 30 km/h in town, 60 km/h on the roads out of it and 80 km/h on a long run. */
const DRIVE_LEGS: ReadonlyArray<{ uptoRouteM: number; mPerMin: number }> = [
  { uptoRouteM: 6_500, mPerMin: 500 },
  { uptoRouteM: 20_000, mPerMin: 1_000 },
  { uptoRouteM: Number.POSITIVE_INFINITY, mPerMin: 4_000 / 3 },
];
/** Beyond this many minutes an estimate to the minute would claim more than it knows. */
const EXACT_MINUTES_LIMIT = 20;
const ROUND_TO_MINUTES = 5;
/** Straight-line distance is stretched by 13/10 to approximate the real route. */
const DETOUR_NUMERATOR = 13;
const DETOUR_DENOMINATOR = 10;

/** How fast a place loses weight as it sits further down Maps' own list for the search. */
const RANK_WEIGHT = 0.15;
/** A niche activity (a toboggan run, a ski trail) has far fewer reviewers than a restaurant. */
const MIN_ACTIVITY_REVIEWS = 10;
/**
 * For an activity, only what Maps listed first or second is trusted to be a place for it:
 * further down, "cross-country ski trail" drifts to every well-known ski lift in the valley.
 */
const ACTIVITY_TOP_RESULTS = 2;
/** People drive to a ski area; within that range a few kilometres hardly matter. */
const ACTIVITY_DISTANCE_SCALE_KM = 40;

/**
 * Quality, closeness and how well the place answers the search. The last matters most for
 * seasonal searches: "winter activities" lists the ski jump first and the palace gardens tenth.
 * Somewhere to do an activity is judged far less on distance than a sight is.
 */
export function scorePlace(place: PlaceFact): number {
  const km = place.distanceM / 1000;
  const closeness = place.activity ? 1 + km / ACTIVITY_DISTANCE_SCALE_KM : 1 + km;
  const quality = (place.rating * Math.log10(place.reviewCount + 1)) / closeness;
  return quality / (1 + (place.rank ?? 0) * RANK_WEIGHT);
}

function byScoreDescending(a: PlaceFact, b: PlaceFact): number {
  return scorePlace(b) - scorePlace(a);
}

function isGoodEnough(place: PlaceFact, radiusM: number): boolean {
  const minReviews = place.activity ? MIN_ACTIVITY_REVIEWS : MIN_REVIEWS;
  return place.rating >= MIN_RATING && place.reviewCount >= minReviews && place.distanceM <= radiusM;
}

function distinctCount(places: readonly PlaceFact[]): number {
  return new Set(places.map((place) => place.id)).size;
}

function withoutPicked(pool: readonly PlaceFact[], picked: readonly PlaceFact[]): PlaceFact[] {
  const taken = new Set(picked.map((place) => place.id));
  return pool.filter((place) => !taken.has(place.id));
}

/** The part of a planned search that decides which places answer it. */
export interface PlaceSlot {
  interest: InterestId;
  activity?: { id: string; radiusM: number };
}

/** Sights within 3 km, or 25 km when that is too thin; activities within their own range. */
function poolOf(places: readonly PlaceFact[], slots: readonly PlaceSlot[]): PlaceFact[] {
  const radiusOf = new Map(slots.flatMap((slot) => (slot.activity ? [[slot.activity.id, slot.activity.radiusM] as const] : [])));
  const sights = places.filter((place) => !place.activity);
  const near = sights.filter((place) => isGoodEnough(place, NEAR_RADIUS_M));
  const sightPool = distinctCount(near) >= MIN_PLACES ? near : sights.filter((place) => isGoodEnough(place, WIDE_RADIUS_M));
  const activityPool = places.filter(
    (place) =>
      place.activity && (place.rank ?? 0) < ACTIVITY_TOP_RESULTS && isGoodEnough(place, radiusOf.get(place.activity.id) ?? WIDE_RADIUS_M),
  );
  return [...sightPool, ...activityPool];
}

function answers(place: PlaceFact, slot: PlaceSlot, planned: boolean): boolean {
  if (place.interest !== slot.interest) {
    return false;
  }
  if (!planned) {
    return true;
  }
  return slot.activity ? place.activity?.id === slot.activity.id : !place.activity;
}

/**
 * Up to three places for the activity scenes. With planned searches: the best place for each
 * search in the order they were planned, so each scene is a different thing to do. Without: the
 * best one for each interest in the order the user picked them. Then the best of the rest.
 */
export function selectPlaces(places: readonly PlaceFact[], interests: readonly InterestId[], searches: readonly PlaceSlot[] = []): PlaceFact[] {
  const planned = searches.length > 0;
  const slots: readonly PlaceSlot[] = planned ? searches : interests.map((interest) => ({ interest }));
  const pool = poolOf(places, slots);

  const perSlot = slots.reduce<PlaceFact[]>((picked, slot) => {
    if (picked.length >= MAX_ACTIVITY_SCENES) {
      return picked;
    }
    const candidates = withoutPicked(pool, picked)
      .filter((place) => answers(place, slot, planned))
      .sort(byScoreDescending);
    // For an activity, Maps' own order decides; the score only breaks ties.
    const best = slot.activity ? [...candidates].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0] : candidates[0];
    return best ? [...picked, best] : picked;
  }, []);

  return withoutPicked(pool, perSlot)
    .sort(byScoreDescending)
    .reduce<PlaceFact[]>((picked, place) => {
      const full = picked.length >= MAX_ACTIVITY_SCENES;
      return full || picked.some((taken) => taken.id === place.id) ? picked : [...picked, place];
    }, perSlot);
}

interface Travel {
  minutes: number;
  walking: boolean;
}

function driveMinutes(routeM: number): number {
  return DRIVE_LEGS.reduce((minutes, leg, index) => {
    const from = DRIVE_LEGS[index - 1]?.uptoRouteM ?? 0;
    const covered = Math.max(0, Math.min(routeM, leg.uptoRouteM) - from);
    return minutes + covered / leg.mPerMin;
  }, 0);
}

function travel(distanceM: number): Travel {
  const walking = distanceM <= WALK_LIMIT_M;
  const routeM = (distanceM * DETOUR_NUMERATOR) / DETOUR_DENOMINATOR;
  const exact = Math.max(1, Math.ceil(walking ? routeM / WALK_M_PER_MIN : driveMinutes(routeM)));
  const rounded = Math.round(exact / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;
  return { minutes: !walking && exact > EXACT_MINUTES_LIMIT ? rounded : exact, walking };
}

/** "≈ 13 min walk" up to 2 km, "≈ 19 min drive" beyond, "≈ 45 min drive" for a ski area. Approximate by design: listing coordinates are fuzzy. */
export function travelLabel(distanceM: number): string {
  const { minutes, walking } = travel(distanceM);
  return `≈ ${minutes} min ${walking ? 'walk' : 'drive'}`;
}

/** The same estimate in words a voice can read: "about 13 minutes on foot". */
export function spokenTravel(distanceM: number): string {
  const { minutes, walking } = travel(distanceM);
  return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ${walking ? 'on foot' : 'by car'}`;
}

const MAX_EXPERIENCES = 3;
/** How many of the three may be chosen for suiting the season and the planned activities. */
const MAX_IN_SEASON = 2;
const MIN_EXPERIENCE_RATING = 4.3;
const MIN_EXPERIENCE_REVIEWS = 20;

interface RatedExperience extends ExperienceFact {
  rating: number;
  reviewCount: number;
}

function isWellReviewed(offer: ExperienceFact): offer is RatedExperience {
  return (
    offer.rating !== undefined &&
    offer.reviewCount !== undefined &&
    offer.rating >= MIN_EXPERIENCE_RATING &&
    offer.reviewCount >= MIN_EXPERIENCE_REVIEWS
  );
}

function experienceScore(offer: RatedExperience): number {
  return offer.rating * Math.log10(offer.reviewCount + 1);
}

const SAME_OFFER_OVERLAP = 0.6;

function titleWords(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(/&/g, ' and ').match(/[\p{L}\p{N}]+/gu) ?? []);
}

/**
 * Whether two titles describe the same outing: "Lisbon: Food & Wine Tour" and "Lisbon Food and
 * Wine Tour" on two marketplaces, or a ferry day trip listed from both ends. Measured as the share
 * of words the titles have in common.
 */
function sameOffer(a: string, b: string): boolean {
  const first = titleWords(a);
  const second = titleWords(b);
  const shared = [...first].filter((word) => second.has(word)).length;
  const total = first.size + second.size - shared;
  return total > 0 && shared / total >= SAME_OFFER_OVERLAP;
}

/** Whether the title has any of the words, as whole words: "art" is not in "party". */
function hasAnyWord(title: string, words: readonly string[]): boolean {
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(title);
  });
}

function matchesInterest(title: string, interest: InterestId): boolean {
  return hasAnyWord(title, interestById(interest).experienceKeywords);
}

function isSameOffer(a: ExperienceFact, b: ExperienceFact): boolean {
  return a.id === b.id || sameOffer(a.title, b.title);
}

/** Well-reviewed offers first, then any that are rated, then those nobody has rated yet. */
function offerTier(offer: ExperienceFact): number {
  if (isWellReviewed(offer)) {
    return 0;
  }
  return offer.rating === undefined ? 2 : 1;
}

function byTierThenScore(a: ExperienceFact, b: ExperienceFact): number {
  const score = (offer: ExperienceFact): number => (offer.rating ?? 0) * Math.log10((offer.reviewCount ?? 0) + 1);
  return offerTier(a) - offerTier(b) || score(b) - score(a) || a.amount - b.amount;
}

/** How exactly a title names an activity: the length of the longest of its words found there, 0 when none is. */
function exactness(title: string, words: readonly string[]): number {
  return Math.max(0, ...words.filter((word) => hasAnyWord(title, [word])).map((word) => word.length));
}

/** A "cross-country skiing day" says "skiing", yet it is cross-country's offer: the longer word names it. */
function namesIt(title: string, activityId: string, wordsOf: ReadonlyMap<string, readonly string[]>): boolean {
  const own = exactness(title, wordsOf.get(activityId) ?? []);
  return own > 0 && [...wordsOf].every(([id, words]) => id === activityId || exactness(title, words) <= own);
}

/**
 * The bookable offer that goes with each place found for an activity: the best one whose title
 * names the activity, keyed by the place's id. Few people review a snowshoe hike, so any offer
 * rated 4.3 and up counts, and one nobody has rated yet when nothing rated is on sale. An offer
 * goes with one place only, and never with an activity when its title names another more exactly.
 * `wordsOf` holds the offer words of every activity, by id.
 */
export function pairOffers(
  places: readonly PlaceFact[],
  offers: readonly ExperienceFact[],
  wordsOf: ReadonlyMap<string, readonly string[]>,
): Map<string, ExperienceFact> {
  const ranked = offers.filter((offer) => offer.rating === undefined || offer.rating >= MIN_EXPERIENCE_RATING).sort(byTierThenScore);
  return places.reduce((paired, place) => {
    const activityId = place.activity?.id;
    const taken = [...paired.values()];
    const found =
      activityId === undefined
        ? undefined
        : ranked.find((offer) => namesIt(offer.title, activityId, wordsOf) && !taken.some((other) => isSameOffer(other, offer)));
    return found ? new Map([...paired, [place.id, found]]) : paired;
  }, new Map<string, ExperienceFact>());
}

/**
 * Up to three bookable experiences: first up to two that suit the season or the planned
 * activities, then the best one for each interest in the order the user picked them, then the
 * best of the rest.
 * Only well-reviewed offers, each tour once, and none that is already `shown` beside an activity.
 */
export function selectExperiences(
  offers: readonly ExperienceFact[],
  interests: readonly InterestId[],
  seasonWords: readonly string[] = [],
  shown: readonly ExperienceFact[] = [],
): ExperienceFact[] {
  const ranked = offers
    .filter(isWellReviewed)
    .filter((offer) => !shown.some((other) => isSameOffer(other, offer)))
    .sort((a, b) => experienceScore(b) - experienceScore(a));
  const pool = ranked.reduce<RatedExperience[]>(
    (kept, offer) => (kept.some((other) => sameOffer(other.title, offer.title)) ? kept : [...kept, offer]),
    [],
  );
  const inSeason = pool.filter((offer) => hasAnyWord(offer.title, seasonWords)).slice(0, MAX_IN_SEASON);
  const perInterest = interests.reduce<RatedExperience[]>(
    (picked, interest) => {
      if (picked.length >= MAX_EXPERIENCES) {
        return picked;
      }
      const best = pool.find((offer) => !picked.includes(offer) && matchesInterest(offer.title, interest));
      return best ? [...picked, best] : picked;
    },
    inSeason,
  );
  const rest = pool.filter((offer) => !perInterest.includes(offer));
  return [...perInterest, ...rest].slice(0, MAX_EXPERIENCES);
}

/** Events that happen during the stay, soonest first. An event without a known date is never shown. */
export function selectEvents(events: readonly EventFact[], window: TripWindow): EventFact[] {
  return events
    .filter((event): event is EventFact & { startDate: string } => {
      const start = event.startDate;
      return start !== undefined && start <= window.end && (event.endDate ?? start) >= window.start;
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
