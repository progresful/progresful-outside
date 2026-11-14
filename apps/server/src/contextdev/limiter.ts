export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** Runs at most `max` calls at once; the rest wait in arrival order. */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      // A finishing call hands its slot straight to the next waiter, so `active` stays put.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active -= 1;
      }
    }
  };
}
