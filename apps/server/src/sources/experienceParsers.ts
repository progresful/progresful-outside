import { cardLines, firstImage, markdownLinks } from './markdown';
import { parsePrice } from './price';

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
const UNIT = String.raw`(?:minutes?|hours?|days?)`;
const CURRENCY = String.raw`(?:US\$|CA\$|A\$|[€$£])`;
/** An amount with its currency marker. Thousands may be set off by a space: "€1 234". */
const PRICE = String.raw`${CURRENCY}\s?\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|${CURRENCY}\s?\d[\d.,]*`;
const PRICE_TOKEN = new RegExp(PRICE, 'g');
const BARE_PRICE = new RegExp(`^(?:${PRICE})$`);
/** A whole card is a few hundred characters; anything far longer is not a card. */
const MAX_CARD_CHARS = 4_000;
const MAX_TITLE_CHARS = 200;

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

const DECORATION = /[\p{Extended_Pictographic}️‍]/gu;
/** "RovaniemiRovaniemi: Northern Lights" — the card's place label glued onto a title that already starts with it. */
const REPEATED_START = /^(.{3,40}?)\1(?=[:\s-])/u;

/** A title without emoji, doubled spaces or a repeated place label. */
function cleanTitle(title: string): string {
  return title.replace(DECORATION, '').replace(/\s+/g, ' ').trim().replace(REPEATED_START, '$1');
}

/** The photo pager ("- 1 - 2 - 3"), "...More" and images are furniture, not titles. */
function isTitle(text: string): boolean {
  return text.length > 0 && text.length <= MAX_TITLE_CHARS && /\p{L}/u.test(text) && !text.startsWith('![') && !/^\.{3}\s*more$/i.test(text);
}

/**
 * The price a card asks: its one amount, or the lower, current one of an old-and-new pair.
 * Three amounts, or a second one that is higher, could mean anything, so there is no price.
 */
function currentPrice(tokens: readonly string[]): string | undefined {
  const [first, second, ...more] = tokens.map((token) => token.replace(/[\s  ]/g, ''));
  if (first === undefined || more.length > 0) {
    return undefined;
  }
  if (second === undefined) {
    return first;
  }
  const was = parsePrice(first)?.amount;
  const now = parsePrice(second)?.amount;
  return was !== undefined && now !== undefined && now < was ? second : undefined;
}

function compact(raw: RawExperience): RawExperience {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) as unknown as RawExperience;
}

const VIATOR_TOUR_URL = /^https:\/\/www\.viator\.com\/tours\//;
const VIATOR_FROM = /^from\b/i;
/**
 * A duration line: "8 hours", "9 hours 30 minutes", "1 to 5 hours", with badges glued straight on
 * ("8 hoursFree Cancellation"). A title that merely starts with a duration ("3 Hour Lisbon Tour")
 * goes on after a space, which is how the two are told apart.
 */
const VIATOR_DURATION_LINE = new RegExp(
  String.raw`^((?:\d+(?:\s*${UNIT})?\s*to\s*)?\d+\s*${UNIT}(?:\s+\d+\s+minutes?)?)(?:$|\S|\s+(?:free cancellation|travelers|likely to sell out))`,
  'i',
);
/**
 * A price for the whole party is never quoted. "Price varies by group size" is different: the
 * from-price is still the lowest per-person price, so those tours stay.
 */
const VIATOR_GROUP_PRICE = /per group/i;

/** "from **€70**", or "from" followed by lines that are nothing but a price. A "Save €10" line is not one. */
function viatorPrice(lines: readonly string[], fromIndex: number): string | undefined {
  const plain = lines.slice(fromIndex).map((line) => line.replace(/\*/g, '').trim());
  const end = plain.findIndex((line, index) => index > 0 && !BARE_PRICE.test(line));
  const priceLines = end < 0 ? plain : plain.slice(0, end);
  return currentPrice(priceLines.join(' ').match(PRICE_TOKEN) ?? []);
}

function viatorTour(text: string, url: string): RawExperience | null {
  const lines = cardLines(text);
  const fromIndex = lines.map((line) => VIATOR_FROM.test(line)).lastIndexOf(true);
  if (fromIndex < 0 || lines.some((line) => VIATOR_GROUP_PRICE.test(line))) {
    return null;
  }
  // The card ends: title, duration (not always), rating and reviews (not always), price.
  const score = findScore(lines);
  const anchor = score.index >= 0 ? score.index : fromIndex;
  const duration = VIATOR_DURATION_LINE.exec(lines[anchor - 1] ?? '')?.[1];
  const title = cleanTitle(lines[duration ? anchor - 2 : anchor - 1] ?? '');
  const priceText = viatorPrice(lines, fromIndex);
  if (!priceText || !isTitle(title)) {
    return null;
  }
  return compact({
    title,
    priceText,
    durationText: duration,
    rating: score.rating,
    reviewCount: score.reviewCount,
    url,
    imageUrl: firstImage(text)?.url,
  });
}

/** Tours from a Viator results page (`/searchResults/all?text=…`) fetched as markdown with images. */
export function parseViatorMarkdown(markdown: string): RawExperience[] {
  return markdownLinks(markdown)
    .filter((link) => VIATOR_TOUR_URL.test(link.url) && link.text.length <= MAX_CARD_CHARS)
    .flatMap((link) => viatorTour(link.text, link.url) ?? []);
}

const GYG_ACTIVITY_URL = /^https:\/\/www\.getyourguide\.com\/[^?#]*-t\d+\/?(?=[?#]|$)/;
/** The price line starts with "From" and a currency; a title may start with "From Lisbon" too. */
const GYG_PRICE_LINE = new RegExp(`^from\\s*${CURRENCY}`, 'i');
/** "9 hours", "5.5 hours", "2 - 4 hours", "15 minutes - 1 hour" — glued to the end of the title. */
const GYG_DURATION = new RegExp(
  String.raw`((?:\d+(?:\.\d+)?(?:\s*${UNIT})?\s*-\s*)?\d+(?:\.\d+)?\s*${UNIT})(?=\s*•|\s*$)`,
  'i',
);
/**
 * Where a place label was glued onto the title: a lower-case letter running straight into a
 * capitalised word or a digit ("Neustift im StubaitalTandem…", "Lisbon3-Hour…").
 */
const GLUE = /\p{Ll}(?=\p{Lu}\p{Ll}|\d)/u;
const MIN_LABEL_CHARS = 4;
const MAX_LABEL_CHARS = 40;
const PLACEHOLDER_IMAGE = 'fallback/default';
/** A price for a whole group is not a per-person price, so such offers are never quoted. */
const PER_GROUP = /per group|private group/i;

/** "LisbonSintra, Pena…" was "Lisbon: Sintra, Pena…" before the markdown lost the separator. */
function separatePlaceLabel(title: string): string {
  const at = (GLUE.exec(title)?.index ?? -1) + 1;
  const label = title.slice(0, at);
  const isLabel = at >= MIN_LABEL_CHARS && at <= MAX_LABEL_CHARS && !label.includes(':');
  return isLabel ? `${label}: ${title.slice(at)}` : title;
}

function gygTitleAndDuration(line: string): { title: string; durationText?: string } {
  const duration = GYG_DURATION.exec(line);
  const rawTitle = (duration ? line.slice(0, duration.index) : (line.split('•')[0] ?? line)).trim();
  return { title: separatePlaceLabel(cleanTitle(rawTitle)), durationText: duration?.[1] };
}

function gygActivity(text: string, url: string): RawExperience | null {
  const lines = cardLines(text);
  const priceIndex = lines.map((line) => GYG_PRICE_LINE.test(line)).lastIndexOf(true);
  if (priceIndex < 0 || lines.some((line) => PER_GROUP.test(line))) {
    return null;
  }
  const score = findScore(lines);
  const titleLine = lines[(score.index >= 0 ? score.index : priceIndex) - 1];
  // A discounted card shows the old price first; the lower one after it is what you pay.
  const priceText = currentPrice((lines[priceIndex] ?? '').match(PRICE_TOKEN) ?? []);
  const { title, durationText } = gygTitleAndDuration(titleLine ?? '');
  if (!priceText || !isTitle(title)) {
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
    .filter((link) => GYG_ACTIVITY_URL.test(link.url) && link.text.length <= MAX_CARD_CHARS)
    .flatMap((link) => gygActivity(link.text, link.url) ?? []);
}
