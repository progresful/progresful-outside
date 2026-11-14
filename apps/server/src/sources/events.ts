import type { EventFact, Source } from '@outside/shared';
import { scrapeKey } from '../cache/keys';
import { countryNames, fold } from './country';
import { markdownLinks } from './markdown';
import { cachedResult, scrapeMarkdownPage } from './page';
import type { SourceDeps, SourceResult } from './types';

const SOURCE_ID = 'songkick';
const SOURCE_LABEL = 'Songkick';
/** Events carry no price, so the fetch country only has to be one the scraper supports. */
const FETCH_COUNTRY = 'DE';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const EVENT_URL = /^https:\/\/www\.songkick\.com\/(?:concerts|festivals)\//;
const ENTRY_START = /\n(?=- \[!\[)/;
const BOLD = /\*\*([^*]+)\*\*/g;
const FULL_DATE = /(\d{1,2}) ([A-Za-z]+) (\d{4})/g;
const NOT_A_VENUE = /^(\[|!\[|\*\*|interested$|going$|upcoming |- )/i;

export interface RawEvent {
  title: string;
  /** First day, YYYY-MM-DD. */
  startDate: string;
  /** Last day, when the event runs over several. */
  endDate?: string;
  venue?: string;
  url: string;
}

export interface EventsParams {
  city: string;
  country: string;
}

function toIsoDate(day: string, monthName: string, year: string): string | null {
  const month = MONTHS.findIndex((name) => name.toLowerCase() === monthName.toLowerCase());
  const dayNumber = Number(day);
  if (month < 0 || dayNumber < 1 || dayNumber > 31) {
    return null;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
}

/** The dates in the first bold run that holds a full date: one for a concert, two for a festival. */
function datesOf(entry: string): string[] {
  for (const bold of entry.matchAll(BOLD)) {
    const dates = [...(bold[1] ?? '').matchAll(FULL_DATE)].flatMap(
      (match) => toIsoDate(match[1] ?? '', match[2] ?? '', match[3] ?? '') ?? [],
    );
    if (dates.length > 0) {
      return dates;
    }
  }
  return [];
}

function songkickEvent(entry: string): RawEvent | null {
  const link = markdownLinks(entry).find(
    (candidate) => EVENT_URL.test(candidate.url) && !candidate.text.startsWith('![') && !/^buy tickets$/i.test(candidate.text.trim()),
  );
  const [startDate, endDate] = datesOf(entry);
  if (!link || !startDate) {
    return null;
  }
  const lines = entry
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const titleLine = lines.findIndex((line) => line.startsWith('[') && line.includes(`](${link.url})`));
  const venue = titleLine < 0 ? undefined : lines.slice(titleLine + 1).find((line) => !NOT_A_VENUE.test(line));
  return {
    title: link.text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(),
    startDate,
    ...(endDate && endDate !== startDate ? { endDate } : {}),
    ...(venue ? { venue } : {}),
    url: link.url,
  };
}

/** Upcoming concerts and festivals from a Songkick search page (`/search?query=…&type=upcoming`). */
export function parseSongkickMarkdown(markdown: string): RawEvent[] {
  return `\n${markdown}`.split(ENTRY_START).flatMap((entry) => songkickEvent(entry) ?? []);
}

function dayAndMonth(isoDate: string): { day: number; month: string } {
  const [, month, day] = isoDate.split('-').map(Number);
  return { day: day ?? 1, month: MONTHS[(month ?? 1) - 1] ?? '' };
}

/** "15 November", "8–10 July", "30 June – 2 July": no year and no weekday, so it reads well aloud. */
export function formatEventDate(startDate: string, endDate?: string): string {
  const start = dayAndMonth(startDate);
  if (!endDate || endDate === startDate) {
    return `${start.day} ${start.month}`;
  }
  const end = dayAndMonth(endDate);
  return start.month === end.month
    ? `${start.day}–${end.day} ${end.month}`
    : `${start.day} ${start.month} – ${end.day} ${end.month}`;
}

/** "MEO Arena, Lisbon, Portugal" → "MEO Arena": the viewer already knows the city. */
export function venueName(venue: string | undefined): string | undefined {
  const name = venue?.split(',')[0]?.trim();
  return name ? name : undefined;
}

/**
 * A text search for "Lisbon" also finds Lisbon, Ohio. An event is kept only when its venue names
 * the listing's country (or its city, when the listing gives no separate country).
 */
function isNearby(event: RawEvent, p: EventsParams): boolean {
  if (event.venue === undefined) {
    return false;
  }
  const venue = fold(event.venue);
  if (fold(p.country) === fold(p.city)) {
    return fold(p.city).length > 0 && venue.includes(fold(p.city));
  }
  // The country closes the venue line, written out ("Portugal") or abbreviated ("US", "UK").
  const lastPart = venue.split(',').pop()?.trim() ?? '';
  return countryNames(p.country).some((name) => name.length > 0 && (lastPart === name || (name.length > 3 && venue.includes(name))));
}

function toEventFact(raw: RawEvent): EventFact {
  return {
    id: `event:${SOURCE_ID}:${new URL(raw.url).pathname}`,
    kind: 'event',
    title: raw.title,
    dateText: formatEventDate(raw.startDate, raw.endDate),
    startDate: raw.startDate,
    ...(raw.endDate ? { endDate: raw.endDate } : {}),
    ...(raw.venue ? { venue: raw.venue } : {}),
    url: raw.url,
    sourceId: SOURCE_ID,
  };
}

/**
 * Upcoming live events in the city, soonest first as the source lists them. Cached per city;
 * choosing the ones inside the stay happens at selection time. Never throws, except for exhausted credits.
 */
export function fetchEvents(deps: SourceDeps, p: EventsParams): Promise<SourceResult<EventFact>> {
  const city = p.city.trim();
  const key = scrapeKey('events', { source: SOURCE_ID, city: city.toLowerCase(), country: p.country.trim().toLowerCase() });
  return cachedResult(deps, SOURCE_ID, key, async () => {
    const url = `https://www.songkick.com/search?query=${encodeURIComponent(city)}&type=upcoming`;
    const page = await scrapeMarkdownPage(deps, url, FETCH_COUNTRY);
    const facts = parseSongkickMarkdown(page.markdown)
      .filter((event) => isNearby(event, p))
      .map(toEventFact);
    const source: Source = { id: SOURCE_ID, label: SOURCE_LABEL, url, fetchedAt: new Date(page.fetchedAt).toISOString() };
    return { result: { facts, source }, fetchedAt: page.fetchedAt };
  });
}
