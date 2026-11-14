import { createHash } from 'node:crypto';
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
  // Experience and event image hosts: provisional until the source spike confirms them.
  'getyourguide.com',
  'tacdn.com',
  'viator.com',
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
