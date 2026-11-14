import { VideoManifestSchema } from '@outside/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError } from '../src/contextdev/client';
import { NotEnoughDataError, PHOTO_DEADLINE_MS, TEMPLATE_VERSION, runPipeline, type StageUpdate } from '../src/pipeline/run';
import { alignFor, listing, memoryStore, pipelineDeps, source } from './fixtures/pipelineDeps';
import { christmasMarket, placeFact, snowyClimate, tour } from './fixtures/selection';

const input = { videoId: 'abcdef0123456789', listing, interests: ['food', 'culture', 'nature'] as const };
const request = { ...input, interests: [...input.interests] };

function types(manifest: { scenes: Array<{ type: string }> }): string[] {
  return manifest.scenes.map((scene) => scene.type);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runPipeline', () => {
  it('has a template version for the cache key, raised when the video gained its seasonal opening', () => {
    expect(TEMPLATE_VERSION).toBe(5);
  });

  it('emits stages in order and returns a valid manifest', async () => {
    const stages: StageUpdate[] = [];
    const deps = pipelineDeps();

    const manifest = await runPipeline(deps, request, (update) => stages.push(update));

    expect(stages.map((s) => [s.status, s.stage])).toEqual([
      ['gathering', 'Reading the neighbourhood'],
      ['gathering', 'Finding food spots'],
      ['gathering', 'Finding museum spots'],
      ['gathering', 'Finding hiking'],
      ['gathering', 'Finding viewpoints'],
      ['gathering', 'Checking live prices'],
      ['writing', 'Writing the script'],
      ['voicing', 'Recording voiceover'],
    ]);
    const progress = stages.map((s) => s.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(VideoManifestSchema.safeParse(manifest).success).toBe(true);
    expect(types(manifest)).toEqual(['hook', 'activity', 'activity', 'activity', 'experiences', 'stay', 'outro']);
    expect(manifest.id).toBe('abcdef0123456789');
  });

  it('stores the voice and mirrors the images into the media store', async () => {
    const media = memoryStore();

    const manifest = await runPipeline(pipelineDeps({ media }), request, () => {});

    expect(manifest.audioUrl).toBe('/media/abcdef0123456789.mp3');
    expect(media.files.get('abcdef0123456789.mp3')?.toString()).toBe('mp3');
    expect(manifest.scenes.every((scene) => scene.imageUrl?.startsWith('/media/'))).toBe(true);
  });

  it('asks the date-aware sources about the trip dates', async () => {
    const deps = pipelineDeps();

    await runPipeline(deps, request, () => {});

    const window = { start: '2026-12-12', end: '2026-12-16', fromListing: true };
    expect(deps.sources.events).toHaveBeenCalledWith(expect.anything(), { city: 'Lisbon', country: 'Portugal' });
    expect(deps.sources.weather).toHaveBeenCalledWith(
      expect.anything(),
      { lat: 38.7223, lng: -9.1393, window, today: '2026-11-14' },
    );
  });

  it('asks the marketplaces for prices in the currency the listing is shown in', async () => {
    const deps = pipelineDeps();

    await runPipeline(deps, { ...request, listing: { ...listing, currency: 'GBP' } }, () => {});

    expect(deps.sources.experiences).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ city: 'Lisbon', country: 'Portugal', currency: 'GBP' }),
    );
  });

  it('passes the stay dates to the marketplaces', async () => {
    const deps = pipelineDeps();

    await runPipeline(deps, request, () => {});

    expect(deps.sources.experiences).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ window: { start: '2026-12-12', end: '2026-12-16' } }),
    );
  });

  describe('with the usual weather for the dates', () => {
    const snowy = async () => ({ facts: [snowyClimate], source: source('open-meteo-archive', 'Open-Meteo (past years)') });
    const queriesOf = (deps: ReturnType<typeof pipelineDeps>): string[] =>
      vi.mocked(deps.sources.places).mock.calls.map(([, params]) => `${params.interest}: ${params.query}`);

    it('asks for it at the listing and the stay dates', async () => {
      const deps = pipelineDeps();

      await runPipeline(deps, request, () => {});

      expect(deps.sources.climate).toHaveBeenCalledWith(expect.anything(), {
        lat: 38.7223,
        lng: -9.1393,
        window: { start: '2026-12-12', end: '2026-12-16', fromListing: true },
        today: '2026-11-14',
      });
    });

    it('searches for places that suit it', async () => {
      const base = pipelineDeps();
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy) } };

      await runPipeline(deps, { ...request, interests: ['nature', 'culture', 'adventure'] }, () => {});

      // Winter things to do, the interests taking turns, within the four searches a video may make.
      expect(queriesOf(deps)).toEqual([
        'nature: winter hiking trail',
        'culture: museum',
        'adventure: ski resort',
        'nature: cross-country ski trail',
      ]);
    });

    it('searches for what can be done in any weather when it is not known', async () => {
      const deps = pipelineDeps();

      await runPipeline(deps, { ...request, interests: ['nature', 'culture', 'adventure'] }, () => {});

      expect(queriesOf(deps)).toEqual(['nature: hiking trail', 'culture: museum', 'adventure: bike park', 'nature: viewpoint']);
    });

    it('gives an active person several different things to do, each labelled', async () => {
      const base = pipelineDeps();
      const places = vi.fn<typeof base.sources.places>(async (_deps, params) => ({
        facts: [placeFact(`spot-${params.query}`, { name: `Spot for ${params.query}`, interest: params.interest, ...(params.activity ? { activity: params.activity } : {}) })],
        source: source(`google-maps:${params.interest}`, 'Google Maps'),
      }));
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['adventure'] }, () => {});

      const activities = manifest.scenes.filter((scene) => scene.type === 'activity');
      expect(activities.map((scene) => [scene.kicker, scene.title])).toEqual([
        ['Ski & snowboard', 'Spot for ski resort'],
        ['Sledding', 'Spot for toboggan run'],
        ['Ice skating', 'Spot for ice skating rink'],
      ]);
    });

    it('leaves out a place that is only for the other half of the year', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) => {
        if (params.query !== 'toboggan run') {
          return usual!(sourceDeps, params);
        }
        const tagged = { interest: params.interest, ...(params.activity ? { activity: params.activity } : {}) };
        return {
          facts: [
            placeFact('summer-slide', { ...tagged, name: 'Sommerrodelbahn (Alpine Slide)', category: 'Summer toboggan run', rank: 0 }),
            placeFact('winter-run', { ...tagged, name: 'Rumer Alm', category: 'Mountain cabin', rank: 1 }),
          ],
          source: source('google-maps:adventure', 'Google Maps'),
        };
      });
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['adventure'] }, () => {});

      const sledding = manifest.scenes.find((scene) => scene.kicker === 'Sledding');
      expect(sledding?.title).toBe('Rumer Alm');
      expect(manifest.scenes.map((scene) => scene.title)).not.toContain('Sommerrodelbahn (Alpine Slide)');
    });

    it('leaves out a place that Maps offered for an activity when it is plainly for another one', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) => {
        if (params.query !== 'toboggan run') {
          return usual!(sourceDeps, params);
        }
        const tagged = { interest: params.interest, ...(params.activity ? { activity: params.activity } : {}) };
        return {
          facts: [
            placeFact('ski-jump', { ...tagged, name: 'Bergisel Ski Jump', category: 'Tourist attraction', rank: 0 }),
            placeFact('winter-run', { ...tagged, name: 'Rodelbahn Rumer Alm', category: 'Mountain cabin', rank: 1 }),
          ],
          source: source('google-maps:adventure', 'Google Maps'),
        };
      });
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['adventure'] }, () => {});

      expect(manifest.scenes.find((scene) => scene.kicker === 'Sledding')?.title).toBe('Rodelbahn Rumer Alm');
      expect(manifest.scenes.map((scene) => scene.title)).not.toContain('Bergisel Ski Jump');
    });

    it('shows a business by its name, without the keywords tacked onto it', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) => {
        if (params.query !== 'toboggan run') {
          return usual!(sourceDeps, params);
        }
        const tagged = { interest: params.interest, ...(params.activity ? { activity: params.activity } : {}) };
        return {
          facts: [placeFact('padded', { ...tagged, name: 'Rumer Alm - Rodelbahn - Restaurant - Rodelverleih', category: 'Store', rank: 0 })],
          source: source('google-maps:adventure', 'Google Maps'),
        };
      });
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['adventure'] }, () => {});

      expect(manifest.scenes.find((scene) => scene.kicker === 'Sledding')?.title).toBe('Rumer Alm');
    });

    it('falls back to the usual search when a seasonal one for a place-kind interest finds nothing nearby', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) => {
        if (params.query === 'cosy restaurant') {
          // Something was found, but a day's drive away.
          return { facts: [placeFact('far', { interest: 'food', distanceM: 300_000 })], source: source('google-maps:food', 'Google Maps') };
        }
        return usual!(sourceDeps, params);
      });
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['food', 'culture', 'history'] }, () => {});

      expect(queriesOf(deps).sort()).toEqual(['culture: museum', 'food: cosy restaurant', 'food: local restaurants', 'history: historic landmark']);
      expect(types(manifest).filter((type) => type === 'activity')).toHaveLength(3);
    });

    it('searches the interests broadly when the activities leave too little to show', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) =>
        // No ski area, toboggan run or ice rink anywhere near.
        params.activity ? { facts: [], source: null } : usual!(sourceDeps, params),
      );
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['adventure', 'nature'] }, () => {});

      // "ski resort" was already asked as an activity, so adventure falls back to its usual search.
      expect(queriesOf(deps)).toEqual(expect.arrayContaining(['adventure: ski resort', 'adventure: outdoor activities', 'nature: winter activities']));
      expect(types(manifest).filter((type) => type === 'activity')).toHaveLength(3);
    });

    it('searches the interests broadly when what the activities found is not good enough to show', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) =>
        params.activity
          ? {
              // Plenty of places nearby, none with enough reviews to be shown.
              facts: [1, 2, 3].map((n) =>
                placeFact(`${params.query}-${n}`, { interest: params.interest, activity: params.activity, name: `Spot ${n} for ${params.query}`, reviewCount: 4 }),
              ),
              source: source(`google-maps:${params.interest}`, 'Google Maps'),
            }
          : usual!(sourceDeps, params),
      );
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['adventure', 'nature'] }, () => {});

      expect(queriesOf(deps)).toEqual(expect.arrayContaining(['adventure: outdoor activities', 'nature: winter activities']));
      expect(types(manifest).filter((type) => type === 'activity')).toHaveLength(3);
    });

    it('does not take a town called Winterthur for a winter-only place', async () => {
      const base = pipelineDeps();
      const warm = async () => ({
        facts: [{ ...snowyClimate, month: 'July', tempMinC: 15, tempMaxC: 27, snowDaysPercent: 0, conditions: 'mostly dry' as const }],
        source: source('open-meteo-archive', 'Open-Meteo (past years)'),
      });
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) => {
        if (params.activity?.id !== 'swim') {
          return usual!(sourceDeps, params);
        }
        return {
          facts: [
            placeFact('town-pool', { interest: params.interest, activity: params.activity, name: 'Freibad Winterthur', category: 'Outdoor swimming pool', rank: 0 }),
            placeFact('winter-pool', { interest: params.interest, activity: params.activity, name: 'Winterbad am See', category: 'Swimming lake', rank: 1 }),
          ],
          source: source('google-maps:water', 'Google Maps'),
        };
      });
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(warm), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['water'] }, () => {});

      const titles = manifest.scenes.map((scene) => scene.title);
      expect(titles).toContain('Freibad Winterthur');
      expect(titles).not.toContain('Winterbad am See');
    });

    it('trusts a place that says nothing of the activity only as the first answer Maps gave', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) => {
        if (params.query !== 'toboggan run') {
          return usual!(sourceDeps, params);
        }
        const tagged = { interest: params.interest, ...(params.activity ? { activity: params.activity } : {}) };
        return {
          facts: [
            placeFact('first', { ...tagged, name: 'Rumer Alm', category: 'Mountain cabin', rank: 0 }),
            placeFact('second', { ...tagged, name: 'Gasthof Post', category: 'Restaurant', rating: 4.9, reviewCount: 9_000, rank: 1 }),
          ],
          source: source('google-maps:adventure', 'Google Maps'),
        };
      });
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['adventure'] }, () => {});

      expect(manifest.scenes.find((scene) => scene.kicker === 'Sledding')?.title).toBe('Rumer Alm');
      expect(manifest.scenes.map((scene) => scene.title)).not.toContain('Gasthof Post');
    });

    it('opens the video with it and cites where it came from', async () => {
      const base = pipelineDeps();
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy) } };

      const manifest = await runPipeline(deps, request, () => {});

      expect(manifest.scenes[0]).toMatchObject({ type: 'hook', subtitle: '12–16 Dec · usually −6 to 3 °C, snowy', factIds: ['climate:stay'] });
      expect(manifest.sources.map((entry) => entry.label)).toContain('Open-Meteo (past years)');
    });

    describe('with an offer to book for one of the activities', () => {
      const skiDay = { ...tour, id: 'exp:ski', title: 'Guided Ski Day', amount: 340, reviewCount: 300, sourceId: 'viator' };
      const busTour = { ...tour, id: 'exp:bus', title: 'City Bus Tour', reviewCount: 9_000, sourceId: 'viator' };
      const build = async (offers: Array<typeof tour>) => {
        const base = pipelineDeps();
        const places = vi.fn<typeof base.sources.places>(async (_deps, params) => ({
          facts: [placeFact(`spot-${params.query}`, { name: `Spot for ${params.query}`, interest: params.interest, ...(params.activity ? { activity: params.activity } : {}) })],
          source: source(`google-maps:${params.interest}`, 'Google Maps'),
        }));
        const experiences = vi.fn(async () => [{ facts: offers, source: source('viator', 'Viator') }]);
        const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places, experiences } };
        return runPipeline(deps, { ...request, interests: ['adventure'] }, () => {});
      };

      it('shows it beside that activity, with its live price', async () => {
        const manifest = await build([busTour, skiDay]);
        const skiing = manifest.scenes.find((scene) => scene.kicker === 'Ski & snowboard');

        expect(skiing?.items).toEqual([{ title: 'Guided Ski Day', detail: 'from €340' }]);
        expect(skiing?.factIds).toEqual(['place:spot-ski resort', 'exp:ski']);
        expect(manifest.scenes.find((scene) => scene.kicker === 'Sledding')).not.toHaveProperty('items');
      });

      it('does not list it a second time among the experiences', async () => {
        const manifest = await build([busTour, skiDay]);

        expect(manifest.scenes.find((scene) => scene.type === 'experiences')?.items?.map((item) => item.title)).toEqual(['City Bus Tour']);
      });

      it('credits the marketplace even when that offer is all the video shows from it', async () => {
        const manifest = await build([skiDay]);

        expect(types(manifest)).not.toContain('experiences');
        expect(manifest.sources.map((cited) => cited.label)).toContain('Viator');
      });
    });

    it('prefers a bookable offer that suits it', async () => {
      const base = pipelineDeps();
      const offers = [
        { ...tour, id: 'exp:a', title: 'City Bus Tour', reviewCount: 9_000 },
        { ...tour, id: 'exp:b', title: 'Old Town Walk', reviewCount: 8_000 },
        { ...tour, id: 'exp:c', title: 'Harbour Stroll', reviewCount: 7_000 },
        { ...tour, id: 'exp:d', title: 'Husky Ride', reviewCount: 90 },
      ];
      const experiences = vi.fn(async () => [{ facts: offers, source: source('viator', 'Viator') }]);
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), experiences } };

      const manifest = await runPipeline(deps, request, () => {});

      // None of the four matches food, museums or nature, nor an activity that was searched for;
      // only the season lifts the least-reviewed one in.
      expect(manifest.scenes.find((scene) => scene.type === 'experiences')?.items?.map((item) => item.title)).toContain('Husky Ride');
    });

    it('still builds the video when it and the seasonal photo cannot be fetched', async () => {
      const onSourceError = vi.fn();
      const base = pipelineDeps({ onSourceError });
      const deps = {
        ...base,
        sources: { ...base.sources, climate: vi.fn().mockRejectedValue(new Error('archive down')), seasonPhoto: vi.fn().mockRejectedValue(new Error('commons down')) },
      };

      const manifest = await runPipeline(deps, request, () => {});

      expect(manifest.scenes[0]).toMatchObject({ type: 'hook', subtitle: '12–16 Dec', factIds: [] });
      expect(onSourceError).toHaveBeenCalledWith('climate', expect.any(Error));
      expect(onSourceError).toHaveBeenCalledWith('season-photo', expect.any(Error));
    });
  });

  describe('with a photo of the place in season', () => {
    const photo = { id: 'photo:season:0', imageUrl: 'https://upload.wikimedia.org/thumb/lisbon-winter.jpg', sourceId: 'wikimedia-commons' };
    const found = async () => ({ facts: [photo], source: source('wikimedia-commons', 'Wikimedia Commons') });

    it('searches for the city in the season of the stay', async () => {
      const deps = pipelineDeps();

      await runPipeline(deps, request, () => {});

      expect(deps.sources.seasonPhoto).toHaveBeenCalledWith(expect.anything(), { city: 'Lisbon', query: 'Lisbon winter' });
    });

    it('opens on it and credits Wikimedia Commons', async () => {
      const base = pipelineDeps();
      const deps = { ...base, sources: { ...base.sources, seasonPhoto: vi.fn(found) } };

      const manifest = await runPipeline(deps, request, () => {});

      expect(manifest.scenes[0]?.imageUrl).toMatch(/^\/media\//);
      expect(manifest.scenes[0]?.imageUrl).not.toBe(manifest.scenes.at(-1)?.imageUrl);
      expect(manifest.sources.map((entry) => entry.label)).toContain('Wikimedia Commons');
    });

    it('does not credit a photo that could not be downloaded', async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) =>
        String(url).includes('wikimedia.org')
          ? new Response('', { status: 404 })
          : new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );
      const base = pipelineDeps({ fetch: fetchMock as typeof fetch });
      const deps = { ...base, sources: { ...base.sources, seasonPhoto: vi.fn(found) } };

      const manifest = await runPipeline(deps, request, () => {});

      expect(manifest.sources.map((entry) => entry.label)).not.toContain('Wikimedia Commons');
      expect(manifest.scenes[0]?.imageUrl).toMatch(/^\/media\//);
    });
  });

  describe('with photos of the places in season', () => {
    const snowy = async () => ({ facts: [snowyClimate], source: source('open-meteo-archive', 'Open-Meteo (past years)') });
    const ORIGINAL = 'https://www.tyrol.example/photos/park-in-snow.jpg';
    const COPY = 'https://ts1.mm.bing.net/th?id=OIP.park&w=1280&h=720&c=7&rs=1';
    const found = vi.fn(async (_deps: unknown, p: { placeId: string; placeName: string }) => ({
      facts: [{ id: `photo:${p.placeId}`, imageUrl: ORIGINAL, fallbackUrl: COPY, sourceId: 'bing-images' }],
      source: source('bing-images', 'Bing Images'),
    }));
    /** Every image downloads, except the addresses the predicate refuses. */
    const fetchExcept = (refused: (url: string) => boolean) =>
      vi.fn(async (url: string | URL | Request) =>
        refused(String(url)) ? new Response('', { status: 404 }) : new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      ) as unknown as typeof fetch;
    const imageOf = (manifest: { scenes: Array<{ type: string; title?: string; imageUrl?: string }> }, title: string): string | undefined =>
      manifest.scenes.find((scene) => scene.type === 'activity' && scene.title === title)?.imageUrl;

    function deps(overrides: Partial<ReturnType<typeof pipelineDeps>> = {}) {
      const base = pipelineDeps(overrides);
      return { ...base, sources: { ...base.sources, climate: vi.fn(snowy), placePhoto: vi.fn(found) } };
    }

    it('searches a seasonal photo for the places shown from outside, not for the restaurant', async () => {
      const d = deps();

      await runPipeline(d, request, () => {});

      const searched = vi.mocked(d.sources.placePhoto).mock.calls.map(([, params]) => params.placeName);
      expect(searched.sort()).toEqual(['Museums Alpha', 'Nature Alpha']);
      expect(d.sources.placePhoto).toHaveBeenCalledWith(expect.anything(), {
        placeId: 'place:nature-a',
        placeName: 'Nature Alpha',
        city: 'Lisbon',
        query: 'Nature Alpha Lisbon snowshoeing winter snow',
      });
    });

    it('shows the seasonal photo in place of the stock one and credits the search', async () => {
      const plain = await runPipeline(pipelineDeps(), request, () => {});
      const seasonal = await runPipeline(deps(), request, () => {});

      expect(imageOf(seasonal, 'Nature Alpha')).toMatch(/^\/media\//);
      expect(imageOf(seasonal, 'Nature Alpha')).not.toBe(imageOf(plain, 'Nature Alpha'));
      expect(imageOf(seasonal, 'Food Alpha')).toBe(imageOf(plain, 'Food Alpha'));
      expect(seasonal.sources.map((entry) => entry.label)).toContain('Bing Images');
    });

    it('uses the search engine copy when the original cannot be downloaded', async () => {
      const withOriginal = await runPipeline(deps(), request, () => {});
      const withCopy = await runPipeline(deps({ fetch: fetchExcept((url) => url === ORIGINAL) }), request, () => {});

      expect(imageOf(withCopy, 'Nature Alpha')).toMatch(/^\/media\//);
      expect(imageOf(withCopy, 'Nature Alpha')).not.toBe(imageOf(withOriginal, 'Nature Alpha'));
      expect(withCopy.sources.map((entry) => entry.label)).toContain('Bing Images');
    });

    it('keeps the stock photo, uncredited, when neither can be downloaded', async () => {
      const plain = await runPipeline(pipelineDeps(), request, () => {});
      const neither = await runPipeline(deps({ fetch: fetchExcept((url) => url === ORIGINAL || url === COPY) }), request, () => {});

      expect(imageOf(neither, 'Nature Alpha')).toBe(imageOf(plain, 'Nature Alpha'));
      expect(neither.sources.map((entry) => entry.label)).not.toContain('Bing Images');
    });

    it('never fetches a found photo from a host that is not public', async () => {
      const fetchMock = fetchExcept(() => false);
      const manifest = await runPipeline(deps({ fetch: fetchMock, lookup: async () => ['10.0.0.7'] }), request, () => {});

      expect(vi.mocked(fetchMock).mock.calls.map(([url]) => String(url))).not.toContain(ORIGINAL);
      expect(imageOf(manifest, 'Nature Alpha')).toMatch(/^\/media\//);
    });

    it('does not search photos when the season is a mild one', async () => {
      const d = pipelineDeps();

      await runPipeline(d, request, () => {});

      expect(d.sources.placePhoto).not.toHaveBeenCalled();
    });

    it('builds the video without a photo search that takes too long', async () => {
      vi.useFakeTimers();
      const base = deps();
      const d = { ...base, sources: { ...base.sources, placePhoto: vi.fn(() => new Promise<never>(() => {})) } };

      const pending = runPipeline(d, request, () => {});
      await vi.advanceTimersByTimeAsync(PHOTO_DEADLINE_MS);
      const manifest = await pending;

      expect(imageOf(manifest, 'Nature Alpha')).toMatch(/^\/media\//);
      expect(manifest.sources.map((entry) => entry.label)).not.toContain('Bing Images');
    });
  });

  it('shows an event only when it happens during the stay', async () => {
    const base = pipelineDeps();
    const later = { ...christmasMarket, startDate: '2027-01-10', endDate: '2027-01-12' };
    const deps = { ...base, sources: { ...base.sources, events: vi.fn(async () => ({ facts: [later], source: source('songkick', 'Songkick') })) } };

    const manifest = await runPipeline(deps, request, () => {});

    // With no event in the stay, the stay scene falls back to the weather.
    expect(manifest.scenes.find((scene) => scene.type === 'stay')?.subtitle).toContain('°C');
    expect(manifest.sources.map((entry) => entry.label)).not.toContain('Songkick');
  });

  it('shows at most three experiences, chosen for the interests', async () => {
    const base = pipelineDeps();
    const prices = { 'Food Tour': 50, 'Museum Tickets': 40, 'Valley Day Trip': 30, 'Bus Tour': 5, 'Quad Ride': 6 };
    const offers = Object.entries(prices).map(([title, amount]) => ({ ...tour, id: `exp:${title}`, title, amount }));
    const deps = { ...base, sources: { ...base.sources, experiences: vi.fn(async () => [{ facts: offers, source: source('viator', 'Viator') }]) } };

    const manifest = await runPipeline(deps, request, () => {});

    const shown = manifest.scenes.find((scene) => scene.type === 'experiences')?.items?.map((item) => item.title);
    // The cheapest two match none of food, museums or nature; the three that do are listed cheapest first.
    expect(shown).toEqual(['Valley Day Trip', 'Museum Tickets', 'Food Tour']);
  });

  it('still succeeds when experiences and events throw', async () => {
    const onSourceError = vi.fn();
    const base = pipelineDeps({ onSourceError });
    const deps = {
      ...base,
      sources: {
        ...base.sources,
        experiences: vi.fn().mockRejectedValue(new Error('blocked')),
        events: vi.fn().mockRejectedValue(new Error('timeout')),
      },
    };

    const manifest = await runPipeline(deps, request, () => {});

    expect(types(manifest)).toEqual(['hook', 'activity', 'activity', 'activity', 'stay', 'outro']);
    expect(manifest.scenes.find((scene) => scene.type === 'stay')?.subtitle).toContain('°C');
    expect(onSourceError).toHaveBeenCalledWith('experiences', expect.any(Error));
    expect(onSourceError).toHaveBeenCalledWith('events', expect.any(Error));
  });

  it('moves on without a source that never answers', async () => {
    vi.useFakeTimers();
    const base = pipelineDeps();
    const deps = { ...base, sources: { ...base.sources, experiences: vi.fn(() => new Promise<never>(() => {})) } };

    const pending = runPipeline(deps, request, () => {});
    await vi.advanceTimersByTimeAsync(12_000);

    expect(types(await pending)).not.toContain('experiences');
  });

  it('fails with the exact message when fewer than 3 places survive', async () => {
    const base = pipelineDeps();
    const places = vi.fn(async () => ({ facts: [placeFact('only')], source: source('google-maps:food', 'Google Maps') }));
    const deps = { ...base, sources: { ...base.sources, places } };

    await expect(runPipeline(deps, { ...request, interests: ['food'] }, () => {})).rejects.toThrow(
      'Not enough live data for this area',
    );
    await expect(runPipeline(deps, { ...request, interests: ['food'] }, () => {})).rejects.toBeInstanceOf(NotEnoughDataError);
  });

  it('fails when the place cannot be located', async () => {
    const deps = pipelineDeps();
    const { lat: _lat, lng: _lng, ...noCoordinates } = listing;

    await expect(runPipeline(deps, { ...request, listing: noCoordinates }, () => {})).rejects.toBeInstanceOf(NotEnoughDataError);
    expect(deps.sources.places).not.toHaveBeenCalled();
  });

  it('fails the job when a source reports exhausted credits', async () => {
    const base = pipelineDeps();
    const deps = { ...base, sources: { ...base.sources, experiences: vi.fn().mockRejectedValue(new CreditsExhaustedError()) } };

    await expect(runPipeline(deps, request, () => {})).rejects.toBeInstanceOf(CreditsExhaustedError);
  });

  it('returns a silent manifest when voice fails', async () => {
    const onSourceError = vi.fn();
    const deps = pipelineDeps({ synthesize: vi.fn().mockRejectedValue(new Error('quota')), onSourceError });

    const manifest = await runPipeline(deps, request, () => {});

    expect(manifest.audioUrl).toBeNull();
    expect(manifest.scenes[0]?.captions.length).toBeGreaterThan(0);
    expect(onSourceError).toHaveBeenCalledWith('voice', expect.any(Error));
  });

  it('shortens once, then drops an activity scene, to stay within 900 frames', async () => {
    const synthesize = vi
      .fn()
      .mockImplementationOnce(async (lines: readonly string[]) => ({ audio: Buffer.from('a'), alignment: alignFor(lines, 0.2) }))
      .mockImplementationOnce(async (lines: readonly string[]) => ({ audio: Buffer.from('b'), alignment: alignFor(lines, 0.2) }))
      .mockImplementation(async (lines: readonly string[]) => ({ audio: Buffer.from('c'), alignment: alignFor(lines) }));
    const deps = pipelineDeps({ synthesize });

    const manifest = await runPipeline(deps, request, () => {});

    expect(synthesize).toHaveBeenCalledTimes(3);
    expect(types(manifest).filter((type) => type === 'activity')).toHaveLength(2);
    expect(manifest.durationInFrames).toBeLessThanOrEqual(900);
    const systems = vi.mocked(deps.complete).mock.calls.map((call) => call[0]);
    expect(systems.some((system) => system.includes('about 45 words'))).toBe(true);
  });

  it('reports it when the shortened script could not come from the model either', async () => {
    const onSourceError = vi.fn();
    const synthesize = vi
      .fn()
      .mockImplementationOnce(async (lines: readonly string[]) => ({ audio: Buffer.from('a'), alignment: alignFor(lines, 0.2) }))
      .mockImplementation(async (lines: readonly string[]) => ({ audio: Buffer.from('b'), alignment: alignFor(lines) }));

    await runPipeline(pipelineDeps({ synthesize, onSourceError }), request, () => {});

    // Once for the first script, once for the shorter rewrite.
    expect(onSourceError.mock.calls.filter(([sourceId]) => sourceId === 'script')).toHaveLength(2);
  });

  it('fails when the video cannot be made to fit', async () => {
    const synthesize = vi.fn(async (lines: readonly string[]) => ({ audio: Buffer.from('a'), alignment: alignFor(lines, 0.3) }));

    await expect(runPipeline(pipelineDeps({ synthesize }), request, () => {})).rejects.toThrow(/30 seconds/);
  });
});
