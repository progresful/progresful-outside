import { VideoManifestSchema } from '@outside/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError } from '../src/contextdev/client';
import { NotEnoughDataError, TEMPLATE_VERSION, runPipeline, type StageUpdate } from '../src/pipeline/run';
import { alignFor, listing, memoryStore, pipelineDeps, source } from './fixtures/pipelineDeps';
import { christmasMarket, placeFact, tour } from './fixtures/selection';

const input = { videoId: 'abcdef0123456789', listing, interests: ['food', 'culture', 'nature'] as const };
const request = { ...input, interests: [...input.interests] };

function types(manifest: { scenes: Array<{ type: string }> }): string[] {
  return manifest.scenes.map((scene) => scene.type);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runPipeline', () => {
  it('has a template version for the cache key', () => {
    expect(TEMPLATE_VERSION).toBe(1);
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

    expect(deps.sources.experiences).toHaveBeenCalledWith(expect.anything(), { city: 'Lisbon', country: 'Portugal', currency: 'GBP' });
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

  it('fails when the video cannot be made to fit', async () => {
    const synthesize = vi.fn(async (lines: readonly string[]) => ({ audio: Buffer.from('a'), alignment: alignFor(lines, 0.3) }));

    await expect(runPipeline(pipelineDeps({ synthesize }), request, () => {})).rejects.toThrow(/30 seconds/);
  });
});
