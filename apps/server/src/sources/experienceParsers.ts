import { cardLines, firstImage, markdownLinks } from './markdown';

export { markdownLinks } from './markdown';

/** One bookable offer as the results page shows it, before the price is checked. */
export interface RawExperience {
  title: string;
  /** The price as shown, with its currency marker: "€70". */
  priceText: string;
  durationText?: string;
  rating?: number;
  reviewCount?: number;
  url: string;
  imageUrl?: string;
}

const RATING = /^\d(?:\.\d+)?$/;
const REVIEWS = /^\(([\d.,]+)\)$/;
const FROM_PRICE = /^from\b/i;
const PRICE_TOKEN = /(?:US\$|CA\$|A\$|[€$£])\s?\d[\d.,]*/g;
const UNIT = String.raw`(?:minutes?|hours?|days?)`;

interface Score {
  /** Index of the rating line, or -1 when the card shows none. */
  index: number;
  rating?: number;
  reviewCount?: number;
}

/** A rating is a bare number directly followed by a review count in brackets. */
function findScore(lines: readonly string[]): Score {
  const index = lines.findIndex((line, i) => RATING.test(line) && REVIEWS.test(lines[i + 1] ?? ''));
  if (index < 0) {
    return { index };
  }
  const reviews = REVIEWS.exec(lines[index + 1] ?? '')?.[1] ?? '';
  return { index, rating: Number(lines[index]), reviewCount: Number(reviews.replace(/[.,]/g, '')) };
}

const DECORATION = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
/** "RovaniemiRovaniemi: Northern Lights" — the card's place label glued onto a title that already starts with it. */
const REPEATED_START = /^(.{3,40}?)\1(?=[:\s-])/u;

/** A title without emoji, doubled spaces or a repeated place label. */
function cleanTitle(title: string): string {
  return title.replace(DECORATION, '').replace(/\s+/g, ' ').trim().replace(REPEATED_START, '$1');
}

function compact(raw: RawExperience): RawExperience {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) as unknown as RawExperience;
}

const VIATOR_TOUR_URL = /^https:\/\/www\.viator\.com\/tours\//;
/** "8 hours", "9 hours 30 minutes", "1 to 5 hours", "30 minutes to 5 hours" — at the start, before glued-on badges. */
const VIATOR_DURATION = new RegExp(String.raw`^((?:\d+(?:\s*${UNIT})?\s*to\s*)?\d+\s*${UNIT}(?:\s+\d+\s+minutes?)?)`, 'i');

/**
 * A price for the whole party is never quoted. "Price varies by group size" is different: the
 * from-price is still the lowest per-person price, so those tours stay.
 */
const VIATOR_GROUP_PRICE = /per group/i;

function viatorTour(text: string, url: string): RawExperience | null {
  const lines = cardLines(text);
  const fromIndex = lines.map((line) => FROM_PRICE.test(line)).lastIndexOf(true);
  const image = firstImage(text);
  const score = findScore(lines);
  const durationIndex = lines.findIndex((line) => VIATOR_DURATION.test(line));
  // The photo's alt text is often a caption ("Benagil sea cave"), so the card's own title line comes first.
  const title = cleanTitle(lines[durationIndex - 1] ?? image?.alt ?? '');
  // "from", then the price; a discounted tour shows the old price first, so the last one is what you pay.
  const priceText = fromIndex < 0 ? undefined : lines.slice(fromIndex).join(' ').replace(/\*/g, '').match(PRICE_TOKEN)?.at(-1);
  if (!priceText || !title || lines.some((line) => VIATOR_GROUP_PRICE.test(line))) {
    return null;
  }
  return compact({
    title,
    priceText,
    durationText: VIATOR_DURATION.exec(lines[durationIndex] ?? '')?.[1],
    rating: score.rating,
    reviewCount: score.reviewCount,
    url,
    imageUrl: image?.url,
  });
}

/** Tours from a Viator results page (`/searchResults/all?text=…`) fetched as markdown with images. */
export function parseViatorMarkdown(markdown: string): RawExperience[] {
  return markdownLinks(markdown)
    .filter((link) => VIATOR_TOUR_URL.test(link.url))
    .flatMap((link) => viatorTour(link.text, link.url) ?? []);
}

const GYG_ACTIVITY_URL = /^https:\/\/www\.getyourguide\.com\/[^?#]*-t\d+\/?(?=[?#]|$)/;
/** "9 hours", "5.5 hours", "2 - 4 hours", "15 minutes - 1 hour" — glued to the end of the title. */
const GYG_DURATION = new RegExp(
  String.raw`((?:\d+(?:\.\d+)?(?:\s*${UNIT})?\s*-\s*)?\d+(?:\.\d+)?\s*${UNIT})(?=\s*•|\s*$)`,
  'i',
);
/** The place prefix loses its ": " in markdown: "LisbonSintra…" was "Lisbon: Sintra…". */
const GLUED_PLACE_PREFIX = /^((?:From )?\p{Lu}\p{Ll}{3,}(?: \p{Lu}\p{Ll}+)?)(?=\p{Lu}\p{Ll})/u;
const PLACEHOLDER_IMAGE = 'fallback/default';
/** A price for a whole group is not a per-person price, so such offers are never quoted. */
const PER_GROUP = /per group|private group/i;

function gygTitleAndDuration(line: string): { title: string; durationText?: string } {
  const duration = GYG_DURATION.exec(line);
  const rawTitle = (duration ? line.slice(0, duration.index) : (line.split('•')[0] ?? line)).trim();
  return { title: cleanTitle(rawTitle).replace(GLUED_PLACE_PREFIX, '$1: '), durationText: duration?.[1] };
}

function gygActivity(text: string, url: string): RawExperience | null {
  const lines = cardLines(text);
  const priceIndex = lines.findIndex((line) => FROM_PRICE.test(line));
  const priceLine = lines[priceIndex];
  if (priceLine === undefined || lines.some((line) => PER_GROUP.test(line))) {
    return null;
  }
  const score = findScore(lines);
  const titleLine = lines[(score.index >= 0 ? score.index : priceIndex) - 1];
  // A discounted card shows the old price first; the last one is what you pay.
  const priceText = priceLine.match(PRICE_TOKEN)?.at(-1) ?? priceLine.replace(FROM_PRICE, '').trim();
  const { title, durationText } = gygTitleAndDuration(titleLine ?? '');
  if (!title || !priceText) {
    return null;
  }
  const image = firstImage(text);
  return compact({
    title,
    priceText,
    durationText,
    rating: score.rating,
    reviewCount: score.reviewCount,
    url: GYG_ACTIVITY_URL.exec(url)?.[0] ?? url,
    imageUrl: image && !image.url.includes(PLACEHOLDER_IMAGE) ? image.url : undefined,
  });
}

/** Activities from a GetYourGuide results page (`/s/?q=…`). Offers priced per group are left out. */
export function parseGetYourGuideMarkdown(markdown: string): RawExperience[] {
  return markdownLinks(markdown)
    .filter((link) => GYG_ACTIVITY_URL.test(link.url))
    .flatMap((link) => gygActivity(link.text, link.url) ?? []);
}
