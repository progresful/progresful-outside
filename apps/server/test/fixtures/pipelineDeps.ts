import { interestById, type ListingContext, type Source } from '@outside/shared';
import { vi } from 'vitest';
import type { MediaStore } from '../../src/media/mediaStore';
import type { PipelineDeps } from '../../src/pipeline/run';
import type { Alignment } from '../../src/pipeline/voice';
import { NOW, TODAY, makeDeps } from '../helpers';
import { christmasMarket, cruise, placeFact, tour, weather } from './selection';

export const listing: ListingContext = {
  site: 'airbnb',
  listingId: '12345',
  url: 'https://www.airbnb.com/rooms/12345',
  title: 'Flat with a view',
  locationText: 'Lisbon, Portugal',
  lat: 38.7223,
  lng: -9.1393,
  photos: ['https://a0.muscache.com/im/hero.jpg'],
  checkIn: '2026-12-12',
  checkOut: '2026-12-16',
};

export function source(id: string, label: string): Source {
  return { id, label, url: `https://example.com/${id}`, fetchedAt: new Date(NOW).toISOString() };
}

/** Every character of the joined lines takes `per` seconds. */
export function alignFor(lines: readonly string[], per = 0.05): Alignment {
  const characters = [...lines.join('\n')];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * per),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * per),
  };
}

export function memoryStore(): MediaStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    put: async (name, data) => {
      files.set(name, data);
      return `/media/${name}`;
    },
    sweep: async () => 0,
  };
}

function imageResponse(): Response {
  return new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

/** Working stubs for every external call: two good places per interest, prices, an event, weather, a voice. */
export function pipelineDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    ...makeDeps({ fetch: vi.fn().mockImplementation(async () => imageResponse()) }),
    sources: {
      places: vi.fn(async (_deps, p) => {
        const label = interestById(p.interest).shortLabel;
        const shared = { interest: p.interest, sourceId: `google-maps:${p.interest}`, ...(p.activity ? { activity: p.activity } : {}) };
        return {
          facts: [
            placeFact(`${p.interest}-a`, { ...shared, name: `${label} Alpha`, rating: 4.6 }),
            placeFact(`${p.interest}-b`, { ...shared, name: `${label} Beta`, rating: 4.4 }),
          ],
          source: source(`google-maps:${p.interest}`, 'Google Maps'),
        };
      }),
      experiences: vi.fn(async () => [{ facts: [tour, cruise], source: source('getyourguide', 'GetYourGuide') }]),
      events: vi.fn(async () => ({ facts: [christmasMarket], source: source('events', 'Eventbrite') })),
      weather: vi.fn(async () => ({ facts: [weather], source: source('open-meteo', 'Open-Meteo') })),
      // No usual weather and no seasonal photo unless a test supplies them.
      climate: vi.fn(async () => ({ facts: [], source: null })),
      seasonPhoto: vi.fn(async () => ({ facts: [], source: null })),
      placePhoto: vi.fn(async () => ({ facts: [], source: null })),
    },
    // No model in tests: the pipeline falls back to the template script, which is valid by construction.
    complete: vi.fn().mockRejectedValue(new Error('no model in tests')),
    synthesize: vi.fn(async (lines: readonly string[]) => ({ audio: Buffer.from('mp3'), alignment: alignFor(lines) })),
    media: memoryStore(),
    today: () => TODAY,
    // Every host a test names is treated as a public one.
    lookup: async () => ['93.184.216.34'],
    ...overrides,
  };
}
