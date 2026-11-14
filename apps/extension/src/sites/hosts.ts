/**
 * Match patterns cannot wildcard a top-level domain, so every Airbnb domain the extension runs on
 * is listed here. The content script, host permissions and the player page all use this list.
 */
const AIRBNB_TLDS: readonly string[] = [
  'com', 'co.uk', 'ie', 'ca', 'com.au', 'co.nz', 'de', 'at', 'ch', 'fr', 'be', 'nl', 'es', 'pt', 'it', 'gr',
  'fi', 'se', 'no', 'dk', 'pl', 'cz', 'hu', 'com.br', 'mx', 'co.in', 'jp', 'co.kr', 'com.sg',
];

export const AIRBNB_HOSTS: readonly string[] = AIRBNB_TLDS.map((tld) => `www.airbnb.${tld}`);

export const AIRBNB_MATCHES: readonly string[] = AIRBNB_HOSTS.map((host) => `https://${host}/*`);

export const BOOKING_MATCHES: readonly string[] = ['https://www.booking.com/*'];

export const LISTING_SITE_MATCHES: readonly string[] = [...AIRBNB_MATCHES, ...BOOKING_MATCHES];

/** A server on this machine, which a development build talks to. */
const LOCAL_SERVER_MATCHES: readonly string[] = ['http://localhost/*', 'http://127.0.0.1/*'];
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/**
 * The server the background worker may reach: the one a release build was made for and no other,
 * or this machine in development. Match patterns carry no port, so only the scheme and the host are kept.
 */
export function serverMatches(builtFor: string | undefined): string[] {
  try {
    const url = new URL(builtFor ?? '');
    const web = url.protocol === 'http:' || url.protocol === 'https:';
    return web && !LOCAL_HOSTS.has(url.hostname) ? [`${url.protocol}//${url.hostname}/*`] : [...LOCAL_SERVER_MATCHES];
  } catch {
    // No address, or not one: a development build.
    return [...LOCAL_SERVER_MATCHES];
  }
}
