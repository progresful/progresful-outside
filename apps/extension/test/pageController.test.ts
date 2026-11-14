import type { ListingContext } from '@outside/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadgeState } from '../src/badge/badgeState';
import { EXTRACT_RETRY_MS, createPageController, type PageDeps } from '../src/badge/pageController';
import type { SiteAdapter } from '../src/sites';
import { DEFAULT_SETTINGS, type Settings } from '../src/storage';

const listingA: ListingContext = {
  site: 'airbnb',
  listingId: '1',
  url: 'https://www.airbnb.com/rooms/1',
  title: 'A',
  locationText: 'Lisbon, Portugal',
  photos: [],
};

interface Harness {
  deps: PageDeps;
  session: { start: ReturnType<typeof vi.fn>; restart: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  badge: { render: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  extract: ReturnType<typeof vi.fn>;
  openPlayer: ReturnType<typeof vi.fn<PageDeps['openPlayer']>>;
  mount: ReturnType<typeof vi.fn<PageDeps['mount']>>;
  pushState(state: BadgeState): void;
  settings: Settings;
}

function harness(settings: Settings = DEFAULT_SETTINGS): Harness {
  const session = { start: vi.fn(), restart: vi.fn(), stop: vi.fn() };
  const badge = { render: vi.fn(), remove: vi.fn() };
  const extract = vi.fn((_doc: Document, url: string): ListingContext | null => ({ ...listingA, url, listingId: url.split('/').pop() ?? '' }));
  const adapter: SiteAdapter = {
    site: 'airbnb',
    matchListing: (url) => (/\/rooms\/\d+/.test(url) ? { listingId: url.split('/').pop() ?? '' } : null),
    extractListing: extract,
    findGallery: () => null,
  };
  const h: Harness = {
    session,
    badge,
    extract,
    openPlayer: vi.fn<PageDeps['openPlayer']>(),
    mount: vi.fn<PageDeps['mount']>(() => badge),
    pushState: () => {},
    settings,
    deps: {} as PageDeps,
  };
  h.deps = {
    doc: document,
    adapterFor: (url) => {
      const match = adapter.matchListing(url);
      return match ? { adapter, listingId: match.listingId } : null;
    },
    createSession: (render) => {
      h.pushState = render;
      return session;
    },
    mount: h.mount,
    getSettings: async () => h.settings,
    openPlayer: h.openPlayer,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  return h;
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('page controller', () => {
  it('does nothing on a page that is not a listing', async () => {
    const h = harness();

    createPageController(h.deps).onUrl('https://www.airbnb.com/s/Lisbon/homes');
    await flush();

    expect(h.mount).not.toHaveBeenCalled();
    expect(h.session.start).not.toHaveBeenCalled();
  });

  it('mounts the badge and starts a session on a listing page', async () => {
    const h = harness();

    createPageController(h.deps).onUrl('https://www.airbnb.com/rooms/1');
    await flush();

    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.session.start).toHaveBeenCalledWith(expect.objectContaining({ listingId: '1' }));
  });

  it('feeds session states to the badge', async () => {
    const h = harness();
    createPageController(h.deps).onUrl('https://www.airbnb.com/rooms/1');
    await flush();

    h.pushState({ kind: 'ready', videoId: 'v1' });

    expect(h.badge.render).toHaveBeenCalledWith({ kind: 'ready', videoId: 'v1' });
  });

  it('tears the old listing down before starting the next', async () => {
    const h = harness();
    const controller = createPageController(h.deps);

    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();
    controller.onUrl('https://www.airbnb.com/rooms/2');
    await flush();

    expect(h.session.stop).toHaveBeenCalledTimes(1);
    expect(h.badge.remove).toHaveBeenCalledTimes(1);
    expect(h.session.start).toHaveBeenLastCalledWith(expect.objectContaining({ listingId: '2' }));
    expect(h.mount).toHaveBeenCalledTimes(2);
  });

  it('removes the badge when the user leaves for a non-listing page', async () => {
    const h = harness();
    const controller = createPageController(h.deps);

    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();
    controller.onUrl('https://www.airbnb.com/s/Lisbon/homes');
    await flush();

    expect(h.badge.remove).toHaveBeenCalledTimes(1);
    expect(h.session.stop).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeat of the same url', async () => {
    const h = harness();
    const controller = createPageController(h.deps);

    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();
    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();

    expect(h.session.start).toHaveBeenCalledTimes(1);
  });

  it('stays out of a site the user switched off', async () => {
    const h = harness({ ...DEFAULT_SETTINGS, sites: { airbnb: false, booking: true } });

    createPageController(h.deps).onUrl('https://www.airbnb.com/rooms/1');
    await flush();

    expect(h.mount).not.toHaveBeenCalled();
  });

  it('waits for a page that has not rendered its listing yet', async () => {
    const h = harness();
    h.extract.mockReturnValueOnce(null).mockReturnValueOnce(null);

    createPageController(h.deps).onUrl('https://www.airbnb.com/rooms/1');
    await flush();
    expect(h.session.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(EXTRACT_RETRY_MS * 2);

    expect(h.session.start).toHaveBeenCalledTimes(1);
  });

  it('gives up quietly when the listing never becomes readable', async () => {
    const h = harness();
    h.extract.mockReturnValue(null);

    createPageController(h.deps).onUrl('https://www.airbnb.com/rooms/1');
    await vi.advanceTimersByTimeAsync(EXTRACT_RETRY_MS * 30);

    expect(h.mount).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rebuilds when the interests change, and only then', async () => {
    const h = harness();
    const controller = createPageController(h.deps);
    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();

    controller.onSettings({ ...DEFAULT_SETTINGS, serverUrl: 'http://localhost:9000' });
    expect(h.session.restart).not.toHaveBeenCalled();
    controller.onSettings({ ...DEFAULT_SETTINGS, interests: ['water'] });

    expect(h.session.restart).toHaveBeenCalledTimes(1);
  });

  it('leaves when its site is switched off mid-visit', async () => {
    const h = harness();
    const controller = createPageController(h.deps);
    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();

    controller.onSettings({ ...DEFAULT_SETTINGS, sites: { airbnb: false, booking: true } });

    expect(h.badge.remove).toHaveBeenCalledTimes(1);
    expect(h.session.stop).toHaveBeenCalledTimes(1);
  });

  it('opens the player from the badge and for the popup', async () => {
    const h = harness();
    const controller = createPageController(h.deps);
    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();
    const badgeHandlers = h.mount.mock.calls[0]?.[1] as { onPlay(videoId: string): void; onRetry(): void };

    badgeHandlers.onPlay('v1');
    h.pushState({ kind: 'ready', videoId: 'v2' });
    controller.playCurrent();
    badgeHandlers.onRetry();

    expect(h.openPlayer.mock.calls).toEqual([['v1'], ['v2']]);
    expect(h.session.restart).toHaveBeenCalledTimes(1);
  });

  it('reports its state for the popup', async () => {
    const h = harness();
    const controller = createPageController(h.deps);
    expect(controller.snapshot()).toEqual({ onListing: false, badge: { kind: 'hidden' } });

    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();
    h.pushState({ kind: 'generating', stage: 'Checking live prices' });

    expect(controller.snapshot()).toEqual({
      onListing: true,
      badge: { kind: 'generating', stage: 'Checking live prices' },
      locationText: 'Lisbon, Portugal',
    });
  });

  it('stop() tears everything down', async () => {
    const h = harness();
    const controller = createPageController(h.deps);
    controller.onUrl('https://www.airbnb.com/rooms/1');
    await flush();

    controller.stop();

    expect(h.badge.remove).toHaveBeenCalledTimes(1);
    expect(h.session.stop).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().onListing).toBe(false);
  });
});
