import type { OpeningHours, Weekday } from '@outside/shared';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINUTES_PER_DAY = 1440;

interface LocalClock {
  day: Weekday;
  minutes: number;
}

/** The weekday and minutes past midnight at the place, or null when its timezone is not known. */
function localClock(timezone: string, now: Date): LocalClock | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
    const day = WEEKDAYS.indexOf(part('weekday'));
    const minutes = Number(part('hour')) * 60 + Number(part('minute'));
    return day >= 0 && Number.isFinite(minutes) ? { day: day as Weekday, minutes } : null;
  } catch {
    // An unknown timezone means we cannot tell; the caller simply shows no open-now chip.
    return null;
  }
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Whether the place is open at `now`, on its own clock. Computed when the video plays, never
 * baked in, so a cached video stays right. Ranges may cross midnight ("18:00"–"02:00").
 */
export function isOpenNow(hours: OpeningHours, timezone: string, now: Date): boolean {
  const clock = localClock(timezone, now);
  if (!clock) {
    return false;
  }
  const yesterday = ((clock.day + 6) % 7) as Weekday;
  const openedToday = hours[clock.day].some((range) => {
    const open = toMinutes(range.open);
    const close = toMinutes(range.close);
    return close > open ? clock.minutes >= open && clock.minutes < close : clock.minutes >= open;
  });
  const stillOpenFromYesterday = hours[yesterday].some((range) => {
    const close = toMinutes(range.close);
    return close <= toMinutes(range.open) && close < MINUTES_PER_DAY && clock.minutes < close;
  });
  return openedToday || stillOpenFromYesterday;
}
