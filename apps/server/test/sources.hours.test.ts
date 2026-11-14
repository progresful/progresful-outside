import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGoogleHours } from '../src/sources/hours';
import { toPlaceFact } from '../src/sources/places';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The shape Context.dev's google-maps parser returns: one entry per weekday, any order. */
function week(times: string[] | ((day: string) => string[])): unknown {
  return DAYS.map((day) => ({ day, times: typeof times === 'function' ? times(day) : times }));
}

describe('parseGoogleHours', () => {
  it('reads a plain range and maps weekdays with Sunday as 0', () => {
    const hours = parseGoogleHours(week((day) => (day === 'Sunday' ? ['9 AM–5:30 PM'] : ['10 AM–10 PM'])));

    expect(hours?.[0]).toEqual([{ open: '09:00', close: '17:30' }]);
    expect(hours?.[1]).toEqual([{ open: '10:00', close: '22:00' }]);
    expect(hours?.[6]).toEqual([{ open: '10:00', close: '22:00' }]);
  });

  it('reads closing at midnight as 24:00', () => {
    expect(parseGoogleHours(week(['10 AM–12 AM']))?.[2]).toEqual([{ open: '10:00', close: '24:00' }]);
  });

  it('keeps a range that runs past midnight', () => {
    expect(parseGoogleHours(week(['11 AM–2 AM']))?.[3]).toEqual([{ open: '11:00', close: '02:00' }]);
  });

  it('lets the opening time inherit AM/PM from the closing time', () => {
    expect(parseGoogleHours(week(['12–4:30 PM']))?.[4]).toEqual([{ open: '12:00', close: '16:30' }]);
    expect(parseGoogleHours(week(['9–11 AM']))?.[4]).toEqual([{ open: '09:00', close: '11:00' }]);
  });

  it('reads split shifts, closed days and 24-hour days', () => {
    const hours = parseGoogleHours(
      week((day) => {
        if (day === 'Monday') return ['Closed'];
        if (day === 'Tuesday') return ['Open 24 hours'];
        return ['12–3 PM', '7–11 PM'];
      }),
    );

    expect(hours?.[1]).toEqual([]);
    expect(hours?.[2]).toEqual([{ open: '00:00', close: '24:00' }]);
    expect(hours?.[3]).toEqual([
      { open: '12:00', close: '15:00' },
      { open: '19:00', close: '23:00' },
    ]);
  });

  it.each([
    ['not a list', 'Mon–Fri 9–5'],
    ['a missing weekday', DAYS.slice(1).map((day) => ({ day, times: ['9 AM–5 PM'] }))],
    ['a time it cannot read', week(['Hours might differ'])],
    ['an impossible hour', week(['13 PM–5 PM'])],
    ['nothing', null],
  ])('returns null for %s rather than guessing', (_label, raw) => {
    expect(parseGoogleHours(raw)).toBeNull();
  });

  it('reads every place in the recorded Maps response', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/contextdev/places-food.json', import.meta.url), 'utf8')) as {
      parsed: { data: { results: Array<{ google_hours?: unknown }> } };
    };
    const results = fixture.parsed.data.results;

    expect(results.length).toBeGreaterThan(10);
    for (const result of results) {
      expect(parseGoogleHours(result.google_hours)).not.toBeNull();
    }
  });
});

describe('toPlaceFact with hours', () => {
  const raw = {
    place_id: 'ChIJabc',
    name: 'Time Out Market',
    rating: 4.4,
    number_of_reviews: 77120,
    latitude: 38.7069,
    longitude: -9.1459,
    google_image: 'https://lh3.googleusercontent.com/p/abc=w800',
  };

  it('carries the opening hours when they can be read', () => {
    const fact = toPlaceFact({ ...raw, google_hours: week(['10 AM–12 AM']) }, 'food', { lat: 38.72, lng: -9.14 }, 's');

    expect(fact?.hours?.[5]).toEqual([{ open: '10:00', close: '24:00' }]);
  });

  it('leaves hours out when they cannot be read', () => {
    const fact = toPlaceFact({ ...raw, google_hours: 'unknown' }, 'food', { lat: 38.72, lng: -9.14 }, 's');

    expect(fact).not.toBeNull();
    expect(fact).not.toHaveProperty('hours');
  });
});
