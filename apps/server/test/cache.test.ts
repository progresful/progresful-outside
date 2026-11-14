import { describe, expect, it } from 'vitest';
import { TTL_MS, createSqliteCacheStore } from '../src/cache/cacheStore';
import { createDeduper } from '../src/cache/dedupe';
import { scrapeKey, videoKey } from '../src/cache/keys';

describe('SqliteCacheStore', () => {
  it('uses one 6 h TTL', () => {
    expect(TTL_MS).toBe(21_600_000);
  });

  it('expires 6 h after the real fetch time', () => {
    const store = createSqliteCacheStore(':memory:');
    store.set('k', { a: 1 }, { fetchedAt: 1_000 });
    expect(store.get('k', 1_000 + TTL_MS - 1)).toEqual({ value: { a: 1 }, fetchedAt: 1_000 });
    expect(store.get('k', 1_000 + TTL_MS)).toBeNull();
  });

  it('returns null for an unknown key', () => {
    expect(createSqliteCacheStore(':memory:').get('missing', 0)).toBeNull();
  });

  it('replaces an existing entry', () => {
    const store = createSqliteCacheStore(':memory:');
    store.set('k', 'old', { fetchedAt: 1_000 });
    store.set('k', 'new', { fetchedAt: 2_000 });
    expect(store.get('k', 2_000)).toEqual({ value: 'new', fetchedAt: 2_000 });
  });

  it('deletes an entry', () => {
    const store = createSqliteCacheStore(':memory:');
    store.set('k', 1, { fetchedAt: 1_000 });
    store.delete('k');
    expect(store.get('k', 1_000)).toBeNull();
  });

  it('sweep removes only expired rows', () => {
    const store = createSqliteCacheStore(':memory:');
    store.set('old', 1, { fetchedAt: 0 });
    store.set('fresh', 2, { fetchedAt: TTL_MS });
    expect(store.sweep(TTL_MS + 1)).toBe(1);
    expect(store.get('fresh', TTL_MS + 1)).toEqual({ value: 2, fetchedAt: TTL_MS });
    expect(store.sweep(TTL_MS + 1)).toBe(0);
  });
});

describe('cache keys', () => {
  const base = { site: 'airbnb', listingId: '1', interests: ['food', 'nature'] as const, templateVersion: 1 };

  it('videoKey ignores interest order', () => {
    const reordered = videoKey({ ...base, interests: ['nature', 'food'] });
    expect(reordered).toBe(videoKey({ ...base, interests: [...base.interests] }));
  });

  it('videoKey changes with dates, interests, listing and template version', () => {
    const key = videoKey({ ...base, interests: [...base.interests] });
    const variants = [
      videoKey({ ...base, interests: [...base.interests], checkIn: '2026-12-12', checkOut: '2026-12-16' }),
      videoKey({ ...base, interests: ['food'] }),
      videoKey({ ...base, interests: [...base.interests], listingId: '2' }),
      videoKey({ ...base, interests: [...base.interests], site: 'booking' }),
      videoKey({ ...base, interests: [...base.interests], templateVersion: 2 }),
    ];
    expect(new Set([key, ...variants]).size).toBe(6);
  });

  it('videoKey is a sha256 hex string', () => {
    expect(videoKey({ ...base, interests: [...base.interests] })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('scrapeKey ignores param order', () => {
    expect(scrapeKey('places', { a: 1, b: 'x' })).toBe(scrapeKey('places', { b: 'x', a: 1 }));
  });

  it('scrapeKey differs by adapter and by params', () => {
    const key = scrapeKey('places', { a: 1 });
    expect(scrapeKey('events', { a: 1 })).not.toBe(key);
    expect(scrapeKey('places', { a: 2 })).not.toBe(key);
  });
});

describe('deduper', () => {
  it('runs fn once for concurrent callers and again after it settles', async () => {
    const dedupe = createDeduper();
    let calls = 0;
    let release: (value: string) => void = () => {};
    const slow = (): Promise<string> => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = dedupe('k', slow);
    const second = dedupe('k', slow);
    release('done');
    expect(await Promise.all([first, second])).toEqual(['done', 'done']);
    expect(calls).toBe(1);

    const third = dedupe('k', slow);
    release('again');
    expect(await third).toBe('again');
    expect(calls).toBe(2);
  });

  it('keeps different keys independent', async () => {
    const dedupe = createDeduper();
    const results = await Promise.all([dedupe('a', async () => 1), dedupe('b', async () => 2)]);
    expect(results).toEqual([1, 2]);
  });

  it('rejects every waiting caller and then allows a retry', async () => {
    const dedupe = createDeduper();
    const failing = (): Promise<never> => Promise.reject(new Error('boom'));
    const first = dedupe('k', failing);
    const second = dedupe('k', failing);
    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    await expect(dedupe('k', async () => 'ok')).resolves.toBe('ok');
  });
});
