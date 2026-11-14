import type { OpeningHours, Weekday } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { isOpenNow } from '../src/openNow';

/** Hours for a single weekday (0 = Sunday); every other day is closed. */
function hours(day: Weekday, open: string, close: string): OpeningHours {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], [day]: [{ open, close }] };
}

// 2026-11-13 is a Friday; Lisbon is on UTC in November.
const FRIDAY = 5;
const SATURDAY = 6;

describe('isOpenNow', () => {
  it('is open inside the range and closed outside it', () => {
    const friday = hours(FRIDAY, '09:00', '17:00');
    expect(isOpenNow(friday, 'Europe/Lisbon', new Date('2026-11-13T12:00:00Z'))).toBe(true);
    expect(isOpenNow(friday, 'Europe/Lisbon', new Date('2026-11-13T18:00:00Z'))).toBe(false);
    expect(isOpenNow(friday, 'Europe/Lisbon', new Date('2026-11-13T08:59:00Z'))).toBe(false);
  });

  it('opens on the minute and closes on the minute', () => {
    const friday = hours(FRIDAY, '09:00', '17:00');
    expect(isOpenNow(friday, 'Europe/Lisbon', new Date('2026-11-13T09:00:00Z'))).toBe(true);
    expect(isOpenNow(friday, 'Europe/Lisbon', new Date('2026-11-13T17:00:00Z'))).toBe(false);
  });

  it('handles a range that crosses midnight', () => {
    const lateBar = hours(FRIDAY, '18:00', '02:00');
    expect(isOpenNow(lateBar, 'Europe/Lisbon', new Date('2026-11-13T23:30:00Z'))).toBe(true);
    // Saturday 01:00: still open from Friday evening.
    expect(isOpenNow(lateBar, 'Europe/Lisbon', new Date('2026-11-14T01:00:00Z'))).toBe(true);
    expect(isOpenNow(lateBar, 'Europe/Lisbon', new Date('2026-11-14T02:30:00Z'))).toBe(false);
    // Friday 01:00 belongs to Thursday night, which is closed.
    expect(isOpenNow(lateBar, 'Europe/Lisbon', new Date('2026-11-13T01:00:00Z'))).toBe(false);
  });

  it('handles 24-hour places', () => {
    const always = hours(SATURDAY, '00:00', '24:00');
    expect(isOpenNow(always, 'Europe/Lisbon', new Date('2026-11-14T03:00:00Z'))).toBe(true);
    expect(isOpenNow(always, 'Europe/Lisbon', new Date('2026-11-14T23:59:00Z'))).toBe(true);
  });

  it('is closed on a day with no hours', () => {
    // 2026-11-15 is a Sunday.
    expect(isOpenNow(hours(FRIDAY, '09:00', '17:00'), 'Europe/Lisbon', new Date('2026-11-15T12:00:00Z'))).toBe(false);
  });

  it('handles split shifts', () => {
    const split: OpeningHours = { ...hours(FRIDAY, '12:00', '15:00'), 5: [{ open: '12:00', close: '15:00' }, { open: '19:00', close: '23:00' }] };
    expect(isOpenNow(split, 'Europe/Lisbon', new Date('2026-11-13T16:00:00Z'))).toBe(false);
    expect(isOpenNow(split, 'Europe/Lisbon', new Date('2026-11-13T20:00:00Z'))).toBe(true);
  });

  it('uses the place timezone, not the viewer clock', () => {
    const saturday = hours(SATURDAY, '09:00', '17:00');
    const instant = new Date('2026-11-14T01:00:00Z'); // 10:00 Saturday in Tokyo, 01:00 in Lisbon
    expect(isOpenNow(saturday, 'Asia/Tokyo', instant)).toBe(true);
    expect(isOpenNow(saturday, 'Europe/Lisbon', instant)).toBe(false);
  });

  it('is closed, not broken, for an unknown timezone', () => {
    expect(isOpenNow(hours(FRIDAY, '00:00', '24:00'), 'Mars/Olympus', new Date('2026-11-13T12:00:00Z'))).toBe(false);
  });
});
