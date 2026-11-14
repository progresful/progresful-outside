import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CreditsExhaustedError, type ContextDevClient, type ScrapeResponse } from '../src/contextdev/client';
import { fetchPlacePhoto, parseBingImages, pickPhoto, type ImageResult } from '../src/sources/placePhoto';
import { NOW, makeDeps, stubClient } from './helpers';

type Scrape = ContextDevClient['scrape'];

const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/contextdev/bing-images-hofgarten.json', import.meta.url), 'utf8'),
) as ScrapeResponse;
const results = parseBingImages(String(recorded.html.data));

const params = { placeId: 'place:hofgarten', placeName: 'Innsbrucker Hofgarten', city: 'Innsbruck', query: 'Innsbrucker Hofgarten Innsbruck winter snow' };

function result(overrides: Partial<ImageResult> = {}): ImageResult {
  return {
    title: 'Hofgarten in winter',
    imageUrl: 'https://www.innsbruck.info/photos/hofgarten-winter.jpg',
    thumbUrl: 'https://ts1.mm.bing.net/th?id=OIP.abc&pid=15.1',
    pageUrl: 'https://www.innsbruck.info/hofgarten',
    ...overrides,
  };
}

describe('parseBingImages', () => {
  it('reads every image result of the recorded page, in order', () => {
    expect(results).toHaveLength(14);
    expect(results[0]).toEqual({
      title: 'Bergweihnacht: 5 Highlights & Tipps für den Advent in Innsb - #myinnsbruck',
      imageUrl: 'https://www.innsbruck.info/blog/wp-content/uploads/2023/12/lumagica.jpg',
      thumbUrl: 'https://ts1.mm.bing.net/th?id=OIP.zdp6OjOEC8jhlycMsIcgzgHaE8&pid=15.1',
      pageUrl: expect.stringContaining('https://www.innsbruck.info/blog/'),
    });
  });

  it('returns nothing for a page without results or with broken entries', () => {
    expect(parseBingImages('<html><body>No results</body></html>')).toEqual([]);
    expect(parseBingImages('<a class="iusc" m="{not json}"></a><a class="iusc" m="{&quot;t&quot;:&quot;x&quot;}"></a>')).toEqual([]);
  });

  it('is quick on an absurdly large page', () => {
    const started = Date.now();

    parseBingImages(' m="{'.repeat(300_000));

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('pickPhoto', () => {
  const place = { placeName: 'Innsbrucker Hofgarten', city: 'Innsbruck' };

  it('takes the first result about the place or its city, from the recorded page', () => {
    expect(pickPhoto(results, place)?.imageUrl).toBe('https://www.innsbruck.info/blog/wp-content/uploads/2023/12/lumagica.jpg');
  });

  it.each([
    ['a stock-photo site', 'https://c8.alamy.com/comp/2M6GYTP/hofgarten-innsbruck-winter.jpg'],
    ['a social network', 'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1&name=hofgarten.jpg'],
    ['another stock-photo site', 'https://www.shutterstock.com/image-photo/hofgarten-innsbruck-260nw-1.jpg'],
  ])('passes over a photo from %s', (_label, imageUrl) => {
    const good = result({ imageUrl: 'https://www.tyrol.com/hofgarten-innsbruck.jpg' });

    expect(pickPhoto([result({ imageUrl }), good], place)).toEqual(good);
  });

  it('passes over a photo that is about neither the place nor its city', () => {
    const unrelated = result({ title: 'Snowy garden', imageUrl: 'https://example.org/garden.jpg', pageUrl: 'https://example.org/garden' });

    expect(pickPhoto([unrelated], place)).toBeUndefined();
    expect(pickPhoto([unrelated, result()], place)).toEqual(result());
  });

  it('prefers a result whose original can be fetched over one with only a small copy', () => {
    const insecure = result({ imageUrl: 'http://old.example.com/hofgarten-innsbruck.jpg' });
    const notAnImage = result({ imageUrl: 'https://example.com/hofgarten-innsbruck/view?id=3' });
    const good = result({ imageUrl: 'https://www.tyrol.com/hofgarten-innsbruck.webp' });

    expect(pickPhoto([insecure, notAnImage, good], place)).toEqual(good);
    expect(pickPhoto([insecure], place)).toEqual(insecure);
  });
});

describe('fetchPlacePhoto', () => {
  it('searches Bing Images for large, wide photographs through the scraper', async () => {
    const scrape = vi.fn<Scrape>(async () => recorded);

    await fetchPlacePhoto(makeDeps({ client: stubClient({ scrape }) }), params);

    const body = scrape.mock.calls[0]?.[0] as { url: string; formats: unknown };
    const asked = new URL(body.url);
    expect(asked.origin + asked.pathname).toBe('https://www.bing.com/images/search');
    expect(asked.searchParams.get('q')).toBe('Innsbrucker Hofgarten Innsbruck winter snow');
    expect(asked.searchParams.get('qft')).toBe('+filterui:imagesize-large+filterui:aspect-wide+filterui:photo-photo');
    expect(body.formats).toEqual({ html: true });
  });

  it('returns the original photo with a Bing-hosted copy to fall back on', async () => {
    const scrape = vi.fn<Scrape>(async () => recorded);

    const found = await fetchPlacePhoto(makeDeps({ client: stubClient({ scrape }) }), params);

    expect(found.facts).toEqual([
      {
        id: 'photo:place:hofgarten',
        imageUrl: 'https://www.innsbruck.info/blog/wp-content/uploads/2023/12/lumagica.jpg',
        fallbackUrl: 'https://ts1.mm.bing.net/th?id=OIP.zdp6OjOEC8jhlycMsIcgzgHaE8&pid=15.1&w=1280&h=720&c=7&rs=1',
        sourceId: 'bing-images',
      },
    ]);
    expect(found.source).toMatchObject({ id: 'bing-images', label: 'Bing Images', fetchedAt: new Date(NOW).toISOString() });
  });

  it('offers only the Bing-hosted copy when the original cannot be fetched safely', async () => {
    const page = String(recorded.html.data).replaceAll('https://www.innsbruck.info/blog/wp-content', 'http://www.innsbruck.info/blog/wp-content');
    const scrape = vi.fn<Scrape>(async () => ({ ...recorded, html: { success: true, data: page } }));

    const [photo] = (await fetchPlacePhoto(makeDeps({ client: stubClient({ scrape }) }), params)).facts;

    expect(photo?.imageUrl).toMatch(/^https:\/\//);
  });

  it('returns nothing, not a throw, when the search fails or finds nothing usable', async () => {
    const onSourceError = vi.fn();
    const failing = vi.fn<Scrape>().mockRejectedValue(new Error('timeout'));
    const empty = vi.fn<Scrape>(async () => ({ ...recorded, html: { success: true, data: '<html></html>' } }));

    expect(await fetchPlacePhoto(makeDeps({ client: stubClient({ scrape: failing }), onSourceError }), params)).toEqual({ facts: [], source: null });
    expect(await fetchPlacePhoto(makeDeps({ client: stubClient({ scrape: empty }) }), params)).toEqual({ facts: [], source: null });
    expect(onSourceError).toHaveBeenCalledWith('bing-images', expect.any(Error));
  });

  it('serves the second call for the same place and season from cache', async () => {
    const scrape = vi.fn<Scrape>(async () => recorded);
    const deps = makeDeps({ client: stubClient({ scrape }) });

    await fetchPlacePhoto(deps, params);
    await fetchPlacePhoto(deps, params);
    await fetchPlacePhoto(deps, { ...params, query: 'Innsbrucker Hofgarten Innsbruck summer' });

    expect(scrape).toHaveBeenCalledTimes(2);
  });

  it('lets exhausted credits stop the job', async () => {
    const scrape = vi.fn<Scrape>().mockRejectedValue(new CreditsExhaustedError());

    await expect(fetchPlacePhoto(makeDeps({ client: stubClient({ scrape }) }), params)).rejects.toBeInstanceOf(CreditsExhaustedError);
  });
});
