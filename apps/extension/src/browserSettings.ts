import { browser } from 'wxt/browser';
import { createSettingsStore, watchSettings, type KeyValueArea, type Settings, type SettingsStore } from './storage';

const syncArea: KeyValueArea = {
  get: (keys) => browser.storage.sync.get(keys),
  set: (items) => browser.storage.sync.set(items),
};

/** The settings store backed by the browser's synced storage. */
export const settingsStore: SettingsStore = createSettingsStore(syncArea);

export function onSettingsChanged(onChange: (settings: Settings) => void): () => void {
  return watchSettings(browser.storage.onChanged, settingsStore, onChange);
}
