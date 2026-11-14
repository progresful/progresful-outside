import type { ExperienceFact, Source } from '@outside/shared';
import { scrapeKey } from '../cache/keys';
import { fold, sameCountry } from './country';
import { parseGetYourGuideMarkdown, parseViatorMarkdown, type RawExperience } from './experienceParsers';
import { MAX_PAGE_CHARS } from './markdown';
import { cachedResult, scrapeMarkdownPage } from './page';
import { parsePrice } from './price';
import { emptyResult, type SourceDeps, type SourceResult } from './types';

export interface StayDates {
  start: string;
  end: string;
}

export interface ExperienceSource {
  id: string;
  label: string;
  /** Whether the site's results change with the dates given, so they must be cached per stay. */
  dated: boolean;
  /** The site's results page for a city, for the stay's dates where the site takes them. */
  searchUrl(city: string, dates?: StayDates): string;
  parse(markdown: string): RawExperience[];
  /** The country of the destination the site resolved the city name to, when the page says. */
  resolvedCountry?(markdown: string): string | undefined;
}

/** Viator's breadcrumb: "Things to do in Portugal" > "Things to do in Lisbon". The first is the country. */
const VIATOR_BREADCRUMB = /\[Things to do in ([^\]]+)\]\(https:\/\/www\.viator\.com\/[^)\s]*\/d\d+\)/;

/**
 * The marketplaces kept by the source spike (docs/sources.md): both show
 * per-person prices on their results page. Viator is Tripadvisor's booking marketplace.
 */
export const EXPERIENCE_SOURCES: readonly ExperienceSource[] = [
  {
    id: 'viator',
    label: 'Viator',
    // Viator drops date parameters when it redirects to the city's page.
    dated: false,
    resolvedCountry: (markdown) => VIATOR_BREADCRUMB.exec(markdown.slice(0, MAX_PAGE_CHARS))?.[1]?.trim(),
    searchUrl: (city) => `https://www.viator.com/searchResults/all?text=${encodeURIComponent(city)}`,
    parse: parseViatorMarkdown,
  },
  {
    id: 'getyourguide',
    label: 'GetYourGuide',
    dated: true,
    searchUrl: (city, dates) =>
      `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}` +
      (dates ? `&date_from=${dates.start}&date_to=${dates.end}` : ''),
    parse: parseGetYourGuideMarkdown,
  },
];

export interface ExperiencesParams {
  city: string;
  country: string;
  /** The currency the listing is shown in; prices are fetched to match where possible. */
  currency?: string;
  /** The stay, so that marketplaces that take dates list what runs then. */
  window?: StayDates;
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
  const dates = source.dated ? p.window : undefined;
  const key = scrapeKey('experiences', {
    source: source.id,
    city: city.toLowerCase(),
    country: p.country.trim().toLowerCase(),
    fetchCountry: country,
    dates: dates ? `${dates.start}..${dates.end}` : '',
  });
  return cachedResult(deps, source.id, key, async () => {
    const url = source.searchUrl(city, dates);
    const page = await scrapeMarkdownPage(deps, url, country);
    const resolved = source.resolvedCountry?.(page.markdown);
    if (resolved && fold(p.country) !== fold(city) && !sameCountry(p.country, resolved)) {
      // "Naples" resolved to Italy for a listing in Florida: those tours are not nearby.
      return { result: emptyResult<ExperienceFact>(), fetchedAt: page.fetchedAt };
    }
    const facts = source.parse(page.markdown).flatMap((raw) => toExperienceFact(raw, source.id) ?? []);
    const cited: Source = { id: source.id, label: source.label, url, fetchedAt: new Date(page.fetchedAt).toISOString() };
    return { result: { facts, source: cited }, fetchedAt: page.fetchedAt };
  });
}

/** Each marketplace gets this long, a little less than the pipeline gives the whole source. */
export const MARKETPLACE_DEADLINE_MS = 11_000;

/** A marketplace that is too slow answers with nothing, so it cannot cost the video the others' offers. */
function withinDeadline(deps: SourceDeps, sourceId: string, work: Promise<SourceResult<ExperienceFact>>): Promise<SourceResult<ExperienceFact>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SourceResult<ExperienceFact>>((resolve) => {
    timer = setTimeout(() => {
      deps.onSourceError?.(sourceId, new Error(`${sourceId} did not answer within ${MARKETPLACE_DEADLINE_MS} ms`));
      resolve(emptyResult());
    }, MARKETPLACE_DEADLINE_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Bookable experiences in the city with their live prices, one result per marketplace.
 * Cached per city, so every listing and interest set there shares one fetch. A marketplace
 * that fails is skipped; exhausted credits propagate.
 */
export function fetchExperiences(deps: SourceDeps, p: ExperiencesParams): Promise<SourceResult<ExperienceFact>[]> {
  return Promise.all(EXPERIENCE_SOURCES.map((source) => withinDeadline(deps, source.id, fromSource(deps, source, p))));
}
