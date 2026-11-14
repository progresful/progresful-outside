import type { ExperienceFact, Source } from '@outside/shared';
import { scrapeKey } from '../cache/keys';
import { parseGetYourGuideMarkdown, parseViatorMarkdown, type RawExperience } from './experienceParsers';
import { cachedResult, scrapeMarkdownPage } from './page';
import { parsePrice } from './price';
import type { SourceDeps, SourceResult } from './types';

export interface ExperienceSource {
  id: string;
  label: string;
  /** The site's results page for a city. */
  searchUrl(city: string): string;
  parse(markdown: string): RawExperience[];
}

/**
 * The marketplaces kept by the source spike (docs/spikes/2026-11-14-sources.md): both show
 * per-person prices on their results page. Viator is Tripadvisor's booking marketplace.
 */
export const EXPERIENCE_SOURCES: readonly ExperienceSource[] = [
  {
    id: 'viator',
    label: 'Viator',
    searchUrl: (city) => `https://www.viator.com/searchResults/all?text=${encodeURIComponent(city)}`,
    parse: parseViatorMarkdown,
  },
  {
    id: 'getyourguide',
    label: 'GetYourGuide',
    searchUrl: (city) => `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}`,
    parse: parseGetYourGuideMarkdown,
  },
];

export interface ExperiencesParams {
  city: string;
  country: string;
  /** The currency the listing is shown in; prices are fetched to match where possible. */
  currency?: string;
}

const FETCH_COUNTRY_BY_CURRENCY: Readonly<Record<string, string>> = { USD: 'US', GBP: 'GB', EUR: 'DE' };
const DEFAULT_FETCH_COUNTRY = 'DE';

/** The country to fetch from so the marketplaces quote the listing's currency; euros otherwise. */
export function fetchCountryFor(currency: string | undefined): string {
  return FETCH_COUNTRY_BY_CURRENCY[currency?.trim().toUpperCase() ?? ''] ?? DEFAULT_FETCH_COUNTRY;
}

function pathOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.pathname : null;
  } catch {
    // Not an absolute link: the offer cannot be cited, so it is dropped.
    return null;
  }
}

/** Null when the offer has no readable price, title or link: such an offer is never shown. */
export function toExperienceFact(raw: RawExperience, sourceId: string): ExperienceFact | null {
  const price = parsePrice(raw.priceText);
  const path = pathOf(raw.url);
  const title = raw.title.trim();
  if (!price || path === null || title.length === 0) {
    return null;
  }
  return {
    id: `exp:${sourceId}:${path}`,
    kind: 'experience',
    title,
    amount: price.amount,
    currency: price.currency,
    ...(raw.durationText ? { durationText: raw.durationText } : {}),
    ...(raw.rating === undefined ? {} : { rating: raw.rating }),
    ...(raw.reviewCount === undefined ? {} : { reviewCount: raw.reviewCount }),
    url: raw.url,
    ...(raw.imageUrl ? { imageUrl: raw.imageUrl } : {}),
    sourceId,
  };
}

function fromSource(
  deps: SourceDeps,
  source: ExperienceSource,
  p: ExperiencesParams,
): Promise<SourceResult<ExperienceFact>> {
  const city = p.city.trim();
  const country = fetchCountryFor(p.currency);
  const key = scrapeKey('experiences', {
    source: source.id,
    city: city.toLowerCase(),
    country: p.country.trim().toLowerCase(),
    fetchCountry: country,
  });
  return cachedResult(deps, source.id, key, async () => {
    const url = source.searchUrl(city);
    const page = await scrapeMarkdownPage(deps, url, country);
    const facts = source.parse(page.markdown).flatMap((raw) => toExperienceFact(raw, source.id) ?? []);
    const cited: Source = { id: source.id, label: source.label, url, fetchedAt: new Date(page.fetchedAt).toISOString() };
    return { result: { facts, source: cited }, fetchedAt: page.fetchedAt };
  });
}

/**
 * Bookable experiences in the city with their live prices, one result per marketplace.
 * Cached per city, so every listing and interest set there shares one fetch. A marketplace
 * that fails is skipped; exhausted credits propagate.
 */
export function fetchExperiences(deps: SourceDeps, p: ExperiencesParams): Promise<SourceResult<ExperienceFact>[]> {
  return Promise.all(EXPERIENCE_SOURCES.map((source) => fromSource(deps, source, p)));
}
