import type { OpeningHours, Weekday } from '@outside/shared';
import { z } from 'zod';

type TimeRange = OpeningHours[Weekday][number];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS_PER_WEEK = 7;
const NOON = 12;
const MIDNIGHT = '00:00';
const END_OF_DAY = '24:00';
const ALL_DAY: TimeRange = { open: MIDNIGHT, close: END_OF_DAY };

/** "10 AM–12 AM", "12–4:30 PM": the opening time may leave its AM/PM to the closing time. */
const RANGE = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i;

const RawHoursSchema = z.array(z.object({ day: z.string(), times: z.array(z.string()) }));

function toClock(hourText: string, minuteText: string | undefined, meridiem: string): string | null {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? '0');
  if (hour < 1 || hour > NOON || minute > 59) {
    return null;
  }
  const hour24 = (hour % NOON) + (meridiem.toUpperCase() === 'PM' ? NOON : 0);
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** One entry of a day's `times`: no ranges for "Closed", one range otherwise, null when unreadable. */
function parseTimes(text: string): TimeRange[] | null {
  const trimmed = text.trim();
  if (/^closed$/i.test(trimmed)) {
    return [];
  }
  if (/^open 24 hours$/i.test(trimmed)) {
    return [ALL_DAY];
  }
  const match = RANGE.exec(trimmed);
  const closeMeridiem = match?.[6];
  if (!match || !closeMeridiem) {
    return null;
  }
  const open = toClock(match[1] ?? '', match[2], match[3] ?? closeMeridiem);
  const close = toClock(match[4] ?? '', match[5], closeMeridiem);
  if (open === null || close === null) {
    return null;
  }
  // Closing at midnight is the end of the same day, not the start of it.
  return [{ open, close: close === MIDNIGHT ? END_OF_DAY : close }];
}

function parseDay(times: readonly string[]): TimeRange[] | null {
  const parsed = times.map(parseTimes);
  return parsed.some((ranges) => ranges === null) ? null : parsed.flatMap((ranges) => ranges ?? []);
}

/**
 * Opening hours from Context.dev's google-maps parser (`google_hours`), or null.
 * It never guesses: a missing weekday or one unreadable time means no hours at all,
 * so the video shows no "Open now" chip rather than a wrong one.
 */
export function parseGoogleHours(raw: unknown): OpeningHours | null {
  const parsed = RawHoursSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const byDay = new Map<number, TimeRange[]>();
  for (const entry of parsed.data) {
    const day = WEEKDAYS.indexOf(entry.day.trim().toLowerCase());
    const ranges = parseDay(entry.times);
    if (day < 0 || ranges === null) {
      return null;
    }
    byDay.set(day, ranges);
  }
  if (byDay.size !== DAYS_PER_WEEK) {
    return null;
  }
  const dayRanges = (day: Weekday): TimeRange[] => byDay.get(day) ?? [];
  return { 0: dayRanges(0), 1: dayRanges(1), 2: dayRanges(2), 3: dayRanges(3), 4: dayRanges(4), 5: dayRanges(5), 6: dayRanges(6) };
}
