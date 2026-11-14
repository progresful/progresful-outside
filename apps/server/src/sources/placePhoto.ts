import type { Source } from '@outside/shared';
import { z } from 'zod';
import { scrapeKey } from '../cache/keys';
import { realFetchedAt } from '../contextdev/client';
import { fold } from './country';
import { cachedResult } from './page';
import type { SourceDeps, SourceResult } from './types';

const SOURCE_ID = 'bing-images';
const SEARCH_URL = 'https://www.bing.com/images/search';
/** Large, wide photographs only: what fills a 16:9 scene. */
const FILTERS = '+filterui:imagesize-large+filterui:aspect-wide+filterui:photo-photo';
/** Bing serves its own copy of a result at any size asked for, cropped to fit. */
const BING_COPY_SIZE = '&w=1280&h=720&c=7&rs=1';

const MAX_HTML_CHARS = 3_000_000;
const MAX_ENTRY_CHARS = 6_000;
const MIN_WORD_CHARS = 4;
/** Each result carries its details as JSON in an `m` attribute. */
const RESULT = new RegExp(String.raw`\sm="(\{[^"]{0,${MAX_ENTRY_CHARS}}\})"`, 'g');
const IMAGE_FILE = /\.(?:jpe?g|png|webp)(?:$|[?#])/i;
/** Watermarked stock photos, and hosts that only serve their images to their own pages. */
const UNUSABLE_HOSTS = [
  'alamy.com', 'shutterstock.com', 'istockphoto.com', 'gettyimages.com', 'dreamstime.com', '123rf.com', 'depositphotos.com',
  'stock.adobe.com', 'ftcdn.net', 'agefotostock.com', 'pond5.com', 'bigstockphoto.com', 'canstockphoto.com', 'vecteezy.com',
  'fbsbx.com', 'fbcdn.net', 'facebook.com', 'instagram.com', 'cdninstagram.com', 'tiktok.com', 'pinimg.com',
];

const EntrySchema = z.object({
  t: z.string().default(''),
  desc: z.string().default(''),
  murl: z.string().min(1),
  turl: z.url(),
  purl: z.string().default(''),
});

/** One result of an image search. */
export interface ImageResult {
  title: string;
  /** The photo where it was found. */
  imageUrl: string;
  /** The search engine's own, smaller copy. */
  thumbUrl: string;
  pageUrl: string;
}

/** A photo found for a place, with a copy to fall back on when the original cannot be downloaded. */
export interface FoundPhoto {
  id: string;
  imageUrl: string;
  fallbackUrl: string;
  sourceId: string;
}

export interface PlacePhotoParams {
  placeId: string;
  placeName: string;
  city: string;
  /** What to search for: "Innsbrucker Hofgarten Innsbruck winter snow". */
  query: string;
}

const ENTITIES: Readonly<Record<string, string>> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (decimal || hex) {
      const code = decimal ? Number(decimal) : parseInt(hex ?? '', 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[(name ?? '').toLowerCase()] ?? whole;
  });
}

/** The image results of a Bing Images page, in the order Bing ranked them. */
export function parseBingImages(html: string): ImageResult[] {
  return [...html.slice(0, MAX_HTML_CHARS).matchAll(RESULT)].flatMap((match) => {
    try {
      const entry = EntrySchema.safeParse(JSON.parse(decodeEntities(match[1] ?? '')));
      return entry.success
        ? [{ title: entry.data.t.trim(), imageUrl: entry.data.murl, thumbUrl: entry.data.turl, pageUrl: entry.data.purl }]
        : [];
    } catch {
      // An entry that is not JSON is skipped; the others still count.
      return [];
    }
  });
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    // Not a URL: there is no host to judge.
    return null;
  }
}

function isUnusableHost(url: string): boolean {
  const host = hostOf(url);
  return host === null || UNUSABLE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** An https address of an image file on a named host: something the mirror can check and fetch. */
function hasFetchableOriginal(result: ImageResult): boolean {
  try {
    const url = new URL(result.imageUrl);
    return url.protocol === 'https:' && url.username === '' && url.port === '' && url.hostname.includes('.') && IMAGE_FILE.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

/** Whether the result says it is about the place, or at least about its city. */
function isAbout(result: ImageResult, placeName: string, city: string): boolean {
  const text = fold(`${result.title} ${result.imageUrl} ${result.pageUrl}`);
  const words = [...fold(placeName).split(/[^\p{L}\p{N}]+/u), fold(city)].filter((word) => word.length >= MIN_WORD_CHARS);
  return words.some((word) => text.includes(word));
}

/**
 * The first result that is about the place or its city and comes from a usable host. One whose
 * original can be fetched is preferred; failing that, one with only the search engine's copy.
 */
export function pickPhoto(results: readonly ImageResult[], place: Pick<PlacePhotoParams, 'placeName' | 'city'>): ImageResult | undefined {
  const usable = results.filter((result) => !isUnusableHost(result.imageUrl) && isAbout(result, place.placeName, place.city));
  return usable.find(hasFetchableOriginal) ?? usable[0];
}

/**
 * A photo of a place as it looks in the season of the stay, found by image search. Google Images
 * answers automated requests with a CAPTCHA, so the search goes to Bing Images. Never throws,
 * except for exhausted credits.
 */
export function fetchPlacePhoto(deps: SourceDeps, p: PlacePhotoParams): Promise<SourceResult<FoundPhoto>> {
  const key = scrapeKey('place-photo', { place: p.placeId, query: fold(p.query) });
  return cachedResult(deps, SOURCE_ID, key, async () => {
    const url = `${SEARCH_URL}?${new URLSearchParams({ q: p.query, qft: FILTERS, form: 'IRFLTR' }).toString()}`;
    const res = await deps.client.scrape({ url, formats: { html: true } });
    const html = res.html.success === true && typeof res.html.data === 'string' ? res.html.data : '';
    const picked = pickPhoto(parseBingImages(html), p);
    const fetchedAt = realFetchedAt(res, deps.now());
    if (!picked) {
      return { result: { facts: [], source: null }, fetchedAt };
    }
    const bingCopy = `${picked.thumbUrl}${BING_COPY_SIZE}`;
    const photo: FoundPhoto = {
      id: `photo:${p.placeId}`,
      imageUrl: hasFetchableOriginal(picked) ? picked.imageUrl : bingCopy,
      fallbackUrl: bingCopy,
      sourceId: SOURCE_ID,
    };
    const source: Source = { id: SOURCE_ID, label: 'Bing Images', url, fetchedAt: new Date(fetchedAt).toISOString() };
    return { result: { facts: [photo], source }, fetchedAt };
  });
}
