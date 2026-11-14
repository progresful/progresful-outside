import { existsSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TTL_MS } from '../src/cache/cacheStore';
import { createDiskMediaStore, type MediaStore } from '../src/media/mediaStore';
import { MAX_IMAGE_BYTES, isAllowedImageUrl, mirrorImage } from '../src/media/mirror';

const IMAGE_URL = 'https://a0.muscache.com/im/pictures/x.jpg';

function imageResponse(bytes: number, contentType = 'image/jpeg', headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': contentType, ...headers } });
}

function memoryStore(): MediaStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    put: async (name, data) => {
      files.set(name, data);
      return `/media/${name}`;
    },
    sweep: async () => 0,
  };
}

describe('isAllowedImageUrl', () => {
  it.each([
    'https://a0.muscache.com/im/x.jpg',
    'https://cf.bstatic.com/xdata/images/hotel/x.jpg',
    'https://lh3.googleusercontent.com/p/abc=w800',
    'https://muscache.com/x.jpg',
  ])('allows %s', (url) => {
    expect(isAllowedImageUrl(url)).toBe(true);
  });

  it.each([
    'http://a0.muscache.com/im/x.jpg',
    'https://a0.muscache.com.evil.com/x.jpg',
    'https://evilmuscache.com/x.jpg',
    'https://127.0.0.1/x.jpg',
    'https://localhost/x.jpg',
    'https://169.254.169.254/latest/meta-data',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isAllowedImageUrl(url)).toBe(false);
  });
});

describe('mirrorImage', () => {
  it('stores an allowed image and returns its media path', async () => {
    const media = memoryStore();
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(1_000));

    const path = await mirrorImage({ fetch: fetchMock, media }, IMAGE_URL);

    expect(path).toMatch(/^\/media\/[0-9a-f]{32}\.jpg$/);
    expect(media.files.get(path?.replace('/media/', '') ?? '')?.byteLength).toBe(1_000);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].redirect).toBe('manual');
  });

  it('names the file after the url, so the same image is stored once', async () => {
    const media = memoryStore();
    const deps = { fetch: vi.fn().mockImplementation(async () => imageResponse(10, 'image/webp')), media };

    expect(await mirrorImage(deps, IMAGE_URL)).toBe(await mirrorImage(deps, IMAGE_URL));
    expect([...media.files.keys()][0]).toMatch(/\.webp$/);
  });

  it('does not fetch a url that is not allowlisted', async () => {
    const fetchMock = vi.fn();

    expect(await mirrorImage({ fetch: fetchMock, media: memoryStore() }, 'https://evil.example/x.jpg')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an html page', () => imageResponse(100, 'text/html')],
    ['a declared size over the cap', () => imageResponse(10, 'image/jpeg', { 'content-length': String(MAX_IMAGE_BYTES + 1) })],
    ['a body over the cap', () => imageResponse(MAX_IMAGE_BYTES + 1)],
    ['a redirect', () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } })],
    ['a missing image', () => new Response(null, { status: 404 })],
  ])('returns null for %s', async (_name, makeResponse) => {
    const media = memoryStore();

    expect(await mirrorImage({ fetch: vi.fn().mockResolvedValue(makeResponse()), media }, IMAGE_URL)).toBeNull();
    expect(media.files.size).toBe(0);
  });

  it('returns null, and reports why, when the download fails', async () => {
    const onError = vi.fn();
    const deps = { fetch: vi.fn().mockRejectedValue(new Error('offline')), media: memoryStore(), onError };

    expect(await mirrorImage(deps, IMAGE_URL)).toBeNull();
    expect(onError).toHaveBeenCalledWith(IMAGE_URL, expect.any(Error));
  });
});

describe('disk media store', () => {
  it('writes the file and returns its public path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outside-media-'));
    const store = createDiskMediaStore(dir);

    expect(await store.put('abc.mp3', Buffer.from('audio'))).toBe('/media/abc.mp3');
    expect(readFileSync(join(dir, 'abc.mp3'), 'utf8')).toBe('audio');
  });

  it.each(['../escape.mp3', 'a/b.mp3', '.hidden', ''])('refuses the unsafe name %j', async (name) => {
    const store = createDiskMediaStore(mkdtempSync(join(tmpdir(), 'outside-media-')));

    await expect(store.put(name, Buffer.from('x'))).rejects.toThrow(/name/i);
  });

  it('sweep deletes files older than the TTL and keeps fresh ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outside-media-'));
    const store = createDiskMediaStore(dir);
    await store.put('old.mp3', Buffer.from('x'));
    await store.put('fresh.mp3', Buffer.from('x'));
    const now = Date.now();
    const stale = new Date(now - TTL_MS - 1_000);
    utimesSync(join(dir, 'old.mp3'), stale, stale);

    expect(await store.sweep(now)).toBe(1);
    expect(existsSync(join(dir, 'old.mp3'))).toBe(false);
    expect(existsSync(join(dir, 'fresh.mp3'))).toBe(true);
  });
});
