import { INTEREST_IDS, MAX_INTERESTS, type InterestId } from '@outside/shared';

export interface Settings {
  interests: InterestId[];
  sites: { airbnb: boolean; booking: boolean };
  serverUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  interests: [],
  sites: { airbnb: true, booking: true },
  serverUrl: 'http://localhost:8787',
};

/** The part of `browser.storage.sync` the settings need. Injected so the store is testable. */
export interface KeyValueArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface SettingsStore {
  get(): Promise<Settings>;
  /** Merges the patch into the stored settings and returns the result. */
  save(patch: Partial<Settings>): Promise<Settings>;
}

const KEYS = ['interests', 'sites', 'serverUrl'];

function isInterest(value: unknown): value is InterestId {
  return typeof value === 'string' && (INTEREST_IDS as readonly string[]).includes(value);
}

function cleanInterests(raw: unknown): InterestId[] {
  const valid = Array.isArray(raw) ? raw.filter(isInterest) : [];
  return [...new Set(valid)].slice(0, MAX_INTERESTS);
}

function cleanSites(raw: unknown): Settings['sites'] {
  const stored = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const flag = (name: keyof Settings['sites']): boolean =>
    typeof stored[name] === 'boolean' ? (stored[name] as boolean) : DEFAULT_SETTINGS.sites[name];
  return { airbnb: flag('airbnb'), booking: flag('booking') };
}

/** Only http(s) origins are accepted; anything else falls back to the default local server. */
function cleanServerUrl(raw: unknown): string {
  if (typeof raw !== 'string') {
    return DEFAULT_SETTINGS.serverUrl;
  }
  try {
    const url = new URL(raw);
    const usable = url.protocol === 'http:' || url.protocol === 'https:';
    return usable ? raw.replace(/\/+$/, '') : DEFAULT_SETTINGS.serverUrl;
  } catch {
    // Not a URL at all: use the default rather than break every request.
    return DEFAULT_SETTINGS.serverUrl;
  }
}

/** Stored values are treated as untrusted: anything unexpected is repaired, never passed on. */
function cleanSettings(raw: Record<string, unknown>): Settings {
  return {
    interests: cleanInterests(raw.interests),
    sites: cleanSites(raw.sites),
    serverUrl: cleanServerUrl(raw.serverUrl),
  };
}

export function createSettingsStore(area: KeyValueArea): SettingsStore {
  const get = async (): Promise<Settings> => cleanSettings(await area.get(KEYS));
  return {
    get,
    async save(patch: Partial<Settings>): Promise<Settings> {
      const merged = cleanSettings({ ...(await get()), ...patch });
      await area.set({ ...merged });
      return merged;
    },
  };
}

interface StorageChangeEvents {
  addListener(listener: (changes: object, areaName: string) => void): void;
  removeListener(listener: (changes: object, areaName: string) => void): void;
}

/** Calls `onChange` with fresh settings whenever sync storage changes. Returns the unsubscribe function. */
export function watchSettings(
  events: StorageChangeEvents,
  store: SettingsStore,
  onChange: (settings: Settings) => void,
): () => void {
  const listener = (_changes: object, areaName: string): void => {
    if (areaName === 'sync') {
      void store.get().then(onChange);
    }
  };
  events.addListener(listener);
  return () => events.removeListener(listener);
}
