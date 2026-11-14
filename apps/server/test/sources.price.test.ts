import { describe, expect, it } from 'vitest';
import { formatPrice, parsePrice } from '../src/sources/price';

describe('parsePrice', () => {
  it.each([
    ['€45', null, { amount: 45, currency: 'EUR' }],
    ['From $1,234.50 per person', null, { amount: 1234.5, currency: 'USD' }],
    ['45,00 €', null, { amount: 45, currency: 'EUR' }],
    ['1.234,50 €', null, { amount: 1234.5, currency: 'EUR' }],
    ['US$30', null, { amount: 30, currency: 'USD' }],
    ['£12–£18', null, { amount: 12, currency: 'GBP' }],
    ['12–18 €', null, { amount: 12, currency: 'EUR' }],
    ['EUR 45', null, { amount: 45, currency: 'EUR' }],
    ['45 EUR', null, { amount: 45, currency: 'EUR' }],
    ['CHF 89.90', null, { amount: 89.9, currency: 'CHF' }],
    ['$1,200', null, { amount: 1200, currency: 'USD' }],
    ['2 hours from €30', null, { amount: 30, currency: 'EUR' }],
    ['45', 'EUR', { amount: 45, currency: 'EUR' }],
    ['45', '€', { amount: 45, currency: 'EUR' }],
    ['45.5', 'usd', { amount: 45.5, currency: 'USD' }],
    [45, 'EUR', { amount: 45, currency: 'EUR' }],
  ] as const)('parsePrice(%j, %j) reads the price', (text, hint, expected) => {
    expect(parsePrice(text, hint)).toEqual(expected);
  });

  it.each([
    ['45', null],
    [45, null],
    ['Free', null],
    ['Free', 'EUR'],
    ['', null],
    [null, null],
    [undefined, 'EUR'],
    ['€0', null],
    ['45', 'XYZ'],
    ['from 30 for 2 hours', 'EUR'],
    [Number.NaN, 'EUR'],
    [-5, 'EUR'],
  ] as const)('parsePrice(%j, %j) refuses to guess', (text, hint) => {
    expect(parsePrice(text, hint)).toBeNull();
  });
});

describe('formatPrice', () => {
  it('drops decimals for whole amounts', () => {
    expect(formatPrice(45, 'EUR')).toBe('€45');
    expect(formatPrice(1234, 'USD')).toBe('$1,234');
  });

  it('keeps two decimals otherwise', () => {
    expect(formatPrice(12.5, 'USD')).toBe('$12.50');
  });
});
