import type { PlaceFact } from '@outside/shared';

/**
 * How a place shows what it is for, by activity id: the starts of words found in names, kinds and
 * descriptions on Maps, in English and the languages of the places people ski, swim and paddle in.
 * A stem ending in `\b` only counts as a whole word: "sup", not "supermarket"; "ski", not "Skiathos".
 */
const SIGNS: Readonly<Record<string, readonly string[]>> = {
  ski: ['ski\\b', 'skiing', 'skier', 'skigebiet', 'skilift', 'skischule', 'skiverleih', 'skipiste', 'skizentrum', 'skiarena', 'skiwelt', 'snowboard', 'piste\\b', 'gletscher', 'glacier'],
  sled: ['sled', 'toboggan', 'rodel', 'luge\\b'],
  skate: ['skat', 'ice rink', 'eislauf', 'eisbahn', 'patinoire', 'patinaje'],
  snowshoe: ['snowshoe', 'schneeschuh', 'winter', 'hik', 'trail', 'trek', 'walk', 'wander'],
  'cross-country': ['cross-country', 'cross country', 'langlauf', 'loipe', 'nordic'],
  thermal: ['therm', 'hot spring', 'spa\\b', 'bath', 'sauna', 'wellness'],
  pool: ['pool', 'swim', 'piscin', 'schwimm', 'hallenbad', 'bath'],
  quad: ['quad', 'atv\\b', 'buggy', 'buggies', 'off-road', 'offroad', '4x4', 'jeep'],
  rafting: ['raft', 'canyoning', 'canyoneering'],
  bike: ['bike', 'biking', 'mtb\\b', 'cycl', 'bici', 'velo\\b'],
  climb: ['climb', 'kletter', 'boulder', 'ferrata', 'escalad'],
  paraglide: ['paraglid', 'gleitschirm', 'parapent', 'tandem flight', 'tandemflug'],
  hike: ['hik', 'trail', 'trek', 'walk', 'wander', 'path', 'sender'],
  viewpoint: ['viewpoint', 'view', 'lookout', 'mirador', 'miradouro', 'aussicht', 'panoram', 'belvedere', 'observation'],
  swim: ['swim', 'beach', 'lake', 'praia', 'playa', 'plage', 'strand', 'lido', 'bathing', 'baggersee', 'badesee', 'lagoon'],
  paddle: ['kayak', 'kajak', 'canoe', 'kanu', 'paddle', 'sup\\b'],
  boat: ['boat', 'cruise', 'sail', 'catamaran', 'ferry', 'yacht', 'barco'],
  'adventure-park': ['adventure', 'zip\\b', 'zipline', 'zip-line', 'ropes', 'kletterwald', 'hochseil', 'treetop'],
};

/**
 * Activities that someone runs for you: a rafting base or a quad outfit says what it does, so a
 * result that does not is some other business. A toboggan run or a bathing lake often goes by a
 * name alone, and is given the benefit of the doubt.
 */
const SAYS_SO_ITSELF: ReadonlySet<string> = new Set(['rafting', 'quad', 'paraglide', 'paddle', 'climb', 'bike', 'boat', 'adventure-park', 'skate']);

function pattern(stems: readonly string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${stems.join('|')})`, 'iu');
}

const PATTERNS: ReadonlyMap<string, RegExp> = new Map(Object.entries(SIGNS).map(([id, stems]) => [id, pattern(stems)]));

/** Whether the text speaks of the activity: "Wiggi Rafting GmbH" does of rafting. */
export function speaksOf(text: string, activityId: string): boolean {
  return PATTERNS.get(activityId)?.test(text) ?? false;
}

/** Whether the text speaks of any activity in the catalogue. */
export function speaksOfAny(text: string): boolean {
  return [...PATTERNS.values()].some((signs) => signs.test(text));
}

type Described = Pick<PlaceFact, 'name'> & Partial<Pick<PlaceFact, 'category' | 'description' | 'rank'>>;

function ownWords(place: Described): string {
  return `${place.name} ${place.category ?? ''} ${place.description ?? ''}`;
}

/**
 * Where there is no rafting, Maps answers a search for it with kayak and boat tours. A place that
 * speaks of the activity it was found for is a place for it. One that does not is turned away
 * when the activity is run by operators, or when its name is that of another activity; only the
 * name counts against it, since a ski resort may well have a toboggan run. What is left says
 * nothing either way, and is left to Maps' judgement.
 */
export function isForAnother(place: Described, activity: { id: string }): boolean {
  if (speaksOf(ownWords(place), activity.id)) {
    return false;
  }
  return SAYS_SO_ITSELF.has(activity.id) || [...PATTERNS.keys()].some((id) => id !== activity.id && speaksOf(place.name, id));
}

/**
 * Whether a place Maps returned for an activity may be shown as a place for it. One that speaks of
 * the activity may, wherever Maps listed it. One that says nothing either way is taken on Maps'
 * word only as its first answer: "Rumer Alm" is a toboggan run, the inn listed after it is not.
 * `firstAnswer` is for a caller that has already set aside answers of its own, such as places
 * for the other half of the year.
 */
export function fitsActivity(place: Described, activity: { id: string }, firstAnswer: boolean = (place.rank ?? 0) === 0): boolean {
  return speaksOf(ownWords(place), activity.id) || (!isForAnother(place, activity) && firstAnswer);
}
