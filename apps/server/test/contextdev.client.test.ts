import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContextDevError,
  CreditsExhaustedError,
  createContextDevClient,
  realFetchedAt,
} from '../src/contextdev/client';

const scrapeBody = {
  url: 'https://example.com',
  parsed: { requested: true, success: true, data: { results: [{ name: 'A' }] } },
  cache_metadata: { status: 'hit', age_ms: 5_000 },
  key_metadata: { credits_consumed: 1 },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('context.dev client', () => {
  it('posts a scrape with the bearer key and the 6 h maxAgeMs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(scrapeBody));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock });

    await client.scrape({ url: 'https://example.com', formats: { markdown: true } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.context.dev/v1/web/scrape');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer k');
    expect(sentBody(fetchMock)).toEqual({
      url: 'https://example.com',
      formats: { markdown: true },
      maxAgeMs: 21_600_000,
      timeoutOpts: { milliseconds: 12_000, behavior: 'fail' },
    });
  });

  it('keeps a caller-supplied maxAgeMs and timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(scrapeBody));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock });

    await client.scrape({ url: 'https://example.com', formats: {}, maxAgeMs: 0, timeoutOpts: { milliseconds: 5_000 } });

    expect(sentBody(fetchMock).maxAgeMs).toBe(0);
    expect(sentBody(fetchMock).timeoutOpts).toEqual({ milliseconds: 5_000 });
  });

  it('returns the scrape outputs and fills in the ones not requested', async () => {
    const client = createContextDevClient({ apiKey: 'k', fetch: vi.fn().mockResolvedValue(jsonResponse(scrapeBody)) });

    const res = await client.scrape({ url: 'https://example.com', formats: { parse: true } });

    expect(res.parsed).toMatchObject({ success: true, data: { results: [{ name: 'A' }] } });
    expect(res.json).toEqual({ success: null, data: null });
    expect(res.cache_metadata).toEqual({ status: 'hit', age_ms: 5_000 });
    expect(res.key_metadata?.credits_consumed).toBe(1);
  });

  it('posts a search body unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock });

    const res = await client.search({ query: 'food tour Lisbon', numResults: 5 });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.context.dev/v1/web/search');
    expect(sentBody(fetchMock)).toEqual({ query: 'food tour Lisbon', numResults: 5 });
    expect(res).toEqual({ results: [] });
  });

  it('retries a 429 after Retry-After and then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse(scrapeBody));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock });

    const pending = client.scrape({ url: 'https://example.com', formats: {} });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);

    expect((await pending).url).toBe('https://example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after three 429s', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({}, 429, { 'retry-after': '1' }));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock });

    const pending = client.scrape({ url: 'https://example.com', formats: {} });
    const settled = expect(pending).rejects.toBeInstanceOf(ContextDevError);
    await vi.advanceTimersByTimeAsync(5_000);

    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws CreditsExhaustedError on 402 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 'USAGE_EXCEEDED' }, 402));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock });

    await expect(client.scrape({ url: 'https://example.com', formats: {} })).rejects.toBeInstanceOf(CreditsExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a ContextDevError carrying the status on other failures', async () => {
    const client = createContextDevClient({ apiKey: 'k', fetch: vi.fn().mockResolvedValue(jsonResponse({}, 500)) });

    await expect(client.scrape({ url: 'https://example.com', formats: {} })).rejects.toMatchObject({ status: 500 });
  });

  it('never has more than maxConcurrent calls in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return jsonResponse(scrapeBody);
    });
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock, maxConcurrent: 2 });

    await Promise.all([1, 2, 3, 4, 5].map((n) => client.scrape({ url: `https://example.com/${n}`, formats: {} })));

    expect(peak).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('records a response and replays it without calling fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outside-fixtures-'));
    const recorder = createContextDevClient({
      apiKey: 'k',
      fetch: vi.fn().mockResolvedValue(jsonResponse(scrapeBody)),
      fixtures: { mode: 'record', dir },
    });
    await recorder.scrape({ url: 'https://example.com', formats: { parse: true } });
    expect(readdirSync(dir)).toHaveLength(1);

    const replayFetch = vi.fn();
    const replayer = createContextDevClient({ apiKey: 'k', fetch: replayFetch, fixtures: { mode: 'replay', dir } });
    const res = await replayer.scrape({ url: 'https://example.com', formats: { parse: true } });

    expect(res.parsed.data).toEqual({ results: [{ name: 'A' }] });
    expect(replayFetch).not.toHaveBeenCalled();
  });

  it('returns the markdown output when it was requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ url: 'https://example.com', markdown: { requested: true, success: true, data: '# Hi' } }));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock });

    const res = await client.scrape({ url: 'https://example.com', formats: { markdown: true } });

    expect(res.markdown).toMatchObject({ success: true, data: '# Hi' });
    expect(res.parsed).toMatchObject({ success: null, data: null });
  });

  it('holds back requests beyond the per-minute allowance until the minute has passed', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(scrapeBody));
    const client = createContextDevClient({ apiKey: 'k', fetch: fetchMock, maxPerMinute: 2 });

    const all = Promise.all([1, 2, 3].map((n) => client.scrape({ url: `https://example.com/${n}`, formats: { parse: true } })));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_500);
    await all;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('replay throws when nothing was recorded for the request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outside-fixtures-'));
    const client = createContextDevClient({ apiKey: 'k', fetch: vi.fn(), fixtures: { mode: 'replay', dir } });

    await expect(client.scrape({ url: 'https://example.com/unseen', formats: {} })).rejects.toThrow(/No recorded fixture/);
  });
});

describe('realFetchedAt', () => {
  it('subtracts the reported cache age', () => {
    expect(realFetchedAt({ cache_metadata: { age_ms: 5_000 } }, 20_000)).toBe(15_000);
  });

  it('is now when no age is reported', () => {
    expect(realFetchedAt({}, 20_000)).toBe(20_000);
  });
});
