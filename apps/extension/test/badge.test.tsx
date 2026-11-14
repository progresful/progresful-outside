import { afterEach, describe, expect, it, vi } from 'vitest';
import { BADGE_ROOT_CLASS, BADGE_TAG, mountBadge } from '../src/badge/mount';

function handlers() {
  return { onPlay: vi.fn<(videoId: string) => void>(), onRetry: vi.fn<() => void>() };
}

function shadow(): ShadowRoot {
  const host = document.querySelector(BADGE_TAG);
  if (!host?.shadowRoot) {
    throw new Error('badge is not mounted');
  }
  return host.shadowRoot;
}

/** A gallery finder. jsdom lays nothing out, so the element only has a box when the test gives it one. */
function gallery(rect: DOMRect = new DOMRect(100, 100, 600, 400)): () => Element {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => rect;
  document.body.append(element);
  return () => element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('mountBadge', () => {
  it('adds one badge element with an open shadow root', () => {
    mountBadge(document, gallery(), handlers());

    expect(document.querySelectorAll(BADGE_TAG)).toHaveLength(1);
    expect(BADGE_TAG).toBe('outside-badge');
    expect(document.querySelector(BADGE_TAG)?.shadowRoot?.mode).toBe('open');
  });

  it('keeps its styles inside the shadow root', () => {
    const before = document.head.childElementCount;

    mountBadge(document, gallery(), handlers());

    expect(document.head.childElementCount).toBe(before);
    expect(shadow().querySelector('style')).not.toBeNull();
  });

  it('shows the live stage while generating', () => {
    const badge = mountBadge(document, gallery(), handlers());

    badge.render({ kind: 'generating', stage: 'Checking live prices' });

    expect(shadow().textContent).toContain('Building video');
    expect(shadow().textContent).toContain('Checking live prices');
    expect(shadow().querySelector('button')).toBeNull();
  });

  it('plays the video when the ready badge is clicked', () => {
    const h = handlers();
    const badge = mountBadge(document, gallery(), h);

    badge.render({ kind: 'ready', videoId: 'v1' });
    shadow().querySelector('button')?.click();

    expect(shadow().querySelector('button')?.textContent).toBe("What's outside");
    expect(h.onPlay).toHaveBeenCalledWith('v1');
  });

  it('keeps the old video playable while refreshing', () => {
    const h = handlers();
    const badge = mountBadge(document, gallery(), h);

    badge.render({ kind: 'refreshing', videoId: 'old' });
    shadow().querySelector('button')?.click();

    expect(shadow().textContent).toContain("What's outside");
    expect(shadow().textContent).toContain('Updating');
    expect(h.onPlay).toHaveBeenCalledWith('old');
  });

  it('offers a retry on error', () => {
    const h = handlers();
    const badge = mountBadge(document, gallery(), h);

    badge.render({ kind: 'error' });
    shadow().querySelector('button')?.click();

    expect(shadow().textContent).toContain("Couldn't build video");
    expect(shadow().querySelector('button')?.textContent).toBe('Retry');
    expect(h.onRetry).toHaveBeenCalledTimes(1);
  });

  it('says the server is not running and offers a retry when offline', () => {
    const h = handlers();
    const badge = mountBadge(document, gallery(), h);

    badge.render({ kind: 'offline' });
    shadow().querySelector('button')?.click();

    expect(shadow().textContent).toContain('Server not running');
    expect(shadow().querySelector('button')?.textContent).toBe('Retry');
    expect(h.onRetry).toHaveBeenCalledTimes(1);
    expect((document.querySelector(BADGE_TAG) as HTMLElement).style.display).toBe('block');
  });

  it('shows nothing when hidden', () => {
    const badge = mountBadge(document, gallery(), handlers());

    badge.render({ kind: 'ready', videoId: 'v1' });
    badge.render({ kind: 'hidden' });

    expect(shadow().querySelector(`.${BADGE_ROOT_CLASS}`)?.textContent).toBe('');
    expect((document.querySelector(BADGE_TAG) as HTMLElement).style.display).toBe('none');
  });

  it('sits on the bottom-left corner of the gallery', () => {
    mountBadge(document, gallery(), handlers());

    const host = document.querySelector(BADGE_TAG) as HTMLElement;
    // Gallery box: left 100, bottom 500. The badge is 56 px tall and sits 16 px inside the corner.
    expect([host.style.position, host.style.left, host.style.top]).toEqual(['absolute', '116px', '428px']);
  });

  it('sits in the corner of the window when the page has no gallery', () => {
    mountBadge(document, () => null, handlers());

    const host = document.querySelector(BADGE_TAG) as HTMLElement;
    expect([host.style.position, host.style.right, host.style.bottom]).toEqual(['fixed', '24px', '24px']);
  });

  it('waits in the corner while the gallery has no size, and moves onto it once it has', () => {
    let rect = new DOMRect(0, 0, 0, 0);
    const element = document.createElement('div');
    element.getBoundingClientRect = () => rect;
    document.body.append(element);
    mountBadge(document, () => element, handlers());
    const host = document.querySelector(BADGE_TAG) as HTMLElement;
    expect([host.style.position, host.style.right, host.style.bottom]).toEqual(['fixed', '24px', '24px']);

    rect = new DOMRect(100, 100, 600, 400);
    window.dispatchEvent(new Event('resize'));

    expect([host.style.position, host.style.left, host.style.top]).toEqual(['absolute', '116px', '428px']);
    expect([host.style.right, host.style.bottom]).toEqual(['', '']);
  });

  it('finds the gallery again when the page replaces it', () => {
    let current: Element | null = null;
    mountBadge(document, () => current, handlers());
    const host = document.querySelector(BADGE_TAG) as HTMLElement;
    expect(host.style.position).toBe('fixed');

    current = gallery()();
    window.dispatchEvent(new Event('resize'));

    expect(host.style.position).toBe('absolute');
  });

  it('removes itself completely', () => {
    const badge = mountBadge(document, gallery(), handlers());

    badge.remove();
    badge.remove();

    expect(document.querySelector(BADGE_TAG)).toBeNull();
  });
});
