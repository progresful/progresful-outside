import type { ListingContext } from '@outside/shared';
import type { SiteAdapter } from '../sites';
import type { Settings } from '../storage';
import type { BadgeState } from './badgeState';
import type { BadgeHandlers, BadgeView, GalleryFinder } from './mount';
import type { ListingSession } from './session';

/** Single-page sites render the listing after the URL changes, so extraction is retried for a while. */
export const EXTRACT_RETRY_MS = 500;
const EXTRACT_ATTEMPTS = 20;

export interface PageDeps {
  doc: Document;
  adapterFor: (url: string) => { adapter: SiteAdapter; listingId: string } | null;
  createSession: (render: (state: BadgeState) => void) => ListingSession;
  mount: (findGallery: GalleryFinder, handlers: BadgeHandlers) => BadgeView;
  getSettings: () => Promise<Settings>;
  openPlayer: (videoId: string) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** What the popup needs to know about the page. */
export interface PageSnapshot {
  onListing: boolean;
  badge: BadgeState;
  locationText?: string;
}

export interface PageController {
  /** Call on load and on every in-page navigation. */
  onUrl(url: string): void;
  onSettings(settings: Settings): void;
  /** Opens the player for the video the badge currently offers, if any. */
  playCurrent(): void;
  /** Builds the current listing's video again. */
  retry(): void;
  snapshot(): PageSnapshot;
  stop(): void;
}

interface ActiveListing {
  site: ListingContext['site'];
  listing: ListingContext;
  session: ListingSession;
  badge: BadgeView;
}

/**
 * Owns the badge for whatever listing the tab is showing. Each visit has a number; leaving a
 * listing bumps it, which cancels everything that visit still had in flight.
 */
export function createPageController(deps: PageDeps): PageController {
  let visit = 0;
  let currentUrl: string | null = null;
  let currentVisitKey: string | null = null;
  let retryTimer: unknown;
  let active: ActiveListing | null = null;
  let badgeState: BadgeState = { kind: 'hidden' };
  let interestsKey = '';

  const teardown = (): void => {
    visit += 1;
    if (retryTimer !== undefined) {
      deps.clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    active?.session.stop();
    active?.badge.remove();
    active = null;
    badgeState = { kind: 'hidden' };
  };

  /** Plays the video if the server still has it; the session starts a new build when it does not. */
  const play = (videoId: string): void => {
    const session = active?.session;
    const mine = visit;
    if (!session) {
      return;
    }
    session
      .stillReady(videoId)
      .then((ready) => {
        if (ready && mine === visit) {
          deps.openPlayer(videoId);
        }
      })
      .catch(() => undefined); // an unanswered check opens nothing; the badge already says why
  };

  const activate = (adapter: SiteAdapter, listing: ListingContext): void => {
    const badge = deps.mount(() => adapter.findGallery(deps.doc), {
      onPlay: play,
      onRetry: () => active?.session.restart(),
    });
    const session = deps.createSession((state) => {
      badgeState = state;
      badge.render(state);
    });
    active = { site: adapter.site, listing, session, badge };
    session.start(listing);
  };

  const extract = (adapter: SiteAdapter, url: string, mine: number, attemptsLeft: number): void => {
    const listing = adapter.extractListing(deps.doc, url);
    if (listing) {
      activate(adapter, listing);
      return;
    }
    if (attemptsLeft > 0) {
      retryTimer = deps.setTimeout(() => {
        retryTimer = undefined;
        if (mine === visit) {
          extract(adapter, url, mine, attemptsLeft - 1);
        }
      }, EXTRACT_RETRY_MS);
    }
  };

  const enter = async (url: string): Promise<void> => {
    teardown();
    currentUrl = url;
    const mine = visit;
    const match = deps.adapterFor(url);
    currentVisitKey = match?.adapter.visitKey(url) ?? null;
    if (!match) {
      return;
    }
    const settings = await deps.getSettings();
    if (mine !== visit) {
      return;
    }
    interestsKey = JSON.stringify(settings.interests);
    if (settings.sites[match.adapter.site]) {
      extract(match.adapter, url, mine, EXTRACT_ATTEMPTS);
    }
  };

  const onUrl = (url: string): void => {
    if (url === currentUrl) {
      return;
    }
    const visitKey = deps.adapterFor(url)?.adapter.visitKey(url) ?? null;
    if (visitKey !== null && visitKey === currentVisitKey) {
      // Same listing, same dates: a photo tour or share dialog rewrote the address. Nothing to redo.
      currentUrl = url;
      return;
    }
    // If settings cannot be read the page is simply left alone.
    enter(url).catch(teardown);
  };

  return {
    onUrl,
    onSettings(settings: Settings): void {
      const key = JSON.stringify(settings.interests);
      const interestsChanged = key !== interestsKey;
      interestsKey = key;
      if (active && !settings.sites[active.site]) {
        teardown();
      } else if (active && interestsChanged) {
        active.session.restart();
      } else if (!active && currentUrl) {
        const url = currentUrl;
        currentUrl = null;
        onUrl(url); // the site may just have been switched back on
      }
    },
    playCurrent(): void {
      if (badgeState.kind === 'ready' || badgeState.kind === 'refreshing') {
        play(badgeState.videoId);
      }
    },
    retry(): void {
      active?.session.restart();
    },
    snapshot: (): PageSnapshot => ({
      onListing: active !== null,
      badge: badgeState,
      ...(active ? { locationText: active.listing.locationText } : {}),
    }),
    stop(): void {
      teardown();
      currentUrl = null;
      currentVisitKey = null;
    },
  };
}
