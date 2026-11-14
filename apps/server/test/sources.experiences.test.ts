import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError, type ContextDevClient, type ScrapeResponse } from '../src/contextdev/client';
import { EXPERIENCE_SOURCES, fetchCountryFor, fetchExperiences, toExperienceFact } from '../src/sources/experiences';
import { NOW, makeDeps, stubClient } from './helpers';

function recorded(name: string): ScrapeResponse {
  return JSON.parse(readFileSync(new URL(`./fixtures/contextdev/${name}.json`, import.meta.url), 'utf8')) as ScrapeResponse;
}

/** Answers each source's results page with its recorded response. */
type Scrape = ContextDevClient['scrape'];

function recordedScrape() {
  return vi.fn<Scrape>(async (body) =>
    String(body.url).includes('viator.com') ? recorded('viator-lisbon') : recorded('gyg-lisbon'),
  );
}

const lisbon = { city: 'Lisbon', country: 'Portugal' };

describe('fetchCountryFor', () => {
  it.each([
    ['USD', 'US'],
    ['GBP', 'GB'],
    ['EUR', 'DE'],
    ['eur', 'DE'],
    [undefined, 'DE'],
    ['JPY', 'DE'],
  ])('fetches %s prices from %s', (currency, country) => {
    expect(fetchCountryFor(currency)).toBe(country);
  });
});

describe('toExperienceFact', () => {
  const raw = {
    title: 'Sunset cruise',
    priceText: '€33',
    durationText: '1.5 hours',
    rating: 4.8,
    reviewCount: 766,
    url: 'https://www.getyourguide.com/lisbon-l42/sunset-cruise-t1/',
  };

  it('turns a priced offer into a fact', () => {
    expect(toExperienceFact(raw, 'getyourguide')).toEqual({
      id: 'exp:getyourguide:/lisbon-l42/sunset-cruise-t1/',
      kind: 'experience',
      title: 'Sunset cruise',
      amount: 33,
      currency: 'EUR',
      durationText: '1.5 hours',
      rating: 4.8,
      reviewCount: 766,
      url: raw.url,
      sourceId: 'getyourguide',
    });
  });

  it.each([
    ['a price with no currency', { ...raw, priceText: '33' }],
    ['a free offer', { ...raw, priceText: 'Free' }],
    ['a link that is not a url', { ...raw, url: '/relative' }],
    ['an empty title', { ...raw, title: ' ' }],
  ])('drops %s', (_label, bad) => {
    expect(toExperienceFact(bad, 'getyourguide')).toBeNull();
  });
});

describe('fetchExperiences', () => {
  it('asks each source for its results page as markdown, with images, from the right country', async () => {
    const scrape = recordedScrape();
    await fetchExperiences(makeDeps({ client: stubClient({ scrape }) }), { ...lisbon, currency: 'GBP' });

    const bodies = scrape.mock.calls.map((call) => call[0]);
    expect(bodies.map((body) => body.url).sort()).toEqual([
      'https://www.getyourguide.com/s/?q=Lisbon',
      'https://www.viator.com/searchResults/all?text=Lisbon',
    ]);
    for (const body of bodies) {
      expect(body).toMatchObject({
        formats: { markdown: true },
        markdownParams: { includeImages: true },
        sharedParams: { country: 'GB' },
      });
    }
  });

  it('returns priced facts per source with the page they came from', async () => {
    const results = await fetchExperiences(makeDeps({ client: stubClient({ scrape: recordedScrape() }) }), lisbon);

    expect(results.map((result) => result.source?.label).sort()).toEqual(['GetYourGuide', 'Viator']);
    const viator = results.find((result) => result.source?.id === 'viator');
    expect(viator?.facts).toHaveLength(24);
    expect(viator?.facts[0]).toMatchObject({ kind: 'experience', amount: 70, currency: 'EUR', rating: 4.9, sourceId: 'viator' });
    expect(viator?.source?.fetchedAt).toBe(new Date(NOW).toISOString());
    for (const fact of results.flatMap((result) => result.facts)) {
      expect(fact.amount).toBeGreaterThan(0);
      expect(fact.url).toMatch(/^https:\/\//);
    }
  });

  it('serves the second call for the same city from cache', async () => {
    const scrape = recordedScrape();
    const deps = makeDeps({ client: stubClient({ scrape }) });

    await fetchExperiences(deps, lisbon);
    const again = await fetchExperiences(deps, { city: ' lisbon ', country: 'PORTUGAL' });

    expect(scrape).toHaveBeenCalledTimes(EXPERIENCE_SOURCES.length);
    expect(again.flatMap((result) => result.facts).length).toBeGreaterThan(40);
  });

  it('keeps the sources that answered when one fails, and reports the failure', async () => {
    const onSourceError = vi.fn();
    const scrape = vi.fn<Scrape>(async (body) => {
      if (String(body.url).includes('viator.com')) {
        throw new Error('timeout');
      }
      return recorded('gyg-lisbon');
    });

    const results = await fetchExperiences(makeDeps({ client: stubClient({ scrape }), onSourceError }), lisbon);

    expect(results.filter((result) => result.facts.length > 0).map((result) => result.source?.id)).toEqual(['getyourguide']);
    expect(onSourceError).toHaveBeenCalledWith('viator', expect.any(Error));
  });

  it('does not cache a page with nothing on it', async () => {
    const empty = { ...recorded('gyg-lisbon'), markdown: { success: true, data: '# Nothing here' } };
    const scrape = vi.fn<Scrape>(async () => empty);
    const deps = makeDeps({ client: stubClient({ scrape }) });

    const first = await fetchExperiences(deps, lisbon);
    await fetchExperiences(deps, lisbon);

    expect(first.flatMap((result) => result.facts)).toEqual([]);
    expect(scrape).toHaveBeenCalledTimes(EXPERIENCE_SOURCES.length * 2);
  });

  it('lets exhausted credits stop the job', async () => {
    const scrape = vi.fn<Scrape>().mockRejectedValue(new CreditsExhaustedError());

    await expect(fetchExperiences(makeDeps({ client: stubClient({ scrape }) }), lisbon)).rejects.toBeInstanceOf(CreditsExhaustedError);
  });
});
