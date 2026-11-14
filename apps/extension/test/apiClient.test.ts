import type { ListingContext } from '@outside/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/apiClient';
import { routeMessage } from '../src/messages';

const listing: ListingContext = {
  site: 'airbnb',
  listingId: '12345',
  url: 'https://www.airbnb.com/rooms/12345',
  title: 'Flat with a view',
  locationText: 'Lisbon, Portugal',
  photos: [],
};

const UNREACHABLE = { success: false, data: null, error: 'unreachable' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function client(fetchMock: typeof fetch, serverUrl = 'http://localhost:8787') {
  return createApiClient(fetchMock, async () => serverUrl);
}

describe('api client', () => {
  it('posts the create body as json to <serverUrl>/api/videos', async () => {
    const reply = { success: true, data: { videoId: 'abcdef0123456789', status: 'queued', cached: false }, error: null };
    const fetchMock = vi.fn().mockResolvedValue(json(reply));

    const result = await client(fetchMock).createVideo({ listing, interests: ['food'] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/api/videos');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ listing, interests: ['food'] });
    expect(result).toEqual(reply);
  });

  it('gets a video by id', async () => {
    const reply = { success: true, data: { status: 'gathering', stage: 'Checking live prices', progress: 0.6 }, error: null };
    const fetchMock = vi.fn().mockResolvedValue(json(reply));

    expect(await client(fetchMock, 'http://localhost:8787/').getVideo('abcdef0123456789')).toEqual(reply);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://localhost:8787/api/videos/abcdef0123456789');
  });

  it('checks health', async () => {
    const reply = { success: true, data: { status: 'ok' }, error: null };
    const fetchMock = vi.fn().mockResolvedValue(json(reply));

    expect(await client(fetchMock).health()).toEqual(reply);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://localhost:8787/api/health');
  });

  it('passes a server-side failure through', async () => {
    const reply = { success: false, data: null, error: 'Not found' };

    expect(await client(vi.fn().mockResolvedValue(json(reply, 404))).getVideo('abcdef0123456789')).toEqual(reply);
  });

  it.each([
    ['a rejected fetch', () => vi.fn().mockRejectedValue(new Error('down'))],
    ['a body that is not json', () => vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }))],
    ['json that is not an envelope', () => vi.fn().mockResolvedValue(json({ hello: 'world' }))],
    ['a success with no data', () => vi.fn().mockResolvedValue(json({ success: true, data: null, error: null }))],
  ])('turns %s into an unreachable result', async (_name, makeFetch) => {
    expect(await client(makeFetch()).health()).toEqual(UNREACHABLE);
  });

  it('never throws, even when the server url cannot be read', async () => {
    const api = createApiClient(vi.fn(), async () => {
      throw new Error('storage unavailable');
    });

    expect(await api.health()).toEqual(UNREACHABLE);
  });
});

describe('routeMessage', () => {
  const ok = { success: true as const, data: { status: 'ok' }, error: null };
  const api = {
    createVideo: vi.fn().mockResolvedValue(ok),
    getVideo: vi.fn().mockResolvedValue(ok),
    health: vi.fn().mockResolvedValue(ok),
  };

  it('routes each message type to the api', async () => {
    await routeMessage(api, { type: 'video:create', listing, interests: ['food'] });
    await routeMessage(api, { type: 'video:status', videoId: 'abcdef0123456789' });
    await routeMessage(api, { type: 'server:health' });

    expect(api.createVideo).toHaveBeenCalledWith({ listing, interests: ['food'] });
    expect(api.getVideo).toHaveBeenCalledWith('abcdef0123456789');
    expect(api.health).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown type', { type: 'video:delete' }],
    ['a malformed video id', { type: 'video:status', videoId: '../../etc' }],
    ['too many interests', { type: 'video:create', listing, interests: ['food', 'water', 'gems', 'events', 'family', 'nature'] }],
    ['not an object', 'hello'],
  ])('rejects %s', async (_name, message) => {
    expect(await routeMessage(api, message)).toEqual({ success: false, data: null, error: 'bad message' });
  });
});
