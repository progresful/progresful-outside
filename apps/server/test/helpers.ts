import { vi } from 'vitest';
import { createSqliteCacheStore } from '../src/cache/cacheStore';
import { createDeduper } from '../src/cache/dedupe';
import type { ContextDevClient } from '../src/contextdev/client';
import type { SourceDeps } from '../src/sources/types';

/** 2026-11-14T02:14:00Z — the fixed "now" used across server tests. */
export const NOW = Date.UTC(2026, 10, 14, 2, 14, 0);
export const TODAY = '2026-11-14';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function stubClient(overrides: Partial<ContextDevClient> = {}): ContextDevClient {
  return {
    scrape: vi.fn().mockRejectedValue(new Error('scrape not stubbed')),
    search: vi.fn().mockRejectedValue(new Error('search not stubbed')),
    ...overrides,
  };
}

export function makeDeps(overrides: Partial<SourceDeps> = {}): SourceDeps {
  return {
    client: stubClient(),
    cache: createSqliteCacheStore(':memory:'),
    dedupe: createDeduper(),
    now: () => NOW,
    fetch: vi.fn().mockRejectedValue(new Error('fetch not stubbed')),
    ...overrides,
  };
}
