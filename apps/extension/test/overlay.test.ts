import sample from '@outside/video/sample-manifest.json';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_MESSAGE, createOverlay } from '../src/overlay';
import { manifestFrom, playerParams } from '../src/player/playerData';

const ORIGIN = 'chrome-extension://abcdefghijklmnop';
const playerUrl = (videoId: string): string => `${ORIGIN}/player.html?videoId=${videoId}`;

function frames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll('iframe')];
}

function post(data: unknown, origin: string): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.overflow = '';
});

describe('overlay', () => {
  it('opens one full-view iframe for the video', () => {
    const overlay = createOverlay(document, playerUrl, ORIGIN);

    overlay.open('abc');

    const [frame] = frames();
    expect(frames()).toHaveLength(1);
    expect(frame?.src).toBe(`${ORIGIN}/player.html?videoId=abc`);
    expect(frame?.getAttribute('allow')).toBe('autoplay; fullscreen');
    expect([frame?.style.position, frame?.style.width, frame?.style.height]).toEqual(['fixed', '100vw', '100vh']);
    expect(overlay.isOpen()).toBe(true);
  });

  it('replaces the frame when opened again', () => {
    const overlay = createOverlay(document, playerUrl, ORIGIN);

    overlay.open('abc');
    overlay.open('def');

    expect(frames().map((frame) => frame.src)).toEqual([`${ORIGIN}/player.html?videoId=def`]);
  });

  it('closes on a close message from the extension origin', () => {
    const overlay = createOverlay(document, playerUrl, ORIGIN);
    overlay.open('abc');

    post(CLOSE_MESSAGE, ORIGIN);

    expect(frames()).toHaveLength(0);
    expect(overlay.isOpen()).toBe(false);
  });

  it.each([
    ['another origin', { type: 'outside:close' }, 'https://www.airbnb.com'],
    ['another message', { type: 'something-else' }, ORIGIN],
    ['a message that is not an object', 'outside:close', ORIGIN],
  ])('ignores %s', (_name, data, origin) => {
    const overlay = createOverlay(document, playerUrl, ORIGIN);
    overlay.open('abc');

    post(data, origin);

    expect(overlay.isOpen()).toBe(true);
  });

  it('stops the page scrolling while open and gives it back exactly as it was', () => {
    document.documentElement.style.overflow = 'scroll';
    const overlay = createOverlay(document, playerUrl, ORIGIN);

    overlay.open('abc');
    expect(document.documentElement.style.overflow).toBe('hidden');
    overlay.close();

    expect(document.documentElement.style.overflow).toBe('scroll');
    expect(frames()).toHaveLength(0);
  });

  it('closing twice, or a late close message, is harmless', () => {
    const overlay = createOverlay(document, playerUrl, ORIGIN);
    overlay.open('abc');

    overlay.close();
    overlay.close();
    post(CLOSE_MESSAGE, ORIGIN);

    expect(overlay.isOpen()).toBe(false);
  });
});

describe('playerParams', () => {
  it('reads the video id', () => {
    expect(playerParams('?videoId=abcdef0123456789')).toEqual({ videoId: 'abcdef0123456789', sample: false });
  });

  it('recognises the sample video', () => {
    expect(playerParams('?sample=1')).toEqual({ videoId: null, sample: true });
  });

  it.each(['', '?videoId=../../etc', '?videoId=ABC'])('rejects %j', (search) => {
    expect(playerParams(search)).toEqual({ videoId: null, sample: false });
  });
});

describe('manifestFrom', () => {
  it('takes the manifest out of a ready status', () => {
    const reply = { success: true, data: { status: 'ready', stage: 'Ready', progress: 1, manifest: sample }, error: null };
    expect(manifestFrom(reply)?.id).toBe('sample0000000000');
  });

  it.each([
    ['a video that is still building', { success: true, data: { status: 'gathering', stage: 'x', progress: 0.2 }, error: null }],
    ['a failure', { success: false, data: null, error: 'Not found' }],
    ['a manifest that does not match the schema', { success: true, data: { status: 'ready', manifest: { id: 'x' } }, error: null }],
    ['nothing', undefined],
  ])('is null for %s', (_name, reply) => {
    expect(manifestFrom(reply)).toBeNull();
  });
});
