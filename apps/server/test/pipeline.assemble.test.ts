import { VideoManifestSchema, type ListingContext, type OpeningHours, type Source } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { assembleManifest, formatDateRange, sceneImageUrls, type AssembleInput } from '../src/pipeline/assemble';
import { factMap, planScenes, templateLines, type Selection, type StoryScene } from '../src/pipeline/script';
import { silentTimings, totalFrames } from '../src/pipeline/timing';
import { christmasMarket, market, museum, park, placeFact, selection, tour, weather as weatherFact } from './fixtures/selection';

const listing: ListingContext = {
  site: 'airbnb',
  listingId: '12345',
  url: 'https://www.airbnb.com/rooms/12345',
  title: 'Flat with a view',
  locationText: 'Lisbon, Portugal',
  photos: ['https://a0.muscache.com/im/hero.jpg', 'https://a0.muscache.com/im/second.jpg'],
  checkIn: '2026-12-12',
  checkOut: '2026-12-16',
};

const sources: Source[] = [
  { id: 'google-maps:food', label: 'Google Maps', url: 'https://maps.google.com/a', fetchedAt: '2026-11-14T01:00:00.000Z' },
  { id: 'google-maps:culture', label: 'Google Maps', url: 'https://maps.google.com/b', fetchedAt: '2026-11-13T22:30:00.000Z' },
  { id: 'getyourguide', label: 'GetYourGuide', url: 'https://www.getyourguide.com', fetchedAt: '2026-11-14T02:00:00.000Z' },
  { id: 'google-maps:food', label: 'Google Maps', url: 'https://maps.google.com/a', fetchedAt: '2026-11-14T01:00:00.000Z' },
];

const hours: OpeningHours = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [{ open: '09:00', close: '17:00' }], 6: [] };

function scenesFor(sel: Selection): StoryScene[] {
  const plan = planScenes(sel);
  const lines = templateLines(plan, factMap(sel), sel.place);
  return plan.map((scene, index) => ({ ...scene, line: lines[index] ?? '' }));
}

/** Every image mirrors by default: original url → /media/<last path segment>. */
function mirrored(urls: string[]): Map<string, string> {
  return new Map(urls.map((url) => [url, `/media/${url.split('/').pop()}`]));
}

function input(sel: Selection = selection(), overrides: Partial<AssembleInput> = {}): AssembleInput {
  const scenes = scenesFor(sel);
  return {
    id: 'abc123',
    listing,
    interests: ['food', 'culture', 'nature'],
    sel,
    scenes,
    timings: silentTimings(scenes.map((scene) => scene.line)),
    audioUrl: '/media/voice.mp3',
    images: mirrored(sceneImageUrls(listing, sel)),
    sources,
    ...overrides,
  };
}

describe('assembleManifest', () => {
  const manifest = assembleManifest(input());
  const byType = (type: string) => manifest.scenes.filter((scene) => scene.type === type);

  it('produces a manifest that satisfies the shared schema', () => {
    expect(VideoManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({
      id: 'abc123',
      audioUrl: '/media/voice.mp3',
      listing: { title: 'Flat with a view', locationText: 'Lisbon, Portugal' },
      interests: ['food', 'culture', 'nature'],
    });
  });

  it('builds the hook from the city, trip dates and hero photo', () => {
    expect(byType('hook')[0]).toMatchObject({ title: 'Around Lisbon', subtitle: '12–16 Dec', imageUrl: '/media/hero.jpg' });
  });

  it('builds activity text from the place fact', () => {
    expect(byType('activity')[0]).toMatchObject({
      title: 'Mercado da Ribeira',
      subtitle: '4.5 rating · ≈ 13 min walk',
      imageUrl: '/media/market',
      factIds: ['place:market'],
    });
    expect(byType('activity')[2]?.subtitle).toBe('4.6 rating · ≈ 7 min drive');
  });

  it('lists experiences cheapest first with live prices', () => {
    expect(byType('experiences')[0]).toMatchObject({
      title: 'Experiences nearby',
      items: [
        { title: 'Sunset cruise', detail: 'from €30' },
        { title: 'Alfama food tour', detail: 'from €45' },
      ],
    });
  });

  it('writes sub-zero weather so it cannot be misread, and calls it snow', () => {
    const frozen = { ...weatherFact, tempMinC: -19, tempMaxC: -1, precipitationChance: 34 };
    const stay = assembleManifest(input(selection({ events: [], weather: [frozen] }))).scenes.find((scene) => scene.type === 'stay');

    expect(stay?.subtitle).toBe('−19 to −1 °C, 34% chance of snow');
  });

  it('keeps rain for a stay that only dips below zero', () => {
    const chilly = { ...weatherFact, tempMinC: -5, tempMaxC: 6, precipitationChance: 43 };
    const stay = assembleManifest(input(selection({ events: [], weather: [chilly] }))).scenes.find((scene) => scene.type === 'stay');

    expect(stay?.subtitle).toBe('−5 to 6 °C, 43% chance of rain');
  });

  it('names the venue of the event when it is known', () => {
    const concert = { ...christmasMarket, title: 'Bryan Adams', dateText: '20 November', venue: 'MEO Arena, Lisbon, Portugal' };
    const stay = assembleManifest(input(selection({ events: [concert] }))).scenes.find((scene) => scene.type === 'stay');

    expect(stay?.subtitle).toBe('Bryan Adams · MEO Arena · 20 November');
  });

  it('describes the event for the stay', () => {
    expect(byType('stay')[0]).toMatchObject({ title: 'During your stay', subtitle: 'Christmas market · 12–24 Dec' });
  });

  it('closes with the distinct source labels', () => {
    expect(byType('outro')[0]).toMatchObject({
      title: "What's outside",
      items: [
        { title: 'Google Maps', detail: '' },
        { title: 'GetYourGuide', detail: '' },
      ],
    });
  });

  it('carries timing and captions from the voice timings', () => {
    const timings = input().timings;
    expect(manifest.durationInFrames).toBe(totalFrames(timings));
    expect(manifest.scenes.map((scene) => scene.startFrame)).toEqual(timings.map((timing) => timing.startFrame));
    expect(manifest.scenes[0]?.captions[0]?.text).toBe('Step');
  });

  it('keeps each source once and stamps the oldest fetch time', () => {
    expect(manifest.sources.map((source) => source.id)).toEqual(['google-maps:food', 'google-maps:culture', 'getyourguide']);
    expect(manifest.oldestFetchedAt).toBe('2026-11-13T22:30:00.000Z');
  });

  it('describes the weather when there is no event', () => {
    const stay = assembleManifest(input(selection({ events: [] }))).scenes.find((scene) => scene.type === 'stay');
    expect(stay?.subtitle).toBe('8–17 °C, 60% chance of rain');
  });

  it('says "in the next two weeks" and drops the dates when the listing gave none', () => {
    const sel = selection({ window: { start: '2026-11-14', end: '2026-11-28', fromListing: false } });
    const scenes = assembleManifest(input(sel)).scenes;

    expect(scenes.find((scene) => scene.type === 'hook')?.subtitle).toBeUndefined();
    expect(scenes.find((scene) => scene.type === 'stay')?.title).toBe('In the next two weeks');
  });

  it('gives the stay and outro scenes their own listing photo when the listing has several', () => {
    const three = { ...listing, photos: ['hero', 'second', 'third'].map((name) => `https://a0.muscache.com/im/${name}.jpg`) };
    const made = assembleManifest(input(selection(), { listing: three, images: mirrored(sceneImageUrls(three, selection())) }));
    const imageOf = (type: string): string | undefined => made.scenes.find((scene) => scene.type === type)?.imageUrl;

    expect([imageOf('hook'), imageOf('stay'), imageOf('outro')]).toEqual(['/media/hero.jpg', '/media/second.jpg', '/media/third.jpg']);
  });

  it('reuses the first listing photo when there is only one', () => {
    const one = { ...listing, photos: ['https://a0.muscache.com/im/hero.jpg'] };
    const made = assembleManifest(input(selection(), { listing: one, images: mirrored(sceneImageUrls(one, selection())) }));

    expect(made.scenes.filter((scene) => ['hook', 'stay', 'outro'].includes(scene.type)).map((scene) => scene.imageUrl)).toEqual([
      '/media/hero.jpg',
      '/media/hero.jpg',
      '/media/hero.jpg',
    ]);
  });

  it('falls back to the listing photo when a place image did not mirror', () => {
    const images = mirrored(sceneImageUrls(listing, selection()).filter((url) => url !== market.imageUrl));
    const activity = assembleManifest(input(selection(), { images })).scenes.find((scene) => scene.type === 'activity');

    expect(activity?.imageUrl).toBe('/media/hero.jpg');
  });

  it('leaves the image out when nothing mirrored', () => {
    const scenes = assembleManifest(input(selection(), { images: new Map() })).scenes;

    expect(scenes.every((scene) => scene.imageUrl === undefined)).toBe(true);
  });

  it('carries opening hours only when the timezone is known too', () => {
    const withBoth = placeFact('market', { name: 'Mercado da Ribeira', hours, timezone: 'Europe/Lisbon' });
    const hoursOnly = { ...museum, hours };
    const scenes = assembleManifest(input(selection({ places: [withBoth, hoursOnly, park] }))).scenes;
    const activities = scenes.filter((scene) => scene.type === 'activity');

    expect(activities[0]?.place).toEqual({ hours, timezone: 'Europe/Lisbon' });
    expect(activities[1]?.place).toBeUndefined();
  });

  it('refuses mismatched scenes and timings', () => {
    const bad = input();
    expect(() => assembleManifest({ ...bad, timings: bad.timings.slice(1) })).toThrow(/timings/i);
  });

  it('refuses a manifest with no sources', () => {
    expect(() => assembleManifest(input(selection(), { sources: [] }))).toThrow(/source/i);
  });
});

describe('sceneImageUrls', () => {
  it('lists up to three listing photos, each place image and the first experience image, once each', () => {
    const sel = selection({ experiences: [tour], events: [christmasMarket] });

    expect(sceneImageUrls(listing, sel)).toEqual([
      'https://a0.muscache.com/im/hero.jpg',
      'https://a0.muscache.com/im/second.jpg',
      market.imageUrl,
      museum.imageUrl,
      park.imageUrl,
      'https://cdn.getyourguide.com/img/tour.jpg',
    ]);
  });
});

describe('formatDateRange', () => {
  it.each([
    ['2026-12-12', '2026-12-16', '12–16 Dec'],
    ['2026-11-28', '2026-12-03', '28 Nov – 3 Dec'],
    ['2026-12-30', '2027-01-02', '30 Dec – 2 Jan'],
    ['2026-12-12', '2026-12-12', '12 Dec'],
  ])('formats %s to %s', (start, end, expected) => {
    expect(formatDateRange(start, end)).toBe(expected);
  });
});
