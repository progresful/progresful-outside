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
  experienceKeywords: readonly string[];
}

export const INTERESTS: readonly Interest[] = [
  { id: 'food', label: 'Food & drink', shortLabel: 'Food', stageNoun: 'food', mapsQueries: ['local restaurants', 'food market'], experienceKeywords: ['food tour', 'cooking class', 'tasting'] },
  { id: 'nightlife', label: 'Nightlife', shortLabel: 'Nightlife', stageNoun: 'nightlife', mapsQueries: ['cocktail bar', 'live music bar'], experienceKeywords: ['pub crawl', 'night tour'] },
  { id: 'culture', label: 'Art & museums', shortLabel: 'Museums', stageNoun: 'museum', mapsQueries: ['museum', 'art gallery'], experienceKeywords: ['museum tickets', 'guided tour'] },
  { id: 'history', label: 'History & architecture', shortLabel: 'History', stageNoun: 'historic', mapsQueries: ['historic landmark', 'old town'], experienceKeywords: ['walking tour', 'heritage'] },
  { id: 'nature', label: 'Nature & hikes', shortLabel: 'Nature', stageNoun: 'nature', mapsQueries: ['hiking trail', 'park', 'viewpoint'], experienceKeywords: ['hike', 'day trip', 'national park'] },
  { id: 'water', label: 'Beaches & water', shortLabel: 'Beaches', stageNoun: 'beach', mapsQueries: ['beach', 'boat rental'], experienceKeywords: ['boat tour', 'surf lesson', 'kayak'] },
  { id: 'adventure', label: 'Adventure & sports', shortLabel: 'Adventure', stageNoun: 'adventure', mapsQueries: ['climbing', 'bike rental'], experienceKeywords: ['rafting', 'zipline', 'bike tour'] },
  { id: 'family', label: 'Family & kids', shortLabel: 'Family', stageNoun: 'family', mapsQueries: ['family attraction', 'zoo'], experienceKeywords: ['family tickets', 'aquarium'] },
  { id: 'wellness', label: 'Wellness & spa', shortLabel: 'Wellness', stageNoun: 'wellness', mapsQueries: ['spa', 'sauna', 'thermal bath'], experienceKeywords: ['spa day', 'yoga'] },
  { id: 'shopping', label: 'Shopping & markets', shortLabel: 'Shopping', stageNoun: 'shopping', mapsQueries: ['local market', 'shopping street'], experienceKeywords: ['craft workshop', 'shopping tour'] },
  { id: 'events', label: 'Live music & events', shortLabel: 'Live music', stageNoun: 'live music', mapsQueries: ['concert venue', 'theatre'], experienceKeywords: ['concert tickets', 'show'] },
  { id: 'gems', label: 'Hidden gems', shortLabel: 'Hidden gems', stageNoun: 'hidden', mapsQueries: ["locals' favourite", 'hidden gem'], experienceKeywords: ['off the beaten path', 'local guide'] },
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
