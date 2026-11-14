import type { EventFact, ExperienceFact, InterestId, PlaceFact } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { MIN_PLACES, scorePlace, selectEvents, selectExperiences, selectPlaces, travelLabel } from '../src/pipeline/select';

function place(id: string, interest: InterestId, overrides: Partial<PlaceFact> = {}): PlaceFact {
  return {
    id: `place:${id}`,
    kind: 'place',
    interest,
    name: id,
    rating: 4.6,
    reviewCount: 500,
    lat: 0,
    lng: 0,
    imageUrl: 'https://lh3.googleusercontent.com/p/x',
    distanceM: 1_000,
    sourceId: `google-maps:${interest}`,
    ...overrides,
  };
}

const names = (places: PlaceFact[]): string[] => places.map((p) => p.name);

describe('scorePlace', () => {
  it('rewards rating and review volume and penalises distance', () => {
    expect(scorePlace(place('a', 'food', { rating: 4.5, reviewCount: 999, distanceM: 1_000 }))).toBeCloseTo(6.75);
    expect(scorePlace(place('near', 'food', { distanceM: 200 }))).toBeGreaterThan(
      scorePlace(place('far', 'food', { distanceM: 2_500 })),
    );
  });
});

describe('scorePlace and the order Maps returned', () => {
  it('prefers what Maps listed first for the search over a similar place far down its list', () => {
    const first = place('ski-jump', 'nature', { rating: 4.6, reviewCount: 8_000, distanceM: 2_500, rank: 0 });
    const tenth = place('palace-gardens', 'nature', { rating: 4.6, reviewCount: 7_000, distanceM: 800, rank: 10 });

    expect(scorePlace(first)).toBeGreaterThan(scorePlace(tenth));
    expect(names(selectPlaces([tenth, first, place('a', 'food'), place('b', 'culture')], ['nature', 'food', 'culture']))[0]).toBe('ski-jump');
  });

  it('scores a place with no known position as if it were listed first', () => {
    expect(scorePlace(place('a', 'food'))).toBe(scorePlace(place('a', 'food', { rank: 0 })));
  });
});

describe('selectPlaces', () => {
  it('needs three places for a video', () => {
    expect(MIN_PLACES).toBe(3);
  });

  it('drops low ratings, thin review counts and far places', () => {
    const places = [
      place('good1', 'food'),
      place('good2', 'food'),
      place('good3', 'food'),
      place('lowRating', 'food', { rating: 4.1 }),
      place('fewReviews', 'food', { reviewCount: 49 }),
      place('far', 'food', { distanceM: 3_001 }),
    ];

    expect(names(selectPlaces(places, ['food'])).sort()).toEqual(['good1', 'good2', 'good3']);
  });

  it('keeps places exactly on the thresholds', () => {
    const places = [
      place('rating', 'food', { rating: 4.2 }),
      place('reviews', 'food', { reviewCount: 50 }),
      place('edge', 'food', { distanceM: 3_000 }),
    ];

    expect(selectPlaces(places, ['food'])).toHaveLength(3);
  });

  it('widens to 25 km when fewer than three are close', () => {
    const places = [
      place('close', 'nature'),
      place('trail', 'nature', { distanceM: 12_000 }),
      place('lake', 'nature', { distanceM: 24_000 }),
      place('tooFar', 'nature', { distanceM: 26_000 }),
    ];

    expect(names(selectPlaces(places, ['nature'])).sort()).toEqual(['close', 'lake', 'trail']);
  });

  it('does not widen when three are already close', () => {
    const places = [
      place('a', 'nature'),
      place('b', 'nature'),
      place('c', 'nature'),
      place('farStar', 'nature', { rating: 5, reviewCount: 90_000, distanceM: 10_000 }),
    ];

    expect(names(selectPlaces(places, ['nature']))).not.toContain('farStar');
  });

  it('takes the best place for each interest in pick order', () => {
    const places = [
      place('museum', 'culture', { rating: 4.9, reviewCount: 9_000 }),
      place('cafe', 'food', { rating: 4.3 }),
      place('bistro', 'food', { rating: 4.8 }),
      place('park', 'nature', { rating: 4.4 }),
    ];

    expect(names(selectPlaces(places, ['food', 'nature', 'culture']))).toEqual(['bistro', 'park', 'museum']);
  });

  it('fills the remaining slots by score when interests run out', () => {
    const places = [
      place('bistro', 'food', { rating: 4.8 }),
      place('cafe', 'food', { rating: 4.3 }),
      place('market', 'food', { rating: 4.7 }),
      place('bar', 'food', { rating: 4.25 }),
    ];

    expect(names(selectPlaces(places, ['food']))).toEqual(['bistro', 'market', 'cafe']);
  });

  it('never returns more than three or the same place twice', () => {
    const shared = { rating: 4.9, reviewCount: 9_000 };
    const places = [
      place('market', 'food', shared),
      { ...place('market', 'shopping', shared) },
      place('a', 'food'),
      place('b', 'shopping'),
      place('c', 'nature'),
      place('d', 'culture'),
    ];

    const picked = selectPlaces(places, ['food', 'shopping', 'nature', 'culture']);

    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.id)).size).toBe(3);
  });

  it('returns fewer than three when that is all there is', () => {
    expect(selectPlaces([place('only', 'food')], ['food'])).toHaveLength(1);
    expect(selectPlaces([], ['food'])).toEqual([]);
  });
});

describe('travelLabel', () => {
  it('labels walking up to 2 km', () => {
    expect(travelLabel(800)).toBe('≈ 13 min walk');
    expect(travelLabel(2_000)).toBe('≈ 33 min walk');
  });

  it('labels driving beyond 2 km', () => {
    expect(travelLabel(2_001)).toBe('≈ 6 min drive');
    expect(travelLabel(9_000)).toBe('≈ 24 min drive');
  });

  it('never says zero minutes', () => {
    expect(travelLabel(0)).toBe('≈ 1 min walk');
  });
});

describe('selectExperiences', () => {
  function offer(title: string, overrides: Partial<ExperienceFact> = {}): ExperienceFact {
    return {
      id: `exp:test:${title}`,
      kind: 'experience',
      title,
      amount: 50,
      currency: 'EUR',
      rating: 4.8,
      reviewCount: 500,
      url: `https://www.viator.com/tours/${encodeURIComponent(title)}`,
      sourceId: 'viator',
      ...overrides,
    };
  }
  const titles = (offers: ExperienceFact[]): string[] => offers.map((entry) => entry.title);

  it('picks the best offer for each interest in the order the user chose them', () => {
    const offers = [
      offer('Sintra Day Trip', { reviewCount: 20_000 }),
      offer('Sunset Boat Cruise', { reviewCount: 900 }),
      offer('Food and Wine Walking Tour', { reviewCount: 5_000 }),
      offer('Pastel de Nata Baking Class', { reviewCount: 3_000 }),
      offer('Museum Tickets with Audio Guide', { reviewCount: 100 }),
    ];

    expect(titles(selectExperiences(offers, ['water', 'culture', 'food']))).toEqual([
      'Sunset Boat Cruise',
      'Museum Tickets with Audio Guide',
      'Food and Wine Walking Tour',
    ]);
  });

  it('fills the remaining places with the best-reviewed offers', () => {
    const offers = [
      offer('Sintra Day Trip', { reviewCount: 20_000 }),
      offer('Fado Show', { reviewCount: 7_000 }),
      offer('Pub Crawl', { reviewCount: 300 }),
      offer('City Bus Tour', { reviewCount: 60 }),
    ];

    expect(titles(selectExperiences(offers, ['nightlife']))).toEqual(['Pub Crawl', 'Sintra Day Trip', 'Fado Show']);
  });

  it('matches whole words only', () => {
    // "art" must not match "party", nor "spa" match "Spain".
    const offers = [offer('Boat Party in Spain', { reviewCount: 9_000 }), offer('Street Art Tour', { reviewCount: 80 })];

    expect(titles(selectExperiences(offers, ['culture', 'wellness'])).slice(0, 1)).toEqual(['Street Art Tour']);
  });

  it('drops offers that are poorly rated, barely reviewed or unrated', () => {
    const offers = [
      offer('Low', { rating: 4.1 }),
      offer('Thin', { reviewCount: 5 }),
      offer('Unrated', { rating: undefined, reviewCount: undefined }),
      offer('Good'),
    ];

    expect(titles(selectExperiences(offers, ['food']))).toEqual(['Good']);
  });

  it('shows the same tour once when two marketplaces list it', () => {
    const offers = [
      offer('Lisbon: Food & Wine Tour', { sourceId: 'getyourguide', reviewCount: 100 }),
      offer('Lisbon Food and Wine Tour', { reviewCount: 900 }),
      offer('Tile Workshop'),
    ];

    expect(titles(selectExperiences(offers, ['food']))).toEqual(['Lisbon Food and Wine Tour', 'Tile Workshop']);
  });

  it('shows one of two offers that are the same trip in other words', () => {
    const offers = [
      offer('Helsinki: Return Day Trip Ferry Ticket to Tallinn', { reviewCount: 9_000 }),
      offer('Tallinn: Return Day Trip Ferry Transfer to Helsinki', { reviewCount: 8_000 }),
      offer('Helsinki: Nuuksio National Park Hiking Tour with Food', { reviewCount: 700 }),
      offer('Helsinki: Sauna and Sea Swim', { reviewCount: 300 }),
    ];

    expect(titles(selectExperiences(offers, []))).toEqual([
      'Helsinki: Return Day Trip Ferry Ticket to Tallinn',
      'Helsinki: Nuuksio National Park Hiking Tour with Food',
      'Helsinki: Sauna and Sea Swim',
    ]);
  });

  it('keeps two different trips that merely share a destination', () => {
    const offers = [
      offer('Sintra and Cascais Small-Group Day Trip from Lisbon', { reviewCount: 9_000 }),
      offer('Small Group Tour to Sintra, Pena Palace, Cabo Roca and Cascais', { reviewCount: 8_000 }),
    ];

    expect(selectExperiences(offers, [])).toHaveLength(2);
  });

  it('puts an offer that suits the season first', () => {
    const offers = [
      offer('Sintra Day Trip', { reviewCount: 20_000 }),
      offer('Food and Wine Walking Tour', { reviewCount: 5_000 }),
      offer('Snowshoe Hike with a Guide', { reviewCount: 60 }),
      offer('Ski Day Pass', { reviewCount: 300 }),
    ];

    expect(titles(selectExperiences(offers, ['food'], ['ski', 'snowshoe']))).toEqual([
      'Ski Day Pass',
      'Food and Wine Walking Tour',
      'Sintra Day Trip',
    ]);
  });

  it('chooses as before when nothing suits the season', () => {
    const offers = [offer('Sintra Day Trip', { reviewCount: 20_000 }), offer('Food Tour', { reviewCount: 5_000 })];

    expect(titles(selectExperiences(offers, ['food'], ['ski']))).toEqual(['Food Tour', 'Sintra Day Trip']);
  });

  it('returns at most three', () => {
    const offers = ['A', 'B', 'C', 'D', 'E'].map((title) => offer(title));

    expect(selectExperiences(offers, [])).toHaveLength(3);
  });
});

describe('selectEvents', () => {
  const stay = { start: '2026-12-12', end: '2026-12-16', fromListing: true };
  function event(id: string, startDate?: string, endDate?: string): EventFact {
    return {
      id: `event:${id}`,
      kind: 'event',
      title: id,
      dateText: 'x',
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      url: `https://www.songkick.com/concerts/${id}`,
      sourceId: 'songkick',
    };
  }
  const ids = (events: EventFact[]): string[] => events.map((entry) => entry.title);

  it('keeps events that happen during the stay, soonest first', () => {
    const events = [
      event('after', '2026-12-17'),
      event('last-day', '2026-12-16'),
      event('before', '2026-12-11'),
      event('first-day', '2026-12-12'),
    ];

    expect(ids(selectEvents(events, stay))).toEqual(['first-day', 'last-day']);
  });

  it('keeps a festival that overlaps the stay', () => {
    expect(ids(selectEvents([event('festival', '2026-12-10', '2026-12-13')], stay))).toEqual(['festival']);
    expect(ids(selectEvents([event('over', '2026-12-01', '2026-12-11')], stay))).toEqual([]);
  });

  it('leaves out events without a known date', () => {
    expect(selectEvents([event('undated')], stay)).toEqual([]);
  });
});
