import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowLimiter } from '../src/contextdev/limiter';

afterEach(() => {
  vi.useRealTimers();
});

describe('createWindowLimiter', () => {
  it('lets the allowance through at once and makes the rest wait for the window', async () => {
    vi.useFakeTimers();
    const acquire = createWindowLimiter({ max: 2, windowMs: 1_000 });
    const started: number[] = [];
    const run = (id: number): Promise<void> => acquire().then(() => void started.push(id));

    const all = Promise.all([run(1), run(2), run(3), run(4)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(999);
    expect(started).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(2);
    await all;
    expect(started).toEqual([1, 2, 3, 4]);
  });

  it('frees a slot as soon as the oldest start leaves the window', async () => {
    vi.useFakeTimers();
    const acquire = createWindowLimiter({ max: 1, windowMs: 1_000 });
    await acquire();
    await vi.advanceTimersByTimeAsync(600);

    let second = false;
    void acquire().then(() => {
      second = true;
    });
    await vi.advanceTimersByTimeAsync(399);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(second).toBe(true);
  });
});
