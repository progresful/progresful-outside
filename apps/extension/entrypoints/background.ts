import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createApiClient } from '../src/apiClient';
import { settingsStore } from '../src/browserSettings';
import { routeMessage } from '../src/messages';

// The background worker is the extension's only network client. Content scripts ask it for
// everything, so the host page's CSP and CORS rules never come into play.
export default defineBackground(() => {
  const api = createApiClient(fetch, async () => (await settingsStore.get()).serverUrl);

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    void routeMessage(api, message).then(sendResponse);
    return true; // the response is sent asynchronously
  });
});
