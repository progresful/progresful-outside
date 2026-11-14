export const INTEREST_IDS = [
  'food',
  'nightlife',
  'culture',
  'history',
  'nature',
  'water',
  'adventure',
  'family',
  'wellness',
  'shopping',
  'events',
  'gems',
] as const;

export type InterestId = (typeof INTEREST_IDS)[number];

export interface Interest {
  id: InterestId;
  label: string;
  /** The label on the popup's chips. */
  shortLabel: string;
  /** Fills "Finding … spots" in the progress line. */
  stageNoun: string;
  mapsQueries: readonly string[];
  /** Words that mark a tour or activity title as belonging to this interest. Matched as whole words. */
  experienceKeywords: readonly string[];
}

/** What an active person books, whatever the season: the marketplaces only list what runs on the dates. */
const ADVENTURE_WORDS = [
  'bike', 'e-bike', 'ebike', 'mtb', 'quad', 'atv', 'buggy', 'jeep', 'off-road', 'zipline', 'zip line', 'rafting', 'canyoning',
  'climbing', 'via ferrata', 'paragliding', 'skydiving', 'bungee', 'kayak', 'kayaking', 'surf', 'surfing', 'diving',
  'skiing', 'ski-day', 'ski day', 'snowboard', 'snowboarding', 'snowshoe', 'snowshoeing', 'sledding', 'tobogganing', 'bobsled',
  'segway', 'tuk-tuk', 'horseback',
] as const;

export const INTERESTS: readonly Interest[] = [
  { id: 'food', label: 'Food & drink', shortLabel: 'Food', stageNoun: 'food', mapsQueries: ['local restaurants', 'food market'], experienceKeywords: ['food', 'wine', 'tasting', 'tastings', 'cooking', 'baking', 'culinary', 'dinner', 'gastronomy'] },
  { id: 'nightlife', label: 'Nightlife', shortLabel: 'Nightlife', stageNoun: 'nightlife', mapsQueries: ['cocktail bar', 'live music bar'], experienceKeywords: ['pub crawl', 'bar crawl', 'night', 'nightlife', 'party', 'cocktail'] },
  { id: 'culture', label: 'Art & museums', shortLabel: 'Museums', stageNoun: 'museum', mapsQueries: ['museum', 'art gallery'], experienceKeywords: ['museum', 'gallery', 'art', 'exhibition', 'palace', 'monastery', 'tickets'] },
  { id: 'history', label: 'History & architecture', shortLabel: 'History', stageNoun: 'historic', mapsQueries: ['historic landmark', 'old town'], experienceKeywords: ['history', 'historic', 'historical', 'heritage', 'walking tour', 'castle', 'old town', 'cathedral', 'ruins'] },
  { id: 'nature', label: 'Nature & hikes', shortLabel: 'Nature', stageNoun: 'nature', mapsQueries: ['park', 'viewpoint', 'hiking trail'], experienceKeywords: ['hike', 'hiking', 'nature', 'national park', 'natural park', 'valley', 'mountain', 'waterfall', 'day trip'] },
  { id: 'water', label: 'Beaches & water', shortLabel: 'Beaches', stageNoun: 'beach', mapsQueries: ['beach', 'boat rental'], experienceKeywords: ['boat', 'cruise', 'sailing', 'surf', 'kayak', 'beach', 'dolphin', 'snorkeling', 'catamaran'] },
  { id: 'adventure', label: 'Adventure & sports', shortLabel: 'Adventure', stageNoun: 'adventure', mapsQueries: ['outdoor activities', 'bike rental', 'climbing'], experienceKeywords: ADVENTURE_WORDS },
  { id: 'family', label: 'Family & kids', shortLabel: 'Family', stageNoun: 'family', mapsQueries: ['family attraction', 'zoo'], experienceKeywords: ['family', 'kids', 'aquarium', 'zoo', 'oceanarium'] },
  { id: 'wellness', label: 'Wellness & spa', shortLabel: 'Wellness', stageNoun: 'wellness', mapsQueries: ['spa', 'sauna', 'thermal bath'], experienceKeywords: ['spa', 'yoga', 'thermal', 'massage', 'wellness', 'hammam'] },
  { id: 'shopping', label: 'Shopping & markets', shortLabel: 'Shopping', stageNoun: 'shopping', mapsQueries: ['local market', 'shopping street'], experienceKeywords: ['market', 'shopping', 'workshop', 'craft', 'tile'] },
  { id: 'events', label: 'Live music & events', shortLabel: 'Live music', stageNoun: 'live music', mapsQueries: ['live music venue', 'concert venue', 'theatre'], experienceKeywords: ['concert', 'show', 'fado', 'live music', 'flamenco', 'opera', 'theatre'] },
  { id: 'gems', label: 'Hidden gems', shortLabel: 'Hidden gems', stageNoun: 'hidden', mapsQueries: ["locals' favourite", 'hidden gem'], experienceKeywords: ['hidden', 'secret', 'local', 'locals', 'off the beaten path'] },
];

export const MAX_INTERESTS = 5;

export const DEFAULT_INTERESTS: readonly InterestId[] = ['food', 'culture', 'nature'];

/** The interests a video is built for: defaults when none are picked, else the first five unique picks. */
export function effectiveInterests(picked: readonly InterestId[]): InterestId[] {
  const unique = [...new Set(picked)];
  return unique.length === 0 ? [...DEFAULT_INTERESTS] : unique.slice(0, MAX_INTERESTS);
}

export function interestById(id: InterestId): Interest {
  const found = INTERESTS.find((interest) => interest.id === id);
  if (!found) {
    throw new Error(`Unknown interest: ${id}`);
  }
  return found;
}
