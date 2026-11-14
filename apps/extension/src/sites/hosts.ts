/**
 * Match patterns cannot wildcard a top-level domain, so every Airbnb domain the extension runs on
 * is listed here. The content script, host permissions and the player page all use this list.
 */
export const AIRBNB_MATCHES: readonly string[] = [
  'com', 'co.uk', 'ie', 'ca', 'com.au', 'co.nz', 'de', 'at', 'ch', 'fr', 'be', 'nl', 'es', 'pt', 'it', 'gr',
  'fi', 'se', 'no', 'dk', 'pl', 'cz', 'hu', 'com.br', 'mx', 'co.in', 'jp', 'co.kr', 'com.sg',
].map((tld) => `https://www.airbnb.${tld}/*`);

export const BOOKING_MATCHES: readonly string[] = ['https://www.booking.com/*'];

export const LISTING_SITE_MATCHES: readonly string[] = [...AIRBNB_MATCHES, ...BOOKING_MATCHES];

/** The local server the background worker talks to. */
export const SERVER_MATCHES: readonly string[] = ['http://localhost/*', 'http://127.0.0.1/*'];
