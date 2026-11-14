import { INTEREST_IDS, MAX_INTERESTS, type InterestId } from '@outside/shared';

export interface Settings {
  interests: InterestId[];
  sites: { airbnb: boolean; booking: boolean };
  serverUrl: string;
}

/** The server a development build talks to: the one `pnpm dev:server` runs on this machine. */
export const LOCAL_SERVER_URL = 'http://localhost:8787';

function webAddress(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw.replace(/\/+$/, '') : undefined;
  } catch {
    // Not a URL at all.
    return undefined;
  }
}

/**
 * Where the server is until the user says otherwise: the address a release build was made for
 * (`WXT_SERVER_URL` at build time), else this machine.
 */
export function defaultServerUrl(builtFor: string | undefined): string {
  return webAddress(builtFor) ?? LOCAL_SERVER_URL;
}

export const DEFAULT_SETTINGS: Settings = {
  interests: [],
  sites: { airbnb: true, booking: true },
  serverUrl: defaultServerUrl(import.meta.env.WXT_SERVER_URL),
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

/** Only http(s) addresses are accepted; anything else falls back to the default server rather than break every request. */
function cleanServerUrl(raw: unknown): string {
  return webAddress(raw) ?? DEFAULT_SETTINGS.serverUrl;
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
  // Saves run one after another, and each writes only the keys it changed, so two quick changes
  // (a switch, then the server address) can never overwrite each other.
  let lastSave: Promise<unknown> = Promise.resolve();

  const apply = async (patch: Partial<Settings>): Promise<Settings> => {
    const merged = cleanSettings({ ...(await get()), ...patch });
    const changed = Object.fromEntries(
      (Object.keys(merged) as Array<keyof Settings>).filter((key) => key in patch).map((key) => [key, merged[key]]),
    );
    await area.set(changed);
    return merged;
  };

  return {
    get,
    save(patch: Partial<Settings>): Promise<Settings> {
      const saved = lastSave.then(() => apply(patch));
      lastSave = saved.catch(() => undefined);
      return saved;
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
