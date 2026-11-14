/** How many videos may be built: by one visitor in an hour, at the same time, and in a day by everyone. */
export interface BuildLimits {
  perVisitorPerHour: number;
  concurrent: number;
  perDay: number;
}

/**
 * `ok`: build it. `busy`: as many are being built as are built at once; ask again in a moment.
 * `spent`: the visitor's hour, or everyone's day, is used up; asking again soon will not help.
 */
export type Admission = 'ok' | 'busy' | 'spent';

export interface BuildGate {
  /** Asks to start a video for the visitor. Only an `ok` counts against anyone's allowance. */
  admit(visitor: string, now: number): Admission;
  /** Says a video that was let in has finished, whether it worked or not. */
  release(): void;
  /** How many visitors' recent videos are being kept count of. */
  remembered(): number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Every new video spends paid credit with three services, so a server anyone can reach limits
 * how many it will build. Videos that are already made are not its business: they cost nothing.
 */
export function createBuildGate(limits: BuildLimits): BuildGate {
  let starts: ReadonlyMap<string, readonly number[]> = new Map();
  let running = 0;
  let day = { startedAt: Number.NEGATIVE_INFINITY, built: 0 };

  const withinTheHour = (now: number): Map<string, readonly number[]> =>
    new Map(
      [...starts]
        .map(([visitor, times]) => [visitor, times.filter((time) => now - time < HOUR_MS)] as const)
        .filter(([, times]) => times.length > 0),
    );

  return {
    admit(visitor: string, now: number): Admission {
      const recent = withinTheHour(now);
      starts = recent;
      if (now - day.startedAt >= DAY_MS) {
        day = { startedAt: now, built: 0 };
      }
      const mine = recent.get(visitor) ?? [];
      if (mine.length >= limits.perVisitorPerHour || day.built >= limits.perDay) {
        return 'spent';
      }
      if (running >= limits.concurrent) {
        return 'busy';
      }
      starts = new Map([...recent, [visitor, [...mine, now]]]);
      running += 1;
      day = { ...day, built: day.built + 1 };
      return 'ok';
    },
    release(): void {
      running = Math.max(0, running - 1);
    },
    remembered: (): number => starts.size,
  };
}
