import { CreditsExhaustedError, realFetchedAt } from '../contextdev/client';
import { emptyResult, type SourceDeps, type SourceResult } from './types';

export interface MarkdownPage {
  markdown: string;
  /** When the page was really fetched, in epoch milliseconds. */
  fetchedAt: number;
}

/** A page as markdown with its images, fetched from `country` so prices come in that market's currency. */
export async function scrapeMarkdownPage(deps: SourceDeps, url: string, country: string): Promise<MarkdownPage> {
  const res = await deps.client.scrape({
    url,
    formats: { markdown: true },
    markdownParams: { includeImages: true },
    sharedParams: { country },
  });
  const markdown = res.markdown.success === true && typeof res.markdown.data === 'string' ? res.markdown.data : '';
  return { markdown, fetchedAt: realFetchedAt(res, deps.now()) };
}

export interface Loaded<F> {
  result: SourceResult<F>;
  fetchedAt: number;
}

/**
 * A source result from the cache, or loaded once however many callers ask at the same time.
 * An empty result is never cached. A failure is reported and becomes an empty result;
 * exhausted credits are the one failure that propagates.
 */
export async function cachedResult<F>(
  deps: SourceDeps,
  sourceId: string,
  key: string,
  load: () => Promise<Loaded<F>>,
): Promise<SourceResult<F>> {
  const cached = deps.cache.get<SourceResult<F>>(key, deps.now());
  if (cached) {
    return cached.value;
  }
  try {
    return await deps.dedupe(key, async () => {
      const { result, fetchedAt } = await load();
      if (result.facts.length > 0) {
        deps.cache.set(key, result, { fetchedAt });
      }
      return result;
    });
  } catch (error: unknown) {
    if (error instanceof CreditsExhaustedError) {
      throw error;
    }
    deps.onSourceError?.(sourceId, error);
    return emptyResult();
  }
}
