import type { ListingContext } from '@outside/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadgeState } from '../src/badge/badgeState';
import { POLL_MS, createListingSession, type SessionDeps } from '../src/badge/session';
import type { Message } from '../src/messages';
import { DEFAULT_SETTINGS } from '../src/storage';

function listing(id: string): ListingContext {
  return {
    site: 'airbnb',
    listingId: id,
    url: `https://www.airbnb.com/rooms/${id}`,
    title: `Listing ${id}`,
    locationText: 'Lisbon, Portugal',
    photos: [],
  };
}

const created = (videoId: string, status = 'queued') => ({ success: true, data: { videoId, status, cached: status === 'ready' }, error: null });
const progress = (status: string, stage = 'Checking live prices') => ({ success: true, data: { status, stage, progress: 0.5 }, error: null });
const UNREACHABLE = { success: false, data: null, error: 'unreachable' };

interface Harness {
  deps: SessionDeps;
  render: ReturnType<typeof vi.fn<(state: BadgeState) => void>>;
  send: ReturnType<typeof vi.fn<(message: Message) => Promise<unknown>>>;
  states(): BadgeState[];
}

function harness(send: (message: Message) => Promise<unknown>, interests = DEFAULT_SETTINGS.interests): Harness {
  const render = vi.fn<(state: BadgeState) => void>();
  const sendMock = vi.fn(send);
  return {
    render,
    send: sendMock,
    states: () => render.mock.calls.map((call) => call[0]),
    deps: {
      send: sendMock,
      render,
      getSettings: async () => ({ ...DEFAULT_SETTINGS, interests }),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  };
}

/** Lets pending promise callbacks run without moving the clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('listing session', () => {
  it('polls every 1500 ms until the video is ready, then stops', async () => {
    const replies = [created('v1'), progress('gathering', 'Finding food spots'), progress('voicing', 'Recording voiceover'), progress('ready')];
    const h = harness(async () => replies.shift());
    const session = createListingSession(h.deps);

    session.start(listing('1'));
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(POLL_MS).toBe(1500);
    expect(h.send.mock.calls.map((call) => call[0].type)).toEqual(['video:create', 'video:status', 'video:status', 'video:status']);
    expect(h.states()).toEqual([
      { kind: 'generating', stage: 'Reading the neighbourhood' },
      { kind: 'generating', stage: 'Reading the neighbourhood' },
      { kind: 'generating', stage: 'Finding food spots' },
      { kind: 'generating', stage: 'Recording voiceover' },
      { kind: 'ready', videoId: 'v1' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends the listing and the saved interests', async () => {
    const h = harness(async () => created('v1', 'ready'), ['water', 'gems']);

    createListingSession(h.deps).start(listing('1'));
    await flush();

    expect(h.send).toHaveBeenCalledWith({ type: 'video:create', listing: listing('1'), interests: ['water', 'gems'] });
  });

  it('is ready at once for a cached video, without polling', async () => {
    const h = harness(async () => created('v1', 'ready'));

    createListingSession(h.deps).start(listing('1'));
    await flush();

    expect(h.states().at(-1)).toEqual({ kind: 'ready', videoId: 'v1' });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits and asks again when the server says it is busy, instead of giving up', async () => {
    const busy = { success: false, data: null, error: 'Too many requests' };
    const replies = [created('v1'), busy, busy, progress('ready')];
    const h = harness(async () => replies.shift());

    createListingSession(h.deps).start(listing('1'));
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(h.states().some((state) => state.kind === 'error')).toBe(false);
    expect(h.states().at(-1)).toEqual({ kind: 'ready', videoId: 'v1' });
  });

  it('waits and asks again when the server is busy at the very first request', async () => {
    const busy = { success: false, data: null, error: 'Too many requests' };
    const replies = [busy, created('v1'), progress('ready')];
    const h = harness(async () => replies.shift());

    createListingSession(h.deps).start(listing('1'));
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(h.states().some((state) => state.kind === 'error')).toBe(false);
    expect(h.states().at(-1)).toEqual({ kind: 'ready', videoId: 'v1' });
  });

  it('shows offline and stops polling when the server is unreachable', async () => {
    const replies = [created('v1'), UNREACHABLE];
    const h = harness(async () => replies.shift());

    createListingSession(h.deps).start(listing('1'));
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(h.states().at(-1)).toEqual({ kind: 'offline' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows offline when the background worker does not answer at all', async () => {
    const h = harness(async () => undefined);

    createListingSession(h.deps).start(listing('1'));
    await flush();

    expect(h.states().at(-1)).toEqual({ kind: 'offline' });
  });

  it('ignores a late reply after stop and leaves no timer running', async () => {
    let answer: (value: unknown) => void = () => {};
    const h = harness(() => new Promise((resolve) => (answer = resolve)));
    const session = createListingSession(h.deps);

    session.start(listing('1'));
    await flush();
    session.stop();
    const rendersAtStop = h.render.mock.calls.length;
    answer(created('v1', 'ready'));
    await flush();

    expect(h.render.mock.calls.length).toBe(rendersAtStop);
    expect(h.render).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling the old listing when a new one starts', async () => {
    const answers = new Map<string, (value: unknown) => void>();
    const h = harness((message) => {
      if (message.type !== 'video:create') {
        return Promise.resolve(progress('gathering'));
      }
      return new Promise((resolve) => answers.set(message.listing.listingId, resolve));
    });
    const session = createListingSession(h.deps);

    session.start(listing('A'));
    await flush();
    session.start(listing('B'));
    await flush();
    answers.get('B')?.(created('vB', 'ready'));
    await flush();
    answers.get('A')?.(created('vA', 'ready'));
    await flush();

    expect(h.states().at(-1)).toEqual({ kind: 'ready', videoId: 'vB' });
    expect(h.render).not.toHaveBeenCalledWith({ kind: 'ready', videoId: 'vA' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the old video playable while a restart builds the new one', async () => {
    const replies = [created('v1', 'ready'), created('v2'), progress('gathering'), progress('ready')];
    const h = harness(async () => replies.shift());
    const session = createListingSession(h.deps);

    session.start(listing('1'));
    await flush();
    session.restart();
    await flush();
    expect(h.states().at(-1)).toEqual({ kind: 'refreshing', videoId: 'v1' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(h.states().at(-1)).toEqual({ kind: 'ready', videoId: 'v2' });
  });

  it('does nothing on restart before a listing was started, or after stop', async () => {
    const h = harness(async () => created('v1', 'ready'));
    const session = createListingSession(h.deps);

    session.restart();
    session.start(listing('1'));
    await flush();
    session.stop();
    session.restart();
    await flush();

    expect(h.send).toHaveBeenCalledTimes(1);
  });
});
