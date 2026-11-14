import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { MediaStore } from './mediaStore';

/**
 * Hosts the server may download scene images from. A URL qualifies when its hostname is one of
 * these or a subdomain of one. Client-supplied photo URLs go through this check, so the server
 * can never be pointed at an internal address.
 */
export const IMAGE_HOST_ALLOWLIST: readonly string[] = [
  'muscache.com', // Airbnb listing photos
  'bstatic.com', // Booking.com listing photos
  'googleusercontent.com', // Google Maps place photos
  'ggpht.com', // Google Maps place photos
  'tacdn.com', // Viator tour photos
  'getyourguide.com',
  'viator.com',
  'wikimedia.org', // Wikimedia Commons: the photo of the place in season
  'mm.bing.net', // Bing's own copies of image-search results
];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const NAME_LENGTH = 32;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export interface MirrorDeps {
  fetch: typeof fetch;
  media: MediaStore;
  onError?: (url: string, error: unknown) => void;
  /** Resolves a host name to its addresses. Injected for tests; DNS by default. */
  lookup?: (hostname: string) => Promise<string[]>;
}

/** Addresses that are not the public internet: loopback, private networks, link-local, and the like. */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
// `::/96`, `2002::/16` and `2001::/32` carry an IPv4 address inside an IPv6 one, which could be a private machine.
for (const [network, prefix] of [
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16], ['2001::', 32],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv6');
}
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Whether an IP address is on the public internet. Anything unreadable is not. */
export function isPublicAddress(address: string): boolean {
  const mapped = MAPPED_IPV4.exec(address)?.[1];
  if (mapped) {
    return isPublicAddress(mapped);
  }
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  return !NOT_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

async function resolveAll(hostname: string): Promise<string[]> {
  return (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);
}

/** A plain https address on a named host: no credentials, no port, no bare IP, no single-label name. */
function namedHttpsHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const plain = parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.port === '';
    return plain && isIP(host.replace(/^\[|\]$/g, '')) === 0 && host.includes('.') && !host.endsWith('.local') ? host : null;
  } catch {
    // Not a URL: nothing to fetch.
    return null;
  }
}

export function isAllowedImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return IMAGE_HOST_ALLOWLIST.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Reads the body but gives up as soon as it grows past the cap. */
async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks);
    }
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

async function download(deps: MirrorDeps, url: string): Promise<string | null> {
  const res = await deps.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (res.status !== 200 || !contentType.startsWith('image/') || declared > MAX_IMAGE_BYTES) {
    return null;
  }
  const data = await readCapped(res, MAX_IMAGE_BYTES);
  if (!data || data.byteLength === 0) {
    return null;
  }
  const hash = createHash('sha256').update(url).digest('hex').slice(0, NAME_LENGTH);
  return deps.media.put(`${hash}.${EXTENSIONS[contentType] ?? 'img'}`, data);
}

/**
 * Copies a scene image into the media store so the player loads everything from one origin.
 * Returns the media path, or null when the image is not allowed or cannot be fetched. Never throws.
 */
export async function mirrorImage(deps: MirrorDeps, url: string): Promise<string | null> {
  if (!isAllowedImageUrl(url)) {
    return null;
  }
  try {
    return await download(deps, url);
  } catch (error: unknown) {
    deps.onError?.(url, error);
    return null;
  }
}

/**
 * Copies a photo the server itself found by image search. Such photos sit on any site, so the
 * host cannot be on a list; instead the host must be a public one: a named https host every one
 * of whose addresses is on the public internet. Redirects are never followed. Client-supplied
 * photo addresses do not come this way; they stay on the allowlist. Never throws.
 */
export async function mirrorFoundImage(deps: MirrorDeps, url: string): Promise<string | null> {
  if (isAllowedImageUrl(url)) {
    return mirrorImage(deps, url);
  }
  const host = namedHttpsHost(url);
  if (host === null) {
    return null;
  }
  try {
    const addresses = await (deps.lookup ?? resolveAll)(host);
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
      return null;
    }
    return await download(deps, url);
  } catch (error: unknown) {
    deps.onError?.(url, error);
    return null;
  }
}
