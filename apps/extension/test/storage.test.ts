import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, LOCAL_SERVER_URL, createSettingsStore, defaultServerUrl, watchSettings, type KeyValueArea } from '../src/storage';

function memoryArea(initial: Record<string, unknown> = {}): KeyValueArea & { data: Record<string, unknown> } {
  const area = {
    data: { ...initial },
    get: async (keys: string[]) => Object.fromEntries(keys.filter((key) => key in area.data).map((key) => [key, area.data[key]])),
    set: async (items: Record<string, unknown>) => {
      area.data = { ...area.data, ...items };
    },
  };
  return area;
}

describe('defaultServerUrl', () => {
  it('is this machine unless the build names a server', () => {
    expect(LOCAL_SERVER_URL).toBe('http://localhost:8787');
    expect(defaultServerUrl(undefined)).toBe('http://localhost:8787');
    expect(defaultServerUrl('')).toBe('http://localhost:8787');
  });

  it('is the server the build was made for', () => {
    expect(defaultServerUrl('https://outside.pgf.lv')).toBe('https://outside.pgf.lv');
    expect(defaultServerUrl('https://outside.pgf.lv/')).toBe('https://outside.pgf.lv');
  });

  it('falls back to this machine when the build names something that is not a web address', () => {
    expect(defaultServerUrl('outside.pgf.lv')).toBe('http://localhost:8787');
    expect(defaultServerUrl('ftp://outside.pgf.lv')).toBe('http://localhost:8787');
  });
});

describe('settings store', () => {
  it('returns defaults when storage is empty', async () => {
    expect(await createSettingsStore(memoryArea()).get()).toEqual({
      interests: [],
      sites: { airbnb: true, booking: true },
      serverUrl: 'http://localhost:8787',
    });
    expect(DEFAULT_SETTINGS.serverUrl).toBe('http://localhost:8787');
  });

  it('reads saved values', async () => {
    const area = memoryArea({
      interests: ['food', 'water'],
      sites: { airbnb: false, booking: true },
      serverUrl: 'http://localhost:9000/',
    });

    expect(await createSettingsStore(area).get()).toEqual({
      interests: ['food', 'water'],
      sites: { airbnb: false, booking: true },
      serverUrl: 'http://localhost:9000',
    });
  });

  it('repairs stored values it does not understand', async () => {
    const area = memoryArea({
      interests: ['food', 'golf', 'food', 'water', 'gems', 'events', 'family', 'nature'],
      sites: { airbnb: 'yes' },
      serverUrl: 'javascript:alert(1)',
    });

    expect(await createSettingsStore(area).get()).toEqual({
      interests: ['food', 'water', 'gems', 'events', 'family'],
      sites: { airbnb: true, booking: true },
      serverUrl: 'http://localhost:8787',
    });
  });

  it('saves a patch and returns the merged settings', async () => {
    const area = memoryArea({ interests: ['food'] });
    const store = createSettingsStore(area);

    const saved = await store.save({ sites: { airbnb: true, booking: false } });

    expect(saved).toEqual({ interests: ['food'], sites: { airbnb: true, booking: false }, serverUrl: 'http://localhost:8787' });
    expect(await store.get()).toEqual(saved);
  });

  it('keeps both changes when two saves overlap', async () => {
    const store = createSettingsStore(memoryArea());

    const [, second] = await Promise.all([
      store.save({ sites: { airbnb: false, booking: true } }),
      store.save({ serverUrl: 'http://localhost:9000' }),
    ]);

    const expected = { interests: [], sites: { airbnb: false, booking: true }, serverUrl: 'http://localhost:9000' };
    expect(await store.get()).toEqual(expected);
    expect(second).toEqual(expected);
  });

  it('writes only the keys that were changed', async () => {
    const area = memoryArea();
    await createSettingsStore(area).save({ interests: ['food'] });

    expect(Object.keys(area.data)).toEqual(['interests']);
  });

  it('caps saved interests at 5', async () => {
    const store = createSettingsStore(memoryArea());

    const saved = await store.save({ interests: ['food', 'water', 'gems', 'events', 'family', 'nature'] });

    expect(saved.interests).toEqual(['food', 'water', 'gems', 'events', 'family']);
  });

  it('refuses a server url that is not http or https', async () => {
    const store = createSettingsStore(memoryArea());

    expect((await store.save({ serverUrl: 'file:///etc/passwd' })).serverUrl).toBe('http://localhost:8787');
    expect((await store.save({ serverUrl: 'https://outside.example/' })).serverUrl).toBe('https://outside.example');
  });
});

describe('watchSettings', () => {
  function emitter() {
    const listeners = new Set<(changes: object, areaName: string) => void>();
    return {
      addListener: (fn: (changes: object, areaName: string) => void) => listeners.add(fn),
      removeListener: (fn: (changes: object, areaName: string) => void) => listeners.delete(fn),
      emit: (areaName: string) => listeners.forEach((fn) => fn({}, areaName)),
      size: () => listeners.size,
    };
  }

  it('reports fresh settings when sync storage changes', async () => {
    const area = memoryArea();
    const store = createSettingsStore(area);
    const events = emitter();
    const onChange = vi.fn();
    watchSettings(events, store, onChange);

    await store.save({ interests: ['nature'] });
    events.emit('sync');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    expect(onChange.mock.calls[0]?.[0].interests).toEqual(['nature']);
  });

  it('ignores other storage areas and stops when unsubscribed', async () => {
    const events = emitter();
    const onChange = vi.fn();
    const stop = watchSettings(events, createSettingsStore(memoryArea()), onChange);

    events.emit('local');
    stop();
    events.emit('sync');
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(onChange).not.toHaveBeenCalled();
    expect(events.size()).toBe(0);
  });
});
