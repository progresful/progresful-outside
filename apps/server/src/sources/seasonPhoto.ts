import type { Source } from '@outside/shared';
import { z } from 'zod';
import { scrapeKey } from '../cache/keys';
import { cachedResult } from './page';
import type { SourceDeps, SourceResult } from './types';

const SOURCE_ID = 'wikimedia-commons';
const API_URL = 'https://commons.wikimedia.org/w/api.php';
/** Wikimedia asks every client to say what it is. No personal details go in here. */
const USER_AGENT = 'OutsideVideo/0.1 (browser extension companion server)';
const TIMEOUT_MS = 5_000;

const RESULTS = 12;
const THUMB_WIDTH = 1280;
const MIN_WIDTH = 1000;
/** Wide enough to fill a 16:9 scene without cropping most of it away. */
const MIN_ASPECT = 1.2;
const NOT_A_PHOTO = /\b(map|karte|plan|logo|wappen|coat of arms|flag|flagge|diagram|chart|locator)\b/i;

const PageSchema = z.object({
  index: z.number().default(Number.MAX_SAFE_INTEGER),
  title: z.string(),
  imageinfo: z
    .array(
      z.object({
        width: z.number(),
        height: z.number(),
        mime: z.string(),
        thumburl: z.url(),
        descriptionurl: z.url(),
      }),
    )
    .min(1),
});
const SearchSchema = z.object({ query: z.object({ pages: z.record(z.string(), z.unknown()) }) });

type Page = z.infer<typeof PageSchema>;

/** A photo of the place as it looks at the time of the stay. Shown, never spoken about. */
export interface SeasonPhoto {
  id: 'photo:season';
  imageUrl: string;
  sourceId: string;
}

export interface SeasonPhotoParams {
  city: string;
  /** What to search for: "Innsbruck winter snow". */
  query: string;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** A landscape photograph, large enough for the screen, whose own title names the place. */
function isUsable(page: Page, city: string): boolean {
  const [info] = page.imageinfo;
  return (
    info !== undefined &&
    info.mime === 'image/jpeg' &&
    info.width >= MIN_WIDTH &&
    info.width / info.height >= MIN_ASPECT &&
    fold(page.title).includes(fold(city)) &&
    !NOT_A_PHOTO.test(page.title)
  );
}

function searchUrl(query: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: String(RESULTS),
    gsrsearch: `${query} filetype:bitmap`,
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: String(THUMB_WIDTH),
  });
  return `${API_URL}?${params.toString()}`;
}

async function search(deps: SourceDeps, p: SeasonPhotoParams): Promise<Page | undefined> {
  const res = await deps.fetch(searchUrl(p.query), {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Wikimedia Commons responded with status ${res.status}`);
  }
  const parsed = SearchSchema.safeParse(await res.json());
  const pages = parsed.success ? Object.values(parsed.data.query.pages) : [];
  return pages
    .flatMap((raw) => PageSchema.safeParse(raw).data ?? [])
    .sort((a, b) => a.index - b.index)
    .find((page) => isUsable(page, p.city));
}

/**
 * A freely licensed photo of the place in the season of the stay, from Wikimedia Commons.
 * Only a photo whose title names the place is used; none is better than a wrong one. Never throws.
 */
export function fetchSeasonPhoto(deps: SourceDeps, p: SeasonPhotoParams): Promise<SourceResult<SeasonPhoto>> {
  const key = scrapeKey('season-photo', { city: fold(p.city.trim()), query: fold(p.query.trim()) });
  return cachedResult(deps, SOURCE_ID, key, async () => {
    const page = await search(deps, p);
    const info = page?.imageinfo[0];
    const fetchedAt = deps.now();
    if (!info) {
      return { result: { facts: [], source: null }, fetchedAt };
    }
    const source: Source = { id: SOURCE_ID, label: 'Wikimedia Commons', url: info.descriptionurl, fetchedAt: new Date(fetchedAt).toISOString() };
    return { result: { facts: [{ id: 'photo:season', imageUrl: info.thumburl, sourceId: SOURCE_ID }], source }, fetchedAt };
  });
}
