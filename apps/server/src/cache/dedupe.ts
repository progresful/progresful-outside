export type Deduper = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/** Concurrent callers with the same key share one in-flight call. Nothing is kept once it settles. */
export function createDeduper(): Deduper {
  const inFlight = new Map<string, Promise<unknown>>();

  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    let started: Promise<T>;
    try {
      started = fn();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    const tracked = started.finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, tracked);
    return tracked;
  };
}
