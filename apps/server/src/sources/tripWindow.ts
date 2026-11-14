import type { ListingContext } from '@outside/shared';

/** The dates a video is about, as YYYY-MM-DD. */
export interface TripWindow {
  start: string;
  end: string;
  /** False when the listing gave no usable dates and the window is the coming two weeks. */
  fromListing: boolean;
}

const FALLBACK_DAYS = 14;
const DAY_MS = 86_400_000;

function isRealDate(iso: string | undefined): iso is string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return false;
  }
  const time = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === iso;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Uses the listing's dates only when they describe a stay that is not over yet.
 * Anything else (missing, malformed, reversed, in the past) becomes the coming 14 days.
 */
export function resolveTripWindow(listing: Pick<ListingContext, 'checkIn' | 'checkOut'>, today: string): TripWindow {
  const { checkIn, checkOut } = listing;
  const usable = isRealDate(checkIn) && isRealDate(checkOut) && checkOut > checkIn && checkOut >= today;
  if (!usable) {
    return { start: today, end: addDays(today, FALLBACK_DAYS), fromListing: false };
  }
  return { start: checkIn < today ? today : checkIn, end: checkOut, fromListing: true };
}
