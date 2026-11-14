import { interestById, type ClimateFact, type InterestId } from '@outside/shared';
import type { TripWindow } from '../sources/tripWindow';

/** How the place feels at the time of the stay. Drives what is searched for and how it is described. */
export type SeasonKind = 'snowy' | 'cold' | 'mild' | 'warm' | 'hot';
export type SeasonName = 'winter' | 'spring' | 'summer' | 'autumn';

export interface Season {
  kind: SeasonKind;
  name: SeasonName;
  /** "January". */
  month: string;
  /** The weeks before Christmas, when Christmas markets are on. */
  festive: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** Northern-hemisphere season of each month, January first. */
const NORTHERN: readonly SeasonName[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];
const OPPOSITE: Readonly<Record<SeasonName, SeasonName>> = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };

const SNOWY_SHARE_PERCENT = 25;
const FREEZING_HIGH_C = 2;
const COLD_BELOW_C = 10;
const MILD_BELOW_C = 20;
const WARM_BELOW_C = 28;

const FESTIVE_FROM = '11-20';
const FESTIVE_TO = '12-26';

function kindFromClimate(climate: ClimateFact): SeasonKind {
  if (climate.snowDaysPercent >= SNOWY_SHARE_PERCENT || climate.tempMaxC <= FREEZING_HIGH_C) {
    return 'snowy';
  }
  if (climate.tempMaxC < COLD_BELOW_C) {
    return 'cold';
  }
  if (climate.tempMaxC < MILD_BELOW_C) {
    return 'mild';
  }
  return climate.tempMaxC < WARM_BELOW_C ? 'warm' : 'hot';
}

/** Winters this far from the equator are cold enough to call cold without having measured them. */
const COLD_WINTER_LATITUDE = 40;

/**
 * For when the usual weather could not be fetched. Only one guess is safe enough to make: a
 * winter far from the equator is cold. January is beach weather in Tenerife, and a summer may be
 * anything, so everything else counts as mild and changes nothing.
 */
function kindFromCalendar(name: SeasonName, lat: number): SeasonKind {
  return name === 'winter' && Math.abs(lat) >= COLD_WINTER_LATITUDE ? 'cold' : 'mild';
}

/** Whether any day of the stay falls between 20 November and 26 December. */
function isFestive(window: TripWindow): boolean {
  const startsBeforeEnd = window.start.slice(5) <= FESTIVE_TO;
  const endsAfterStart = window.end.slice(5) >= FESTIVE_FROM;
  const sameYear = window.start.slice(0, 4) === window.end.slice(0, 4);
  return sameYear ? startsBeforeEnd && endsAfterStart : window.start.slice(5) <= FESTIVE_TO && window.start.slice(5) >= FESTIVE_FROM;
}

/** The season of the stay. Its name comes from the calendar; how it feels comes from the usual weather. */
export function seasonOf(climate: ClimateFact | undefined, window: TripWindow, lat: number): Season {
  const monthIndex = climate ? MONTHS.indexOf(climate.month) : Number(window.start.slice(5, 7)) - 1;
  const northern = NORTHERN[monthIndex] ?? 'summer';
  const name = lat < 0 ? OPPOSITE[northern] : northern;
  return {
    kind: climate ? kindFromClimate(climate) : kindFromCalendar(name, lat),
    name,
    month: MONTHS[monthIndex] ?? '',
    festive: isFestive(window),
  };
}

/** What to search Maps for instead of an interest's usual query, where the season calls for it. */
const SEASONAL_QUERIES: Readonly<Partial<Record<InterestId, Partial<Record<SeasonKind, string>>>>> = {
  // Cold counts as winter even where little snow falls in town: the slopes are usually up the hill,
  // and where there are none the search finds nothing nearby and the usual one runs instead.
  nature: { snowy: 'winter activities', cold: 'winter activities' },
  adventure: { snowy: 'ski resort', cold: 'ski resort' },
  water: { snowy: 'thermal bath', cold: 'thermal bath' },
  food: { snowy: 'cosy restaurant', cold: 'cosy restaurant', warm: 'restaurant with terrace', hot: 'restaurant with terrace' },
  nightlife: { warm: 'rooftop bar', hot: 'rooftop bar' },
  wellness: { snowy: 'sauna', cold: 'sauna' },
};
const FESTIVE_QUERIES: Readonly<Partial<Record<InterestId, string>>> = { shopping: 'Christmas market' };

export interface PlaceQuery {
  query: string;
  /** The interest's usual query, to fall back on when the seasonal one finds nothing nearby. */
  fallback?: string;
}

export function placeQuery(interest: InterestId, season: Season): PlaceQuery {
  const usual = interestById(interest).mapsQueries[0] ?? interest;
  const seasonal = (season.festive ? FESTIVE_QUERIES[interest] : undefined) ?? SEASONAL_QUERIES[interest]?.[season.kind];
  return seasonal && seasonal !== usual ? { query: seasonal, fallback: usual } : { query: usual };
}

/**
 * Interests whose places are usually shown from outside, where the season shows in a photo.
 * Museums are in: a castle found as a museum is pictured with its park. Restaurants, bars and
 * spas are shown from inside and keep their own photo.
 */
const OUTDOOR_INTERESTS: ReadonlySet<InterestId> = new Set(['nature', 'adventure', 'water', 'history', 'culture', 'family', 'shopping', 'events', 'gems']);

/** Whether a place's stock photo should be swapped for one taken in the season of the stay. */
export function wantsSeasonalPhoto(interest: InterestId, season: Season): boolean {
  return season.kind !== 'mild' && OUTDOOR_INTERESTS.has(interest);
}

function wintry(season: Season): boolean {
  return season.name === 'winter' && (season.kind === 'snowy' || season.kind === 'cold');
}

/**
 * The image search for one place in the season of the stay: "Innsbrucker Hofgarten Innsbruck
 * winter snow", or with what is done there: "Axamer Lizum Innsbruck skiing winter snow".
 */
export function placePhotoQuery(placeName: string, city: string, season: Season, activityWord?: string): string {
  const doing = activityWord ? `${activityWord} ` : '';
  return `${placeName} ${city} ${doing}${season.name}${wintry(season) ? ' snow' : ''}`;
}

/** The search for a photo of the place as it looks at that time of year. */
export function seasonPhotoQuery(city: string, season: Season): string {
  return `${city} ${season.name}${season.kind === 'snowy' ? ' snow' : ''}`;
}

const SNOW_WORDS = ['ski', 'skiing', 'snow', 'snowshoe', 'snowmobile', 'sled', 'sledding', 'sleigh', 'toboggan', 'husky', 'reindeer', 'northern lights', 'aurora', 'ice', 'glacier', 'winter'];
const COLD_WORDS = ['thermal', 'sauna', 'spa', 'winter'];
const SUN_WORDS = ['beach', 'boat', 'cruise', 'kayak', 'sailing', 'snorkeling', 'surf', 'sunset', 'swim'];
const FESTIVE_WORDS = ['christmas', 'advent'];

/** Words that mark a tour or activity title as right for the season; none in mild weather. */
export function seasonalWords(season: Season): string[] {
  const byKind: Readonly<Record<SeasonKind, readonly string[]>> = {
    snowy: [...SNOW_WORDS, ...COLD_WORDS],
    cold: [...SNOW_WORDS, ...COLD_WORDS],
    mild: [],
    warm: SUN_WORDS,
    hot: SUN_WORDS,
  };
  return [...new Set([...(season.festive ? FESTIVE_WORDS : []), ...byKind[season.kind]])];
}
