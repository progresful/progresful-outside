export interface Price {
  amount: number;
  currency: string;
}

const ISO_CODES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'));

/** Longer markers first, so "US$" is not read as "$". */
const SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['A$', 'AUD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['$', 'USD'],
];

const NUMBER = String.raw`\d+(?:[.,]\d+)*`;
const MARKER = String.raw`US\$|CA\$|A\$|€|£|\$|\b[A-Z]{3}\b`;
const MARKER_THEN_NUMBER = new RegExp(`(${MARKER})\\s*(${NUMBER})`, 'g');
const NUMBER_THEN_MARKER = new RegExp(`(${NUMBER})\\s*(${MARKER})`, 'g');
const RANGE_START = new RegExp(`(${NUMBER})\\s*[–—-]\\s*$`);
const ANY_NUMBER = new RegExp(NUMBER, 'g');

function currencyOf(marker: string | null | undefined): string | null {
  const trimmed = marker?.trim();
  if (!trimmed) {
    return null;
  }
  const symbol = SYMBOLS.find(([text]) => text === trimmed);
  if (symbol) {
    return symbol[1];
  }
  const code = trimmed.toUpperCase();
  return ISO_CODES.has(code) ? code : null;
}

/** Reads "1,234.50", "1.234,50", "45,00" and "1,200" as the numbers a person would. */
function toAmount(token: string): number | null {
  const hasComma = token.includes(',');
  const hasDot = token.includes('.');
  let normalized = token;
  if (hasComma && hasDot) {
    const decimal = token.lastIndexOf(',') > token.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    normalized = token.split(thousands).join('').replace(decimal, '.');
  } else if (hasComma) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(token) ? token.split(',').join('') : token.replace(',', '.');
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(token)) {
    normalized = token.split('.').join('');
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function priced(token: string, currency: string | null): Price | null {
  const amount = toAmount(token);
  return amount !== null && currency !== null ? { amount, currency } : null;
}

/** A number that sits right next to a currency marker: "€45", "45 EUR", or the low end of "12–18 €". */
function markedPrice(text: string): Price | null {
  for (const match of text.matchAll(MARKER_THEN_NUMBER)) {
    const found = priced(match[2] ?? '', currencyOf(match[1]));
    if (found) {
      return found;
    }
  }
  for (const match of text.matchAll(NUMBER_THEN_MARKER)) {
    const rangeStart = RANGE_START.exec(text.slice(0, match.index));
    const found = priced(rangeStart?.[1] ?? match[1] ?? '', currencyOf(match[2]));
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Turns scraped price text into an amount and an ISO currency, or null.
 * It never guesses: no currency, no price; several bare numbers, no price.
 */
export function parsePrice(text: string | number | null | undefined, currencyHint?: string | null): Price | null {
  if (text === null || text === undefined) {
    return null;
  }
  const hinted = currencyOf(currencyHint);
  if (typeof text === 'number') {
    return Number.isFinite(text) && text > 0 && hinted !== null ? { amount: text, currency: hinted } : null;
  }
  const marked = markedPrice(text);
  if (marked) {
    return marked;
  }
  const numbers = text.match(ANY_NUMBER) ?? [];
  return numbers.length === 1 ? priced(numbers[0] ?? '', hinted) : null;
}

/** "€45" for whole amounts, "$12.50" otherwise. */
export function formatPrice(amount: number, currency: string): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
