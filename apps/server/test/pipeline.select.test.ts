import type { InterestId, PlaceFact } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { MIN_PLACES, scorePlace, selectPlaces, travelLabel } from '../src/pipeline/select';

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
