import type { EventFact, ExperienceFact, InterestId, PlaceFact } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { placeSearches, type Activity } from '../src/pipeline/activities';
import { seasonOf } from '../src/pipeline/season';
import { MIN_PLACES, pairOffers, scorePlace, selectEvents, selectExperiences, selectPlaces, spokenTravel, travelLabel } from '../src/pipeline/select';

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
    expect(travelLabel(9_000)).toBe('≈ 19 min drive');
  });

  it('drives faster once out of town and faster still on a long run, so a ski area 45 minutes away is not called an hour and a half', () => {
    expect(travelLabel(34_000)).toBe('≈ 45 min drive');
    expect(travelLabel(39_000)).toBe('≈ 50 min drive');
  });

  it('rounds a longer drive to five minutes, in writing and in speech', () => {
    expect(travelLabel(19_000)).toBe('≈ 30 min drive');
    expect(spokenTravel(19_000)).toBe('about 30 minutes by car');
  });

  it('never says zero minutes', () => {
    expect(travelLabel(0)).toBe('≈ 1 min walk');
  });
});

describe('selectPlaces for planned activity searches', () => {
  const season = seasonOf(
    { id: 'climate:stay', kind: 'climate', month: 'January', tempMinC: -6, tempMaxC: 3, wetDaysPercent: 40, snowDaysPercent: 30, conditions: 'some snow', sourceId: 'open-meteo-archive' },
    { start: '2027-01-15', end: '2027-01-20', fromListing: true },
    47,
  );
  const searches = placeSearches(['adventure'], season);
  const [ski, sled, skate] = searches.map((search) => search.activity) as [Activity, Activity, Activity];
  const doing = (activity: Activity, id: string, overrides: Partial<PlaceFact> = {}): PlaceFact =>
    place(id, 'adventure', { activity: { id: activity.id, label: activity.label, doing: activity.doing }, ...overrides });

  it('shows one place for each activity, in the order they were searched', () => {
    const places = [
      doing(skate, 'rink', { distanceM: 2_000 }),
      doing(ski, 'big-resort', { reviewCount: 9_000, distanceM: 20_000 }),
      doing(ski, 'small-resort', { reviewCount: 800, distanceM: 15_000 }),
      doing(sled, 'toboggan-run', { reviewCount: 300, distanceM: 8_000 }),
    ];

    expect(names(selectPlaces(places, ['adventure'], searches))).toEqual(['big-resort', 'toboggan-run', 'rink']);
  });

  it('lets an activity be as far away as people travel for it', () => {
    const glacier = doing(ski, 'glacier', { distanceM: 38_000 });
    const tooFar = doing(ski, 'another-valley', { distanceM: 41_000 });
    const farRink = doing(skate, 'far-rink', { distanceM: 16_000 });

    expect(names(selectPlaces([glacier, tooFar, farRink], ['adventure'], searches))).toEqual(['glacier']);
  });

  it('accepts fewer reviews for an activity than for a sight', () => {
    const run = doing(sled, 'quiet-run', { reviewCount: 12 });
    const cafe = place('quiet-cafe', 'food', { reviewCount: 12 });

    expect(names(selectPlaces([run, cafe], ['adventure', 'food'], searches))).toEqual(['quiet-run']);
  });

  it('does not let a short drive count against a ski area the way it would against a café', () => {
    const resort = doing(ski, 'resort', { reviewCount: 5_000, distanceM: 20_000 });
    const hill = doing(ski, 'village-hill', { reviewCount: 60, distanceM: 2_000 });

    expect(names(selectPlaces([hill, resort], ['adventure'], searches))[0]).toBe('resort');
  });

  it('trusts only what Maps listed first or second for an activity', () => {
    // "cross-country ski trail" lists a real trail first, then drifts to every famous ski lift.
    const trail = doing(sled, 'real-run', { reviewCount: 17, rank: 0 });
    const famous = doing(sled, 'famous-cable-car', { reviewCount: 5_600, rank: 5 });
    const second = doing(sled, 'second-run', { reviewCount: 40, rank: 1 });

    expect(names(selectPlaces([famous, trail, second], ['adventure'], searches))).toEqual(['real-run', 'second-run']);
  });

  it('takes the first place Maps listed for an activity when it is good enough', () => {
    const first = doing(ski, 'first', { reviewCount: 60, rank: 0 });
    const secondAndFamous = doing(ski, 'second', { reviewCount: 9_000, rank: 1 });
    const firstButUnrated = doing(skate, 'unrated-rink', { reviewCount: 3, rank: 0 });
    const secondRink = doing(skate, 'rink', { reviewCount: 200, rank: 1 });

    expect(names(selectPlaces([secondAndFamous, first, firstButUnrated, secondRink], ['adventure'], searches))).toEqual(['first', 'rink', 'second']);
  });

  it('fills up with a second place for an activity only after every activity has had its turn', () => {
    const places = [doing(ski, 'resort-a', { reviewCount: 9_000 }), doing(ski, 'resort-b', { reviewCount: 8_000 }), doing(sled, 'run', { reviewCount: 100 })];

    expect(names(selectPlaces(places, ['adventure'], searches))).toEqual(['resort-a', 'run', 'resort-b']);
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
      'Snowshoe Hike with a Guide',
      'Food and Wine Walking Tour',
    ]);
  });

  it('puts up to two offers for the planned activities first', () => {
    const offers = [
      offer('Sintra Day Trip', { reviewCount: 20_000 }),
      offer('Snowshoe Hike with a Guide', { reviewCount: 60 }),
      offer('Ski Day Pass', { reviewCount: 300 }),
      offer('Sleigh Ride', { reviewCount: 90 }),
    ];

    expect(titles(selectExperiences(offers, [], ['ski', 'snowshoe', 'sleigh']))).toEqual(['Ski Day Pass', 'Sleigh Ride', 'Sintra Day Trip']);
  });

  it('counts what an active person books as adventure', () => {
    const active = ['Tandem Paragliding Flight', 'Guided Ski-Day', 'Canyoning for Beginners', 'Scenic eBike Tour', 'Snowshoeing in the Valley'];

    for (const title of active) {
      const offers = [offer('Old Town Walking Tour', { reviewCount: 9_000 }), offer(title, { reviewCount: 30 })];
      expect(titles(selectExperiences(offers, ['adventure']))[0]).toBe(title);
    }
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

describe('pairOffers', () => {
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
  const skiing = { id: 'ski', label: 'Ski & snowboard', doing: 'skiing and snowboarding' };
  const snowshoeing = { id: 'snowshoe', label: 'Snowshoe & winter walks', doing: 'snowshoeing and winter walks' };
  const words = new Map<string, readonly string[]>([
    ['ski', ['skiing', 'ski day', 'snowboard']],
    ['snowshoe', ['snowshoe', 'snowshoeing']],
  ]);
  const glacier = place('glacier', 'adventure', { activity: skiing });
  const trail = place('trail', 'nature', { activity: snowshoeing });
  const paired = (places: PlaceFact[], offers: ExperienceFact[]): Array<[string, string]> =>
    [...pairOffers(places, offers, words)].map(([placeId, found]) => [placeId, found.title]);

  it('gives each activity place the best-reviewed offer that names its activity', () => {
    const offers = [
      offer('Old Town Walking Tour', { reviewCount: 9_000 }),
      offer('Guided Ski Day', { reviewCount: 40 }),
      offer('Snowboard Lesson for Beginners', { reviewCount: 400 }),
      offer('Snowshoeing in the Valley', { reviewCount: 25 }),
    ];

    expect(paired([glacier, trail], offers)).toEqual([
      ['place:glacier', 'Snowboard Lesson for Beginners'],
      ['place:trail', 'Snowshoeing in the Valley'],
    ]);
  });

  it('accepts an offer with only a handful of reviews: few people review a snowshoe hike', () => {
    expect(paired([trail], [offer('Snowshoeing in the Valley', { rating: 5, reviewCount: 2 })])).toEqual([['place:trail', 'Snowshoeing in the Valley']]);
  });

  it('takes an offer nobody has rated yet only when no rated one is on sale', () => {
    const unrated = offer('Snowshoeing by Moonlight', { rating: undefined, reviewCount: undefined });
    const rated = offer('Snowshoeing in the Valley', { rating: 4.6, reviewCount: 3 });

    expect(paired([trail], [unrated, rated])).toEqual([['place:trail', 'Snowshoeing in the Valley']]);
    expect(paired([trail], [unrated])).toEqual([['place:trail', 'Snowshoeing by Moonlight']]);
  });

  it('never shows a poorly rated offer', () => {
    expect(paired([trail], [offer('Snowshoeing in the Valley', { rating: 4.2, reviewCount: 900 })])).toEqual([]);
  });

  it('matches whole words, so a ski jump ticket is not skiing', () => {
    expect(paired([glacier], [offer('Ski Jump Arena Entrance Ticket')])).toEqual([]);
  });

  it('shows one offer once when two places are for the same activity', () => {
    const second = place('second-glacier', 'adventure', { activity: skiing });
    const offers = [offer('Guided Ski Day', { reviewCount: 40 }), offer('Snowboard Lesson for Beginners', { reviewCount: 400 })];

    expect(paired([glacier, second], offers)).toEqual([
      ['place:glacier', 'Snowboard Lesson for Beginners'],
      ['place:second-glacier', 'Guided Ski Day'],
    ]);
  });

  it('gives an offer to the activity its title names most exactly', () => {
    const crossCountry = place('loipe', 'nature', { activity: { id: 'cross-country', label: 'Cross-country skiing', doing: 'cross-country skiing' } });
    const all = new Map<string, readonly string[]>([...words, ['cross-country', ['cross-country', 'nordic']]]);
    const offers = [offer('Cross-country skiing day', { reviewCount: 900 }), offer('Guided Ski Day', { reviewCount: 40 })];
    const pairs = (places: PlaceFact[]): Array<[string, string]> => [...pairOffers(places, offers, all)].map(([placeId, found]) => [placeId, found.title]);

    expect(pairs([glacier, crossCountry])).toEqual([
      ['place:glacier', 'Guided Ski Day'],
      ['place:loipe', 'Cross-country skiing day'],
    ]);
    // Also when no place for cross-country skiing is in the video: it is still not a downhill offer.
    expect(pairs([glacier])).toEqual([['place:glacier', 'Guided Ski Day']]);
  });

  it('leaves a sight without an offer', () => {
    expect(paired([place('cathedral', 'history')], [offer('Guided Ski Day')])).toEqual([]);
  });
});

describe('selectExperiences beside offers that already go with an activity', () => {
  function offer(title: string, sourceId: string, reviewCount: number): ExperienceFact {
    return { id: `exp:${sourceId}:${title}`, kind: 'experience', title, amount: 50, currency: 'EUR', rating: 4.8, reviewCount, url: `https://example.com/${sourceId}`, sourceId };
  }

  it('does not list the offer again, nor the same trip from the other marketplace', () => {
    const shown = offer('Innsbruck: Tandem Paragliding Flight', 'getyourguide', 300);
    const offers = [shown, offer('Innsbruck Tandem Paragliding Flight', 'viator', 200), offer('Old Town Walking Tour', 'viator', 100)];

    expect(selectExperiences(offers, [], [], [shown]).map((entry) => entry.title)).toEqual(['Old Town Walking Tour']);
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
