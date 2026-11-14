import type { InterestId } from '@outside/shared';
import { placeQuery, type Season, type SeasonKind } from './season';

export { fitsActivity, isForAnother, speaksOf } from './activitySigns';

/** Something a visitor can actually go and do, as opposed to a place to look at. */
export interface Activity {
  id: string;
  /** Shown over the scene: "Ski & snowboard". */
  label: string;
  /** How the voiceover names it: "skiing and snowboarding". */
  doing: string;
  /** What to search Maps for to find where it is done. */
  query: string;
  /** Words that mark a bookable offer as this activity. */
  offerWords: readonly string[];
  /** What to add to an image search so the photo shows it being done. */
  photoWord: string;
  /** How far people travel for it: a ski area is worth a longer drive than an ice rink. */
  radiusM: number;
}

const KM = 1_000;

function activity(id: string, label: string, doing: string, query: string, photoWord: string, radiusKm: number, offerWords: readonly string[]): Activity {
  return { id, label, doing, query, offerWords, photoWord, radiusM: radiusKm * KM };
}

// Offer words name the sport itself: a bare "ski" would take a ticket to a ski jump for skiing.
const SKI_WORDS = ['skiing', 'ski day', 'ski-day', 'ski lesson', 'ski lessons', 'ski tour', 'ski touring', 'ski pass', 'snowboard', 'snowboarding'];
const SKI = activity('ski', 'Ski & snowboard', 'skiing and snowboarding', 'ski resort', 'skiing', 40, SKI_WORDS);
const SLED = activity('sled', 'Sledding', 'sledding', 'toboggan run', 'sledding', 25, ['sled', 'sledding', 'sledge', 'sledging', 'toboggan', 'tobogganing']);
const SKATE = activity('skate', 'Ice skating', 'ice skating', 'ice skating rink', 'ice skating', 15, ['ice skating', 'skating']);
const SNOWSHOE = activity('snowshoe', 'Snowshoe & winter walks', 'snowshoeing and winter walks', 'winter hiking trail', 'snowshoeing', 25, ['snowshoe', 'snowshoeing', 'winter hike', 'winter hiking']);
const CROSS_COUNTRY = activity('cross-country', 'Cross-country skiing', 'cross-country skiing', 'cross-country ski trail', 'cross-country skiing', 30, ['cross-country', 'nordic']);
const THERMAL = activity('thermal', 'Thermal baths', 'soaking in thermal baths', 'thermal bath', 'thermal bath', 30, ['thermal', 'hot spring', 'spa']);
const POOL = activity('pool', 'Indoor pools', 'swimming indoors', 'indoor swimming pool', 'swimming pool', 15, ['pool', 'swimming']);
const QUAD = activity('quad', 'Quad & buggy', 'quad and buggy riding', 'quad ATV buggy tour', 'quad bike', 40, ['quad', 'atv', 'buggy', '4x4', 'off-road', 'jeep']);
const RAFTING = activity('rafting', 'Rafting & canyoning', 'rafting and canyoning', 'rafting', 'rafting', 40, ['rafting', 'canyoning']);
const BIKE = activity('bike', 'Mountain biking', 'mountain biking', 'bike park', 'mountain biking', 30, ['bike', 'biking', 'e-bike', 'ebike', 'mtb', 'cycling']);
const CLIMB = activity('climb', 'Climbing', 'climbing', 'climbing park', 'climbing', 25, ['climbing', 'via ferrata', 'rope course', 'bouldering']);
const PARAGLIDE = activity('paraglide', 'Paragliding', 'paragliding', 'paragliding', 'paragliding', 40, ['paragliding', 'tandem flight']);
const HIKE = activity('hike', 'Hiking', 'hiking', 'hiking trail', 'hiking', 25, ['hike', 'hiking', 'trek', 'trekking']);
const VIEWPOINT = activity('viewpoint', 'Viewpoints', 'taking in the views', 'viewpoint', 'view', 15, ['viewpoint', 'viewpoints']);
const SWIM = activity('swim', 'Swimming', 'swimming', 'swimming lake or beach', 'swimming', 25, ['swim', 'swimming', 'snorkeling', 'snorkelling']);
const PADDLE = activity('paddle', 'Kayak & SUP', 'kayaking and paddleboarding', 'kayak rental', 'kayaking', 25, ['kayak', 'kayaking', 'sup', 'paddle', 'paddleboard', 'paddleboarding', 'canoe', 'canoeing']);
const BOAT = activity('boat', 'Boat trips', 'getting out on the water', 'boat tour', 'boat trip', 25, ['boat', 'cruise', 'sailing', 'catamaran']);
const ADVENTURE_PARK = activity('adventure-park', 'Adventure parks', 'high ropes and zip lines', 'adventure park', 'adventure park', 30, ['adventure park', 'zipline', 'zip line', 'high ropes']);

const CATALOGUE: readonly Activity[] = [
  SKI, SLED, SKATE, SNOWSHOE, CROSS_COUNTRY, THERMAL, POOL, QUAD, RAFTING, BIKE, CLIMB, PARAGLIDE, HIKE, VIEWPOINT, SWIM, PADDLE, BOAT, ADVENTURE_PARK,
];

/**
 * The offer words of every activity, by its id: of those not in the video too, so that a
 * "cross-country skiing day" is not taken for a downhill offer just because it says "skiing".
 */
export const OFFER_WORDS: ReadonlyMap<string, readonly string[]> = new Map(CATALOGUE.map((entry) => [entry.id, entry.offerWords]));

type Time = 'winter' | 'summer' | 'between';

/** Winter sports need the cold, summer ones the warmth; in between, what works in any weather. */
const TIME_OF: Readonly<Record<SeasonKind, Time>> = { snowy: 'winter', cold: 'winter', mild: 'between', warm: 'summer', hot: 'summer' };

/** What to do, most wanted first, for the interests that are about doing rather than seeing. */
const ACTIVITIES: Readonly<Record<Time, Partial<Record<InterestId, readonly Activity[]>>>> = {
  winter: {
    adventure: [SKI, SLED, SKATE],
    nature: [SNOWSHOE, CROSS_COUNTRY],
    water: [THERMAL, POOL],
    family: [SLED, SKATE],
  },
  summer: {
    adventure: [QUAD, SWIM, RAFTING, BIKE, CLIMB, PARAGLIDE],
    nature: [HIKE, VIEWPOINT],
    water: [SWIM, PADDLE, BOAT],
    family: [SWIM, ADVENTURE_PARK],
  },
  between: {
    adventure: [BIKE, CLIMB, QUAD],
    nature: [HIKE, VIEWPOINT],
    water: [PADDLE, BOAT],
    family: [ADVENTURE_PARK],
  },
};

/** The activities an interest stands for at this time of year; none for interests about places. */
export function activitiesFor(interest: InterestId, season: Season): readonly Activity[] {
  return ACTIVITIES[TIME_OF[season.kind]][interest] ?? [];
}

/** One Maps search the video will make. */
export interface PlaceSearch {
  interest: InterestId;
  query: string;
  /** For a place-kind interest: its usual search, run when the seasonal one finds nothing nearby. */
  fallback?: string;
  /** Set when the search is for somewhere to do an activity. */
  activity?: Activity;
}

/**
 * Each search is one request against a small per-minute allowance, which also has to cover the
 * marketplaces, events and photos.
 */
export const MAX_PLACE_SEARCHES = 4;

function searchesOf(interest: InterestId, season: Season): PlaceSearch[] {
  const activities = activitiesFor(interest, season);
  return activities.length > 0
    ? activities.map((planned) => ({ interest, query: planned.query, activity: planned }))
    : [{ interest, ...placeQuery(interest, season) }];
}

/**
 * The searches for a video: the interests take turns, each giving its most wanted activity
 * first, until the allowance is used. An active person with one interest gets four different
 * things to do; five interests get one search each for the first four.
 */
export function placeSearches(interests: readonly InterestId[], season: Season): PlaceSearch[] {
  const queues = interests.map((interest) => searchesOf(interest, season));
  const rounds = Math.max(0, ...queues.map((queue) => queue.length));
  const planned: PlaceSearch[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const queue of queues) {
      const next = queue[round];
      if (next && planned.length < MAX_PLACE_SEARCHES && !planned.some((search) => search.query === next.query)) {
        planned.push(next);
      }
    }
  }
  return planned;
}

/** Words that mark a bookable offer as one of the activities the video is about. */
export function activityOfferWords(searches: readonly PlaceSearch[]): string[] {
  return [...new Set(searches.flatMap((search) => search.activity?.offerWords ?? []))];
}
