import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { isEnvelope } from '../../src/apiClient';
import { settingsStore } from '../../src/browserSettings';
import { BADGE_GET, BADGE_RETRY, PLAYER_OPEN, isPageSnapshot, type ContentMessage } from '../../src/contentMessages';
import type { Message } from '../../src/messages';
import { Popup, type PopupEnv } from '../../src/popup/Popup';

/** Sends a message to the content script of the tab the popup was opened on. */
async function sendToTab(message: ContentMessage): Promise<unknown> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, message);
}

const HEALTH: Message = { type: 'server:health' };

const env: PopupEnv = {
  store: settingsStore,
  async getSnapshot() {
    try {
      const reply = await sendToTab(BADGE_GET);
      return isPageSnapshot(reply) ? reply : null;
    } catch {
      // No content script in this tab: it is simply not one of our sites.
      return null;
    }
  },
  async isServerUp() {
    const reply: unknown = await browser.runtime.sendMessage(HEALTH);
    return isEnvelope(reply) && reply.success;
  },
  play() {
    void sendToTab(PLAYER_OPEN)
      .catch(() => undefined)
      .finally(() => window.close());
  },
  retryBuild() {
    void sendToTab(BADGE_RETRY).catch(() => undefined);
  },
};

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Popup env={env} />);
}
