import { VideoManifestSchema, type ExperienceFact, type ListingContext, type OpeningHours, type Source } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { assembleManifest, formatDateRange, sceneImageUrls, type AssembleInput } from '../src/pipeline/assemble';
import { factMap, planScenes, templateLines, type Selection, type StoryScene } from '../src/pipeline/script';
import { silentTimings, totalFrames } from '../src/pipeline/timing';
import { christmasMarket, decemberClimate, market, museum, park, placeFact, selection, snowyClimate, tour, weather as weatherFact } from './fixtures/selection';

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

  it('puts the usual weather under the opening title', () => {
    const hookOf = (sel: Selection) => assembleManifest(input(sel)).scenes.find((scene) => scene.type === 'hook');

    expect(hookOf(selection({ climate: [snowyClimate] }))?.subtitle).toBe('12–16 Dec · usually −6 to 3 °C, snowy');
    expect(hookOf(selection({ climate: [decemberClimate] }))?.subtitle).toBe('12–16 Dec · usually 9–15 °C, some rain');
    expect(hookOf(selection())?.subtitle).toBe('12–16 Dec');
  });

  it('names the month instead of dates the listing did not give', () => {
    const undated = selection({ climate: [decemberClimate], window: { start: '2026-12-01', end: '2026-12-15', fromListing: false } });
    const hook = assembleManifest(input(undated)).scenes.find((scene) => scene.type === 'hook');

    expect(hook?.subtitle).toBe('December · usually 9–15 °C, some rain');
  });

  it('opens on the photo of the place in season when there is one', () => {
    const photo = { id: 'photo:season:0', imageUrl: 'https://upload.wikimedia.org/thumb/innsbruck-winter.jpg', sourceId: 'wikimedia-commons' };
    const sel = selection({ seasonPhotos: [photo] });
    const made = assembleManifest(input(sel, { images: mirrored(sceneImageUrls(listing, sel)) }));

    expect(sceneImageUrls(listing, sel)).toContain(photo.imageUrl);
    expect(made.scenes.find((scene) => scene.type === 'hook')?.imageUrl).toBe('/media/innsbruck-winter.jpg');
    // The listing's own photos then move one scene on, so its main photo is still shown.
    expect(made.scenes.find((scene) => scene.type === 'stay')?.imageUrl).toBe('/media/hero.jpg');
    expect(made.scenes.find((scene) => scene.type === 'outro')?.imageUrl).toBe('/media/second.jpg');
  });

  it('backs the experiences with a second photo of the place in season when no offer has a photo', () => {
    const photos = ['one', 'two'].map((name, index) => ({ id: `photo:season:${index}`, imageUrl: `https://upload.wikimedia.org/thumb/winter-${name}.jpg`, sourceId: 'wikimedia-commons' }));
    const noOfferPhotos = selection({ seasonPhotos: photos, experiences: [{ ...tour, imageUrl: undefined }] });
    const withOfferPhoto = selection({ seasonPhotos: photos, experiences: [tour] });
    const experiencesImage = (sel: Selection): string | undefined =>
      assembleManifest(input(sel, { images: mirrored(sceneImageUrls(listing, sel)) })).scenes.find((scene) => scene.type === 'experiences')?.imageUrl;

    expect(experiencesImage(noOfferPhotos)).toBe('/media/winter-two.jpg');
    expect(experiencesImage(withOfferPhoto)).toBe('/media/tour.jpg');
  });

  it('opens on the listing photo when the seasonal photo did not mirror', () => {
    const photo = { id: 'photo:season:0', imageUrl: 'https://upload.wikimedia.org/thumb/innsbruck-winter.jpg', sourceId: 'wikimedia-commons' };
    const made = assembleManifest(input(selection({ seasonPhotos: [photo] }), { images: mirrored(sceneImageUrls(listing, selection())) }));

    expect(made.scenes.find((scene) => scene.type === 'hook')?.imageUrl).toBe('/media/hero.jpg');
    expect(made.scenes.find((scene) => scene.type === 'stay')?.imageUrl).toBe('/media/second.jpg');
  });

  it('labels an activity scene with what there is to do', () => {
    const skiing = { id: 'ski', label: 'Ski & snowboard', doing: 'skiing and snowboarding' };
    const made = assembleManifest(input(selection({ places: [{ ...market, activity: skiing }, museum, park] })));
    const activities = made.scenes.filter((scene) => scene.type === 'activity');

    expect(activities[0]).toMatchObject({ title: 'Mercado da Ribeira', kicker: 'Ski & snowboard' });
    expect(activities[1]).not.toHaveProperty('kicker');
    expect(VideoManifestSchema.safeParse(made).success).toBe(true);
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

describe('an activity scene, for someone who wants to go and do it', () => {
  const skiing = { id: 'ski', label: 'Ski & snowboard', doing: 'skiing and snowboarding' };
  const glacier = placeFact('glacier', {
    name: 'Stubai Glacier',
    interest: 'adventure',
    activity: skiing,
    category: 'Ski resort',
    description: 'Popular ski mountain with various trails, a terrain park & dramatic views, plus on-mountain dining.',
    rating: 4.7,
    reviewCount: 11_817,
    distanceM: 34_000,
    sourceId: 'google-maps:adventure',
  });
  const skiDay: ExperienceFact = {
    id: 'exp:ski-day',
    kind: 'experience',
    title: 'Innsbruck: A guided Ski-Day in the capital of the Alps',
    amount: 340,
    currency: 'EUR',
    url: 'https://www.getyourguide.com/innsbruck/ski-day',
    sourceId: 'getyourguide',
  };
  const activities = (sel: Selection) => assembleManifest(input(sel)).scenes.filter((scene) => scene.type === 'activity');
  const [ski, sight] = activities(selection({ places: [glacier, museum, park], activityOffers: new Map([[glacier.id, skiDay]]) }));

  it('says what kind of place it is, how many people rated it and how far it is', () => {
    expect(ski?.subtitle).toBe('Ski resort · 4.7 rating · 11,817 reviews · ≈ 45 min drive');
  });

  it('leaves out a kind that only says what sort of business it is', () => {
    const subtitleOf = (category: string) => activities(selection({ places: [{ ...glacier, category }, museum, park] }))[0]?.subtitle;

    expect(subtitleOf('Store')).toBe('4.7 rating · 11,817 reviews · ≈ 45 min drive');
    expect(subtitleOf('Event management company')).toBe('4.7 rating · 11,817 reviews · ≈ 45 min drive');
    expect(subtitleOf('Athletic club')).toBe('4.7 rating · 11,817 reviews · ≈ 45 min drive');
    expect(subtitleOf('Swimming lake')).toBe('Swimming lake · 4.7 rating · 11,817 reviews · ≈ 45 min drive');
    expect(subtitleOf('Boat tour agency')).toBe('Boat tour agency · 4.7 rating · 11,817 reviews · ≈ 45 min drive');
  });

  it("adds the place's own description", () => {
    expect(ski?.note).toBe('Popular ski mountain with various trails, a terrain park & dramatic views, plus on-mountain dining.');
  });

  it('cuts a description that would run past two lines at a word', () => {
    const wordy = { ...glacier, description: `${'Gentle trekking route with views of the Tyrolean mountains, '.repeat(3)}known for its pines.` };
    const note = activities(selection({ places: [wordy, museum, park] }))[0]?.note ?? '';

    expect(note.length).toBeLessThanOrEqual(120);
    expect(note).toMatch(/^Gentle trekking route with views .*\p{L}…$/u);
  });

  it('shows the offer to book for it with its live price, without the marketplace prefix', () => {
    expect(ski?.items).toEqual([{ title: 'A guided Ski-Day in the capital of the Alps', detail: 'from €340' }]);
    expect(ski?.factIds).toEqual(['place:glacier', 'exp:ski-day']);
  });

  it('cuts a long offer title at a word', () => {
    const long = { ...skiDay, title: 'Neustift im Stubaital: Innsbruck-Stubai Valley: Snowshoeing in the idyllic Stubai Valley with a guide' };
    const [scene] = activities(selection({ places: [glacier, museum, park], activityOffers: new Map([[glacier.id, long]]) }));

    expect(scene?.items?.[0]?.title).toBe('Innsbruck-Stubai Valley: Snowshoeing in the idyllic Stubai…');
  });

  it('cuts a description with no spaces in it by length, and leaves out one that is only blank', () => {
    const noteOf = (description: string) => activities(selection({ places: [{ ...glacier, description }, museum, park] }))[0];

    expect(noteOf('x'.repeat(200))?.note).toBe(`${'x'.repeat(119)}…`);
    expect(noteOf('   ')).not.toHaveProperty('note');
  });

  it('keeps the front of an offer title when that is what names the activity', () => {
    const titleOf = (title: string) =>
      activities(selection({ places: [glacier, museum, park], activityOffers: new Map([[glacier.id, { ...skiDay, title }]]) }))[0]?.items?.[0]?.title;

    expect(titleOf('Rafting: Inn river for beginners')).toBe('Rafting: Inn river for beginners');
    expect(titleOf('Skiing: a guided day on the glacier')).toBe('Skiing: a guided day on the glacier');
    expect(titleOf('Neustift im Stubaital: Tandem Paragliding Flight')).toBe('Tandem Paragliding Flight');
  });

  it('shows no offer where none goes with the place', () => {
    const [alone] = activities(selection({ places: [glacier, museum, park] }));

    expect(alone).not.toHaveProperty('items');
    expect(alone?.factIds).toEqual(['place:glacier']);
  });

  it('keeps a sight to its rating and distance', () => {
    expect(sight?.subtitle).toBe('4.7 rating · ≈ 25 min walk');
    expect(sight).not.toHaveProperty('note');
    expect(sight).not.toHaveProperty('items');
  });

  it('still satisfies the shared schema', () => {
    const made = assembleManifest(input(selection({ places: [glacier, museum, park], activityOffers: new Map([[glacier.id, skiDay]]) })));

    expect(VideoManifestSchema.safeParse(made).success).toBe(true);
    expect(VideoManifestSchema.parse(made).scenes[1]?.note).toContain('terrain park');
  });
});
