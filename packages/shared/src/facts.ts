import { z } from 'zod';
import type { InterestId } from './interests';

const TimeRangeSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
});
const DayRangesSchema = z.array(TimeRangeSchema);

/** Opening hours per weekday, 0 = Sunday. Times are 'HH:MM' local to the place; a 24-hour day is 00:00–24:00. */
export const OpeningHoursSchema = z.object({
  0: DayRangesSchema,
  1: DayRangesSchema,
  2: DayRangesSchema,
  3: DayRangesSchema,
  4: DayRangesSchema,
  5: DayRangesSchema,
  6: DayRangesSchema,
});
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  fetchedAt: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

export interface PlaceFact {
  id: string;
  kind: 'place';
  interest: InterestId;
  name: string;
  /** What kind of place it is, as the source names it: "Food court". */
  category?: string;
  rating: number;
  reviewCount: number;
  lat: number;
  lng: number;
  imageUrl: string;
  distanceM: number;
  hours?: OpeningHours;
  timezone?: string;
  sourceId: string;
}

export interface ExperienceFact {
  id: string;
  kind: 'experience';
  title: string;
  amount: number;
  currency: string;
  durationText?: string;
  rating?: number;
  reviewCount?: number;
  url: string;
  imageUrl?: string;
  sourceId: string;
}

export interface EventFact {
  id: string;
  kind: 'event';
  title: string;
  /** The date as it is shown and spoken: "15 November". */
  dateText: string;
  /** First and last day as YYYY-MM-DD, when the source gives a full date. */
  startDate?: string;
  endDate?: string;
  venue?: string;
  url: string;
  sourceId: string;
}

export interface WeatherFact {
  id: string;
  kind: 'weather';
  tempMinC: number;
  tempMaxC: number;
  precipitationChance: number;
  sourceId: string;
}

export type Fact = PlaceFact | ExperienceFact | EventFact | WeatherFact;
