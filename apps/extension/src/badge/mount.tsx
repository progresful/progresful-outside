import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { COLOR, FONT } from '../ui/tokens';
import { Badge, type BadgeHandlers } from './Badge';
import type { BadgeState } from './badgeState';

export type { BadgeHandlers } from './Badge';

/** The custom element that hosts the badge's shadow root. */
export const BADGE_TAG = 'outside-badge';
export const BADGE_ROOT_CLASS = 'badge-root';

const BADGE_HEIGHT = 56;
const GALLERY_INSET = 16;
const CORNER_INSET = '24px';
const TOP_LAYER = '2147483000';

const STYLE = `
:host { all: initial; }
.${BADGE_ROOT_CLASS} { font-family: ${FONT.body}; font-size: 14px; line-height: 1.2; }
.${BADGE_ROOT_CLASS} * { box-sizing: border-box; }
@keyframes outside-spin { to { transform: rotate(360deg); } }
.spin { animation: outside-spin 1s linear infinite; transform-origin: 20px 20px; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
button:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
`;

export interface BadgeView {
  render(state: BadgeState): void;
  remove(): void;
}

/**
 * Places the host over the gallery's bottom-left corner, in page coordinates, and keeps it there
 * as the page lays out. The gallery itself is never touched. With no gallery, the badge sits in
 * the viewport's bottom-right corner.
 */
function position(host: HTMLElement, gallery: Element | null, doc: Document): () => void {
  host.style.zIndex = TOP_LAYER;
  if (!gallery) {
    Object.assign(host.style, { position: 'fixed', right: CORNER_INSET, bottom: CORNER_INSET });
    return () => {};
  }
  const view = doc.defaultView;
  const place = (): void => {
    const rect = gallery.getBoundingClientRect();
    host.style.left = `${rect.left + (view?.scrollX ?? 0) + GALLERY_INSET}px`;
    host.style.top = `${rect.bottom + (view?.scrollY ?? 0) - GALLERY_INSET - BADGE_HEIGHT}px`;
  };
  host.style.position = 'absolute';
  place();
  view?.addEventListener('resize', place);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
  observer?.observe(gallery);
  observer?.observe(doc.body);
  return () => {
    view?.removeEventListener('resize', place);
    observer?.disconnect();
  };
}

/** Mounts the badge in its own shadow root, so page styles cannot leak in and ours cannot leak out. */
export function mountBadge(doc: Document, gallery: Element | null, handlers: BadgeHandlers): BadgeView {
  const host = doc.createElement(BADGE_TAG);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const mountPoint = doc.createElement('div');
  mountPoint.className = BADGE_ROOT_CLASS;
  shadow.append(style, mountPoint);
  doc.body.append(host);

  const stopPositioning = position(host, gallery, doc);
  const root = createRoot(mountPoint);
  let removed = false;

  return {
    render(state: BadgeState): void {
      if (removed) {
        return;
      }
      host.style.display = state.kind === 'hidden' ? 'none' : 'block';
      flushSync(() => root.render(<Badge state={state} {...handlers} />));
    },
    remove(): void {
      if (removed) {
        return;
      }
      removed = true;
      stopPositioning();
      root.unmount();
      host.remove();
    },
  };
}
