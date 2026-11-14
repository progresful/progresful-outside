import { existsSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TTL_MS } from '../src/cache/cacheStore';
import { createDiskMediaStore, type MediaStore } from '../src/media/mediaStore';
import { MAX_IMAGE_BYTES, isAllowedImageUrl, isPublicAddress, mirrorFoundImage, mirrorImage } from '../src/media/mirror';

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

describe('isPublicAddress', () => {
  it.each(['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946'])('accepts %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-address',
    // An IPv4 address carried inside an IPv6 one reaches the same private machine.
    '::127.0.0.1', '::10.0.0.1', '2002:7f00:1::', '2002:a00:1::1', '2001:0:1::1',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe('mirrorFoundImage', () => {
  const FOUND = 'https://www.innsbruck.info/blog/uploads/lumagica.jpg';
  const publicLookup = async (): Promise<string[]> => ['93.184.216.34'];

  it('stores a photo the server found on a public host that is not on the list', async () => {
    const media = memoryStore();
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(10));
    const lookup = vi.fn(publicLookup);

    const path = await mirrorFoundImage({ fetch: fetchMock, media, lookup }, FOUND);

    expect(path).toMatch(/^\/media\/[0-9a-f]{32}\.jpg$/);
    expect(lookup).toHaveBeenCalledWith('www.innsbruck.info');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1]).toMatchObject({ redirect: 'manual' });
  });

  it.each([
    ['loopback', ['127.0.0.1']],
    ['a private network', ['10.1.2.3']],
    ['the cloud metadata address', ['169.254.169.254']],
    ['a public and a private address at once', ['93.184.216.34', '192.168.1.5']],
    ['IPv6 loopback', ['::1']],
    ['nothing at all', []],
  ])('never fetches a host that resolves to %s', async (_label, addresses) => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(10));

    const path = await mirrorFoundImage({ fetch: fetchMock, media: memoryStore(), lookup: async () => addresses }, FOUND);

    expect(path).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'http://www.innsbruck.info/a.jpg',
    'https://127.0.0.1/a.jpg',
    'https://[::1]/a.jpg',
    'https://localhost/a.jpg',
    'https://intranet/a.jpg',
    'https://www.innsbruck.info:8443/a.jpg',
    'https://user:pass@www.innsbruck.info/a.jpg',
    'not a url',
  ])('never looks up or fetches %s', async (url) => {
    const fetchMock = vi.fn();
    const lookup = vi.fn(publicLookup);

    expect(await mirrorFoundImage({ fetch: fetchMock, media: memoryStore(), lookup }, url)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow a redirect, and reports a failed lookup or download', async () => {
    const onError = vi.fn();
    const redirect = vi.fn().mockResolvedValue(new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }));

    expect(await mirrorFoundImage({ fetch: redirect, media: memoryStore(), lookup: publicLookup }, FOUND)).toBeNull();
    expect(
      await mirrorFoundImage({ fetch: vi.fn(), media: memoryStore(), lookup: vi.fn().mockRejectedValue(new Error('ENOTFOUND')), onError }, FOUND),
    ).toBeNull();
    expect(onError).toHaveBeenCalledWith(FOUND, expect.any(Error));
  });

  it('takes an allowlisted host without a lookup', async () => {
    const lookup = vi.fn(publicLookup);

    const path = await mirrorFoundImage({ fetch: vi.fn().mockResolvedValue(imageResponse(10)), media: memoryStore(), lookup }, 'https://ts1.mm.bing.net/th?id=OIP.x&w=1280');

    expect(path).toMatch(/^\/media\//);
    expect(lookup).not.toHaveBeenCalled();
  });
});
