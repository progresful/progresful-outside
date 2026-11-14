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

export interface WindowLimiterOptions {
  /** How many calls may start within any one window. */
  max: number;
  windowMs: number;
  now?: () => number;
}

/**
 * A sliding-window allowance: at most `max` starts in any `windowMs`. Callers beyond it wait,
 * in arrival order, until the oldest start has left the window. Resolves when the caller may start.
 */
export function createWindowLimiter(options: WindowLimiterOptions): () => Promise<void> {
  const now = options.now ?? Date.now;
  let starts: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  const takeSlot = async (): Promise<void> => {
    for (;;) {
      const time = now();
      starts = starts.filter((start) => time - start < options.windowMs);
      if (starts.length < options.max) {
        starts = [...starts, time];
        return;
      }
      const oldest = starts[0] ?? time;
      await new Promise<void>((resolve) => setTimeout(resolve, oldest + options.windowMs - time));
    }
  };

  return (): Promise<void> => {
    const turn = queue.then(takeSlot);
    queue = turn;
    return turn;
  };
}
