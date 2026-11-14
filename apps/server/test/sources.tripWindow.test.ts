import { describe, expect, it } from 'vitest';
import { addDays, resolveTripWindow } from '../src/sources/tripWindow';

const today = '2026-11-14';
const fallback = { start: '2026-11-14', end: '2026-11-28', fromListing: false };

describe('resolveTripWindow', () => {
  it('keeps valid listing dates', () => {
    expect(resolveTripWindow({ checkIn: '2026-12-12', checkOut: '2026-12-16' }, today)).toEqual({
      start: '2026-12-12',
      end: '2026-12-16',
      fromListing: true,
    });
  });

  it('falls back to the coming 14 days when dates are in the past', () => {
    expect(resolveTripWindow({ checkIn: '2026-10-01', checkOut: '2026-10-05' }, today)).toEqual(fallback);
  });

  it('falls back when check-out is not after check-in', () => {
    expect(resolveTripWindow({ checkIn: '2026-12-16', checkOut: '2026-12-12' }, today)).toEqual(fallback);
    expect(resolveTripWindow({ checkIn: '2026-12-12', checkOut: '2026-12-12' }, today)).toEqual(fallback);
  });

  it('falls back when a date is missing', () => {
    expect(resolveTripWindow({}, today)).toEqual(fallback);
    expect(resolveTripWindow({ checkIn: '2026-12-12' }, today)).toEqual(fallback);
    expect(resolveTripWindow({ checkOut: '2026-12-16' }, today)).toEqual(fallback);
  });

  it('falls back when a date is not a real calendar date', () => {
    expect(resolveTripWindow({ checkIn: '2026-02-31', checkOut: '2026-03-05' }, today)).toEqual(fallback);
    expect(resolveTripWindow({ checkIn: 'soon', checkOut: '2026-12-16' }, today)).toEqual(fallback);
  });

  it('starts today for a stay already under way', () => {
    expect(resolveTripWindow({ checkIn: '2026-11-10', checkOut: '2026-11-20' }, today)).toEqual({
      start: '2026-11-14',
      end: '2026-11-20',
      fromListing: true,
    });
  });

  it('keeps a stay that ends today', () => {
    expect(resolveTripWindow({ checkIn: '2026-11-10', checkOut: '2026-11-14' }, today)).toEqual({
      start: '2026-11-14',
      end: '2026-11-14',
      fromListing: true,
    });
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});
