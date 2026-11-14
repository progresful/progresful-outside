import type { Source } from '@outside/shared';
import type { CacheStore } from '../cache/cacheStore';
import type { Deduper } from '../cache/dedupe';
import type { ContextDevClient } from '../contextdev/client';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface SourceResult<F> {
  facts: F[];
  /** Null when the source contributed nothing. */
  source: Source | null;
}

export interface SourceDeps {
  client: ContextDevClient;
  cache: CacheStore;
  dedupe: Deduper;
  now: () => number;
  fetch: typeof fetch;
  /** Called when a source fails and is skipped, so the failure is logged rather than lost. */
  onSourceError?: (sourceId: string, error: unknown) => void;
}

export function emptyResult<F>(): SourceResult<F> {
  return { facts: [], source: null };
}
