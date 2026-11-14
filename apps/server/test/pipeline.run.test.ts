import { VideoManifestSchema } from '@outside/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError } from '../src/contextdev/client';
import { NotEnoughDataError, TEMPLATE_VERSION, runPipeline, type StageUpdate } from '../src/pipeline/run';
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
    expect(TEMPLATE_VERSION).toBe(2);
  });

  it('emits stages in order and returns a valid manifest', async () => {
    const stages: StageUpdate[] = [];
    const deps = pipelineDeps();

    const manifest = await runPipeline(deps, request, (update) => stages.push(update));

    expect(stages.map((s) => [s.status, s.stage])).toEqual([
      ['gathering', 'Reading the neighbourhood'],
      ['gathering', 'Finding food spots'],
      ['gathering', 'Finding museum spots'],
      ['gathering', 'Finding nature spots'],
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

      expect(queriesOf(deps)).toEqual(['nature: winter activities', 'culture: museum', 'adventure: ski resort']);
    });

    it('searches the usual way when it is not known', async () => {
      const deps = pipelineDeps();

      await runPipeline(deps, { ...request, interests: ['nature', 'culture', 'adventure'] }, () => {});

      expect(queriesOf(deps)).toEqual(['nature: park', 'culture: museum', 'adventure: outdoor activities']);
    });

    it('falls back to the usual search when the seasonal one finds nothing nearby', async () => {
      const base = pipelineDeps();
      const usual = vi.mocked(base.sources.places).getMockImplementation();
      const places = vi.fn<typeof base.sources.places>(async (sourceDeps, params) => {
        if (params.query === 'ski resort') {
          return { facts: [], source: null };
        }
        if (params.query === 'winter activities') {
          // Something was found, but a day's drive away.
          return { facts: [placeFact('far', { interest: 'nature', distanceM: 300_000 })], source: source('google-maps:nature', 'Google Maps') };
        }
        return usual!(sourceDeps, params);
      });
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), places } };

      const manifest = await runPipeline(deps, { ...request, interests: ['nature', 'culture', 'adventure'] }, () => {});

      expect(queriesOf(deps).sort()).toEqual([
        'adventure: outdoor activities',
        'adventure: ski resort',
        'culture: museum',
        'nature: park',
        'nature: winter activities',
      ]);
      expect(types(manifest).filter((type) => type === 'activity')).toHaveLength(3);
    });

    it('opens the video with it and cites where it came from', async () => {
      const base = pipelineDeps();
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy) } };

      const manifest = await runPipeline(deps, request, () => {});

      expect(manifest.scenes[0]).toMatchObject({ type: 'hook', subtitle: '12–16 Dec · usually −6 to 3 °C, snowy', factIds: ['climate:stay'] });
      expect(manifest.sources.map((entry) => entry.label)).toContain('Open-Meteo (past years)');
    });

    it('prefers a bookable offer that suits it', async () => {
      const base = pipelineDeps();
      const offers = [
        { ...tour, id: 'exp:a', title: 'City Bus Tour', reviewCount: 9_000 },
        { ...tour, id: 'exp:b', title: 'Old Town Walk', reviewCount: 8_000 },
        { ...tour, id: 'exp:c', title: 'Harbour Stroll', reviewCount: 7_000 },
        { ...tour, id: 'exp:d', title: 'Snowshoe Hike', reviewCount: 90 },
      ];
      const experiences = vi.fn(async () => [{ facts: offers, source: source('viator', 'Viator') }]);
      const deps = { ...base, sources: { ...base.sources, climate: vi.fn(snowy), experiences } };

      const manifest = await runPipeline(deps, request, () => {});

      // None of the four matches food, museums or nature; only the season lifts the least-reviewed one in.
      expect(manifest.scenes.find((scene) => scene.type === 'experiences')?.items?.map((item) => item.title)).toContain('Snowshoe Hike');
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
    const photo = { id: 'photo:season' as const, imageUrl: 'https://upload.wikimedia.org/thumb/lisbon-winter.jpg', sourceId: 'wikimedia-commons' };
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
    const prices = { 'Food Tour': 50, 'Museum Tickets': 40, 'Hiking Day Trip': 30, 'Bus Tour': 5, 'Quad Ride': 6 };
    const offers = Object.entries(prices).map(([title, amount]) => ({ ...tour, id: `exp:${title}`, title, amount }));
    const deps = { ...base, sources: { ...base.sources, experiences: vi.fn(async () => [{ facts: offers, source: source('viator', 'Viator') }]) } };

    const manifest = await runPipeline(deps, request, () => {});

    const shown = manifest.scenes.find((scene) => scene.type === 'experiences')?.items?.map((item) => item.title);
    // The cheapest two match none of food, museums or nature; the three that do are listed cheapest first.
    expect(shown).toEqual(['Hiking Day Trip', 'Museum Tickets', 'Food Tour']);
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
