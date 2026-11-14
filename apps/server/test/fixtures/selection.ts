import type { ClimateFact, EventFact, ExperienceFact, PlaceFact, WeatherFact } from '@outside/shared';
import type { Selection } from '../../src/pipeline/script';

export function placeFact(id: string, overrides: Partial<PlaceFact> = {}): PlaceFact {
  return {
    id: `place:${id}`,
    kind: 'place',
    interest: 'food',
    name: id,
    rating: 4.5,
    reviewCount: 1240,
    lat: 38.7069,
    lng: -9.1459,
    imageUrl: `https://lh3.googleusercontent.com/p/${id}`,
    distanceM: 800,
    sourceId: 'google-maps:food',
    ...overrides,
  };
}

export const market = placeFact('market', { name: 'Mercado da Ribeira' });
export const museum = placeFact('museum', {
  name: 'Museu do Azulejo',
  interest: 'culture',
  rating: 4.7,
  reviewCount: 9000,
  distanceM: 1_500,
  sourceId: 'google-maps:culture',
});
export const park = placeFact('park', {
  name: 'Parque Eduardo VII',
  interest: 'nature',
  rating: 4.6,
  reviewCount: 500,
  distanceM: 2_500,
  sourceId: 'google-maps:nature',
});

export const tour: ExperienceFact = {
  id: 'exp:tour',
  kind: 'experience',
  title: 'Alfama food tour',
  amount: 45,
  currency: 'EUR',
  durationText: '3 hours',
  rating: 4.8,
  reviewCount: 1200,
  url: 'https://www.getyourguide.com/lisbon/tour',
  imageUrl: 'https://cdn.getyourguide.com/img/tour.jpg',
  sourceId: 'getyourguide',
};
export const cruise: ExperienceFact = {
  id: 'exp:cruise',
  kind: 'experience',
  title: 'Sunset cruise',
  amount: 30,
  currency: 'EUR',
  rating: 4.6,
  reviewCount: 300,
  url: 'https://www.getyourguide.com/lisbon/cruise',
  sourceId: 'getyourguide',
};

export const christmasMarket: EventFact = {
  id: 'event:market',
  kind: 'event',
  title: 'Christmas market',
  dateText: '12–24 Dec',
  startDate: '2026-12-12',
  endDate: '2026-12-24',
  url: 'https://example.com/events/market',
  sourceId: 'events',
};

export const weather: WeatherFact = {
  id: 'weather:stay',
  kind: 'weather',
  tempMinC: 8,
  tempMaxC: 17,
  precipitationChance: 60,
  sourceId: 'open-meteo',
};

export const decemberClimate: ClimateFact = {
  id: 'climate:stay',
  kind: 'climate',
  month: 'December',
  tempMinC: 9,
  tempMaxC: 15,
  wetDaysPercent: 45,
  snowDaysPercent: 0,
  conditions: 'some rain',
  sourceId: 'open-meteo-archive',
};

export const snowyClimate: ClimateFact = {
  ...decemberClimate,
  month: 'January',
  tempMinC: -6,
  tempMaxC: 3,
  snowDaysPercent: 45,
  conditions: 'snowy',
};

export function selection(overrides: Partial<Selection> = {}): Selection {
  return {
    place: { city: 'Lisbon', country: 'Portugal', locationText: 'Lisbon, Portugal', lat: 38.7223, lng: -9.1393 },
    window: { start: '2026-12-12', end: '2026-12-16', fromListing: true },
    places: [market, museum, park],
    experiences: [tour, cruise],
    events: [christmasMarket],
    weather: [weather],
    climate: [],
    ...overrides,
  };
}
