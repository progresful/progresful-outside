import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError, type ContextDevClient, type ScrapeResponse } from '../src/contextdev/client';
import { fetchEvents, formatEventDate, parseSongkickMarkdown } from '../src/sources/events';
import { NOW, makeDeps, stubClient } from './helpers';

const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/contextdev/songkick-lisbon.json', import.meta.url), 'utf8'),
) as ScrapeResponse;
const lisbon = { city: 'Lisbon', country: 'Portugal' };
type Scrape = ContextDevClient['scrape'];

describe('formatEventDate', () => {
  it.each([
    ['2026-11-15', undefined, '15 November'],
    ['2026-11-15', '2026-11-15', '15 November'],
    ['2027-07-08', '2027-07-10', '8–10 July'],
    ['2027-06-30', '2027-07-02', '30 June – 2 July'],
  ])('formats %s to %s', (start, end, expected) => {
    expect(formatEventDate(start, end)).toBe(expected);
  });
});

describe('parseSongkickMarkdown', () => {
  const events = parseSongkickMarkdown(String(recorded.markdown.data));

  it('reads every event of the recorded page', () => {
    expect(events).toHaveLength(10);
  });

  it('reads a concert with its date, venue and link', () => {
    expect(events[0]).toEqual({
      title: 'Amon Amarth, Soilwork and Orbit Culture',
      startDate: '2026-11-15',
      venue: 'MEO Arena, Lisbon, Portugal',
      url: 'https://www.songkick.com/concerts/42906158-amon-amarth-at-meo-arena',
    });
  });

  it('reads a festival with its first and last day', () => {
    expect(events.find((event) => event.title.startsWith('NOS Alive 2027'))).toMatchObject({
      startDate: '2027-07-08',
      endDate: '2027-07-10',
      venue: 'Algés, Portugal',
    });
  });

  it('skips an entry without a full date', () => {
    const entry = [
      '- [![](https://images.sk-static.com/a)](https://www.songkick.com/concerts/1-a)',
      ' **Date to be announced**',
      ' [**Somebody**](https://www.songkick.com/concerts/1-a)',
      ' Some Hall, Lisbon, Portugal',
    ].join('\n\n');

    expect(parseSongkickMarkdown(entry)).toEqual([]);
  });

  it('returns nothing for a page without events', () => {
    expect(parseSongkickMarkdown('# Search\n\nNo results')).toEqual([]);
  });
});

describe('fetchEvents', () => {
  it('searches upcoming events for the city and returns them as facts', async () => {
    const scrape = vi.fn<Scrape>(async () => recorded);

    const result = await fetchEvents(makeDeps({ client: stubClient({ scrape }) }), lisbon);

    expect(scrape.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://www.songkick.com/search?query=Lisbon&type=upcoming',
      formats: { markdown: true },
    });
    expect(result.source).toMatchObject({ id: 'songkick', label: 'Songkick', fetchedAt: new Date(NOW).toISOString() });
    expect(result.facts[0]).toEqual({
      id: 'event:songkick:/concerts/42906158-amon-amarth-at-meo-arena',
      kind: 'event',
      title: 'Amon Amarth, Soilwork and Orbit Culture',
      dateText: '15 November',
      startDate: '2026-11-15',
      venue: 'MEO Arena, Lisbon, Portugal',
      url: 'https://www.songkick.com/concerts/42906158-amon-amarth-at-meo-arena',
      sourceId: 'songkick',
    });
  });

  it('keeps only events whose venue is in the country asked for', async () => {
    const elsewhere = String(recorded.markdown.data).replace('MEO Arena, Lisbon, Portugal', 'Town Hall, Lisbon, OH, US');
    const scrape = vi.fn<Scrape>(async () => ({ ...recorded, markdown: { success: true, data: elsewhere } }));

    const result = await fetchEvents(makeDeps({ client: stubClient({ scrape }) }), { city: 'Lisboa', country: 'Portugal' });

    expect(result.facts.some((fact) => fact.venue?.includes('OH, US'))).toBe(false);
    expect(result.facts.length).toBeGreaterThan(5);
  });

  it.each([
    ['United States', 'Madison Square Garden, New York, NY, US'],
    ['USA', 'Madison Square Garden, New York, NY, US'],
    ['United Kingdom', 'The O2, London, UK'],
  ])('knows that %s is written as in "%s"', async (country, venue) => {
    const page = String(recorded.markdown.data).replace('MEO Arena, Lisbon, Portugal', venue);
    const scrape = vi.fn<Scrape>(async () => ({ ...recorded, markdown: { success: true, data: page } }));

    const result = await fetchEvents(makeDeps({ client: stubClient({ scrape }) }), { city: 'Anywhere', country });

    expect(result.facts.map((fact) => fact.venue)).toEqual([venue]);
  });

  it('serves the second call from cache', async () => {
    const scrape = vi.fn<Scrape>(async () => recorded);
    const deps = makeDeps({ client: stubClient({ scrape }) });

    await fetchEvents(deps, lisbon);
    await fetchEvents(deps, lisbon);

    expect(scrape).toHaveBeenCalledTimes(1);
  });

  it('returns no events, not a throw, when the page cannot be fetched', async () => {
    const onSourceError = vi.fn();
    const scrape = vi.fn<Scrape>().mockRejectedValue(new Error('timeout'));

    const result = await fetchEvents(makeDeps({ client: stubClient({ scrape }), onSourceError }), lisbon);

    expect(result).toEqual({ facts: [], source: null });
    expect(onSourceError).toHaveBeenCalledWith('songkick', expect.any(Error));
  });

  it('lets exhausted credits stop the job', async () => {
    const scrape = vi.fn<Scrape>().mockRejectedValue(new CreditsExhaustedError());

    await expect(fetchEvents(makeDeps({ client: stubClient({ scrape }) }), lisbon)).rejects.toBeInstanceOf(CreditsExhaustedError);
  });
});
