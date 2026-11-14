import { describe, expect, it, vi } from 'vitest';
import { fetchSeasonPhoto } from '../src/sources/seasonPhoto';
import { NOW, jsonResponse, makeDeps } from './helpers';

interface Page {
  index: number;
  title: string;
  width?: number;
  height?: number;
  mime?: string;
}

function commons(pages: Page[]): unknown {
  return {
    query: {
      pages: Object.fromEntries(
        pages.map((page, id) => [
          String(id + 1),
          {
            index: page.index,
            title: page.title,
            imageinfo: [
              {
                width: page.width ?? 2000,
                height: page.height ?? 1400,
                mime: page.mime ?? 'image/jpeg',
                thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(page.title)}/1280px.jpg`,
                descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
              },
            ],
          },
        ]),
      ),
    },
  };
}

const params = { city: 'Innsbruck', query: 'Innsbruck winter snow' };

describe('fetchSeasonPhoto', () => {
  it('searches Wikimedia Commons for photos and identifies itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(commons([{ index: 1, title: 'File:Innsbruck im Winter.jpg' }])));

    await fetchSeasonPhoto(makeDeps({ fetch: fetchMock }), params);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const asked = new URL(url);
    expect(asked.origin + asked.pathname).toBe('https://commons.wikimedia.org/w/api.php');
    expect(asked.searchParams.get('gsrsearch')).toBe('Innsbruck winter snow filetype:bitmap');
    expect(asked.searchParams.get('gsrnamespace')).toBe('6');
    expect(asked.searchParams.get('iiurlwidth')).toBe('1280');
    expect(new Headers(init.headers).get('user-agent')).toMatch(/^OutsideVideo\//);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the best-ranked photo that names the place', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        commons([
          { index: 2, title: 'File:Innsbruck-winter.jpg' },
          { index: 1, title: 'File:Innsbruck im Winter Hofkirche und Hofburg.jpg' },
        ]),
      ),
    );

    const result = await fetchSeasonPhoto(makeDeps({ fetch: fetchMock }), params);

    expect(result.facts).toEqual([
      {
        id: 'photo:season',
        imageUrl: `https://upload.wikimedia.org/thumb/${encodeURIComponent('File:Innsbruck im Winter Hofkirche und Hofburg.jpg')}/1280px.jpg`,
        sourceId: 'wikimedia-commons',
      },
    ]);
    expect(result.source).toMatchObject({
      id: 'wikimedia-commons',
      label: 'Wikimedia Commons',
      url: `https://commons.wikimedia.org/wiki/${encodeURIComponent('File:Innsbruck im Winter Hofkirche und Hofburg.jpg')}`,
      fetchedAt: new Date(NOW).toISOString(),
    });
  });

  it.each([
    ['a photo of somewhere else', { title: 'File:Green tent on a snow covered mountain.jpg' }],
    ['a portrait photo', { title: 'File:Innsbruck tower.jpg', width: 2848, height: 4288 }],
    ['a small photo', { title: 'File:Innsbruck small.jpg', width: 800, height: 500 }],
    ['a drawing', { title: 'File:Innsbruck in Winter.png', mime: 'image/png' }],
    ['a map', { title: 'File:Innsbruck winter map.jpg' }],
    ['a coat of arms', { title: 'File:Wappen Innsbruck.jpg' }],
  ])('passes over %s', async (_label, page) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(commons([{ index: 1, ...page }])));

    expect(await fetchSeasonPhoto(makeDeps({ fetch: fetchMock }), params)).toEqual({ facts: [], source: null });
  });

  it('matches the place name whatever its accents or case', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(commons([{ index: 1, title: 'File:ZÜRICH im Winter.jpg' }])));

    const result = await fetchSeasonPhoto(makeDeps({ fetch: fetchMock }), { city: 'Zurich', query: 'Zurich winter snow' });

    expect(result.facts).toHaveLength(1);
  });

  it('returns nothing, not a throw, when Commons fails or answers oddly', async () => {
    const onSourceError = vi.fn();

    expect(await fetchSeasonPhoto(makeDeps({ fetch: vi.fn().mockResolvedValue(jsonResponse({}, 503)), onSourceError }), params)).toEqual({ facts: [], source: null });
    expect(await fetchSeasonPhoto(makeDeps({ fetch: vi.fn().mockResolvedValue(jsonResponse({ batchcomplete: '' })) }), params)).toEqual({ facts: [], source: null });
    expect(onSourceError).toHaveBeenCalledWith('wikimedia-commons', expect.any(Error));
  });

  it('serves the second call from cache', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(commons([{ index: 1, title: 'File:Innsbruck im Winter.jpg' }])));
    const deps = makeDeps({ fetch: fetchMock });

    await fetchSeasonPhoto(deps, params);
    await fetchSeasonPhoto(deps, params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
