import type { ClimateConditions, ClimateFact, Source } from '@outside/shared';
import { z } from 'zod';
import { scrapeKey } from '../cache/keys';
import { round2 } from './geo';
import { cachedResult } from './page';
import { addDays, type TripWindow } from './tripWindow';
import type { LatLng, SourceDeps, SourceResult } from './types';

const SOURCE_ID = 'open-meteo-archive';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const TIMEOUT_MS = 6_000;

const YEARS_OF_HISTORY = 3;
const YEARS_TO_TRY = 5;
/** Days added on each side of the stay, so a weekend trip still rests on a fortnight of history. */
const PADDING_DAYS = 3;
const MAX_RANGE_DAYS = 30;
/** The archive trails the present by a few days. */
const ARCHIVE_LAG_DAYS = 7;

const WET_DAY_MM = 1;
const SNOW_DAY_CM = 1;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const Values = z.array(z.number().nullable()).default([]);
const ArchiveSchema = z.object({
  daily: z.object({
    temperature_2m_max: Values,
    temperature_2m_min: Values,
    precipitation_sum: Values,
    snowfall_sum: Values,
  }),
});
type ArchiveDays = z.infer<typeof ArchiveSchema>['daily'];

export interface ClimateParams extends LatLng {
  window: TripWindow;
  /** Today as YYYY-MM-DD. */
  today: string;
}

export interface DateRange {
  start: string;
  end: string;
}

function yearsBack(iso: string, years: number): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(year - years, month - 1, day)).toISOString().slice(0, 10);
}

/** The stay's dates, padded and capped at a month, as they fell in the most recent past years. */
export function sameDatesInPastYears(window: TripWindow, today: string): DateRange[] {
  const start = addDays(window.start, -PADDING_DAYS);
  const paddedEnd = addDays(window.end, PADDING_DAYS);
  const cap = addDays(start, MAX_RANGE_DAYS);
  const end = paddedEnd > cap ? cap : paddedEnd;
  const latest = addDays(today, -ARCHIVE_LAG_DAYS);
  return Array.from({ length: YEARS_TO_TRY }, (_unused, index) => ({
    start: yearsBack(start, index + 1),
    end: yearsBack(end, index + 1),
  }))
    .filter((range) => range.end <= latest)
    .slice(0, YEARS_OF_HISTORY);
}

/** The month most of the stay's days fall in. */
function mainMonth(window: TripWindow): string {
  const counts = new Map<number, number>();
  for (let day = window.start, seen = 0; day <= window.end && seen <= MAX_RANGE_DAYS; day = addDays(day, 1), seen += 1) {
    const month = Number(day.slice(5, 7)) - 1;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  const [busiest] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return MONTHS[busiest?.[0] ?? 0] ?? '';
}

const SNOWY_PERCENT = 40;
const SOME_SNOW_PERCENT = 15;
const OFTEN_RAINY_PERCENT = 50;
const SOME_RAIN_PERCENT = 25;

/** One plain phrase for the usual weather: snow outranks rain. */
export function conditionsOf(shares: Pick<ClimateFact, 'snowDaysPercent' | 'wetDaysPercent'>): ClimateConditions {
  if (shares.snowDaysPercent >= SNOWY_PERCENT) {
    return 'snowy';
  }
  if (shares.snowDaysPercent >= SOME_SNOW_PERCENT) {
    return 'some snow';
  }
  if (shares.wetDaysPercent >= OFTEN_RAINY_PERCENT) {
    return 'often rainy';
  }
  return shares.wetDaysPercent >= SOME_RAIN_PERCENT ? 'some rain' : 'mostly dry';
}

function present(values: ReadonlyArray<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentAtLeast(values: readonly number[], threshold: number): number {
  return values.length === 0 ? 0 : Math.round((100 * values.filter((value) => value >= threshold).length) / values.length);
}

async function requestYear(deps: SourceDeps, p: LatLng, range: DateRange): Promise<ArchiveDays> {
  const url =
    `${ARCHIVE_URL}?latitude=${p.lat}&longitude=${p.lng}&start_date=${range.start}&end_date=${range.end}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=auto';
  const res = await deps.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Open-Meteo archive responded with status ${res.status}`);
  }
  return ArchiveSchema.parse(await res.json()).daily;
}

function toFact(years: readonly ArchiveDays[], window: TripWindow): ClimateFact | null {
  const all = (pick: (days: ArchiveDays) => ReadonlyArray<number | null>): number[] => years.flatMap((days) => present(pick(days)));
  const highs = all((days) => days.temperature_2m_max);
  const lows = all((days) => days.temperature_2m_min);
  if (highs.length === 0 || lows.length === 0) {
    return null;
  }
  const shares = {
    wetDaysPercent: percentAtLeast(all((days) => days.precipitation_sum), WET_DAY_MM),
    snowDaysPercent: percentAtLeast(all((days) => days.snowfall_sum), SNOW_DAY_CM),
  };
  return {
    id: 'climate:stay',
    kind: 'climate',
    month: mainMonth(window),
    tempMinC: Math.round(mean(lows)),
    tempMaxC: Math.round(mean(highs)),
    ...shares,
    conditions: conditionsOf(shares),
    sourceId: SOURCE_ID,
  };
}

/**
 * What the weather is usually like at the place on the stay's dates, from the same dates in the
 * last three years. Works for a stay months away, where no forecast reaches. Never throws.
 */
export function fetchClimate(deps: SourceDeps, p: ClimateParams): Promise<SourceResult<ClimateFact>> {
  const key = scrapeKey('climate', { lat: round2(p.lat), lng: round2(p.lng), start: p.window.start, end: p.window.end });
  return cachedResult(deps, SOURCE_ID, key, async () => {
    const answers = await Promise.allSettled(sameDatesInPastYears(p.window, p.today).map((range) => requestYear(deps, p, range)));
    const years = answers.flatMap((answer) => (answer.status === 'fulfilled' ? [answer.value] : []));
    const fact = toFact(years, p.window);
    if (!fact) {
      const failed = answers.find((answer) => answer.status === 'rejected');
      throw failed?.status === 'rejected' && failed.reason instanceof Error ? failed.reason : new Error('The archive had no data for these dates');
    }
    const fetchedAt = deps.now();
    const source: Source = { id: SOURCE_ID, label: 'Open-Meteo (past years)', url: 'https://open-meteo.com', fetchedAt: new Date(fetchedAt).toISOString() };
    return { result: { facts: [fact], source }, fetchedAt };
  });
}
