import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountBadge } from '../src/badge/mount';
import { createPageController } from '../src/badge/pageController';
import { createListingSession } from '../src/badge/session';
import { onSettingsChanged, settingsStore } from '../src/browserSettings';
import { handleContentMessage } from '../src/contentMessages';
import { createOverlay } from '../src/overlay';
import { adapterFor } from '../src/sites';
import { LISTING_SITE_MATCHES } from '../src/sites/hosts';

// Runs on Airbnb and Booking.com. It only acts on full listing pages (the adapters decide), reads
// the listing from the page, and asks the background worker for everything else.
export default defineContentScript({
  matches: [...LISTING_SITE_MATCHES],
  main(ctx) {
    const playerPage = browser.runtime.getURL('/player.html');
    const overlay = createOverlay(
      document,
      (videoId) => `${playerPage}?videoId=${encodeURIComponent(videoId)}`,
      new URL(playerPage).origin,
    );
    const getSettings = () => settingsStore.get();
    const timers = {
      setTimeout: (fn: () => void, ms: number): unknown => window.setTimeout(fn, ms),
      clearTimeout: (handle: unknown): void => window.clearTimeout(handle as number),
    };

    const controller = createPageController({
      doc: document,
      adapterFor,
      createSession: (render) =>
        createListingSession({ send: (message) => browser.runtime.sendMessage(message), render, getSettings, ...timers }),
      mount: (gallery, handlers) => mountBadge(document, gallery, handlers),
      getSettings,
      openPlayer: (videoId) => overlay.open(videoId),
      ...timers,
    });

    controller.onUrl(window.location.href);
    ctx.addEventListener(window, 'wxt:locationchange', (event) => controller.onUrl(event.newUrl.href));
    const stopWatching = onSettingsChanged((settings) => controller.onSettings(settings));

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const reply = handleContentMessage(controller, message);
      if (reply !== undefined) {
        sendResponse(reply);
      }
    });

    ctx.onInvalidated(() => {
      controller.stop();
      overlay.close();
      stopWatching();
    });
  },
});
