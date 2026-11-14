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

function gallery(): Element {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
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

  it('shows nothing when hidden', () => {
    const badge = mountBadge(document, gallery(), handlers());

    badge.render({ kind: 'ready', videoId: 'v1' });
    badge.render({ kind: 'hidden' });

    expect(shadow().querySelector(`.${BADGE_ROOT_CLASS}`)?.textContent).toBe('');
    expect((document.querySelector(BADGE_TAG) as HTMLElement).style.display).toBe('none');
  });

  it('sits on the gallery when there is one, and in the corner when there is not', () => {
    mountBadge(document, gallery(), handlers());
    expect((document.querySelector(BADGE_TAG) as HTMLElement).style.position).toBe('absolute');
    document.body.replaceChildren();

    mountBadge(document, null, handlers());
    const host = document.querySelector(BADGE_TAG) as HTMLElement;
    expect([host.style.position, host.style.right, host.style.bottom]).toEqual(['fixed', '24px', '24px']);
  });

  it('removes itself completely', () => {
    const badge = mountBadge(document, gallery(), handlers());

    badge.remove();
    badge.remove();

    expect(document.querySelector(BADGE_TAG)).toBeNull();
  });
});
