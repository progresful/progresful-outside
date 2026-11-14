import { scriptWithGuard, type Selection, type StoryScene } from './script';
import { scorePlace } from './select';
import { MAX_FRAMES, sceneTimings, silentTimings, totalFrames, type SceneTiming } from './timing';
import type { PipelineDeps } from './types';

/** The word budget for a second, shorter script when the first one runs past 30 seconds. */
export const TIGHT_WORD_BUDGET = 40;

export interface Voiced {
  sel: Selection;
  scenes: StoryScene[];
  timings: SceneTiming[];
  /** Null when the voice could not be recorded; the video then plays silent, with captions. */
  audio: Buffer | null;
}

async function timeLines(deps: PipelineDeps, lines: readonly string[]): Promise<Pick<Voiced, 'timings' | 'audio'>> {
  try {
    const speech = await deps.synthesize(lines);
    return { timings: sceneTimings(lines, speech.alignment), audio: speech.audio };
  } catch (error: unknown) {
    deps.onSourceError?.('voice', error);
    return { timings: silentTimings(lines), audio: null };
  }
}

function withoutWeakestPlace(sel: Selection): Selection {
  const weakest = [...sel.places].sort((a, b) => scorePlace(a) - scorePlace(b))[0];
  return weakest && sel.places.length > 1
    ? { ...sel, places: sel.places.filter((place) => place.id !== weakest.id) }
    : sel;
}

/**
 * Voices the script and makes it fit 30 seconds: as written, then with a tighter script, then
 * with the weakest activity scene dropped.
 */
export async function voiceToFit(deps: PipelineDeps, sel: Selection, scenes: StoryScene[]): Promise<Voiced> {
  const rewrite = (selection: Selection): Promise<StoryScene[]> =>
    scriptWithGuard(deps.complete, selection, TIGHT_WORD_BUDGET);
  const attempts: Array<() => Promise<Pick<Voiced, 'sel' | 'scenes'>>> = [
    async () => ({ sel, scenes }),
    async () => ({ sel, scenes: await rewrite(sel) }),
    async () => {
      const trimmed = withoutWeakestPlace(sel);
      return { sel: trimmed, scenes: await rewrite(trimmed) };
    },
  ];
  for (const attempt of attempts) {
    const candidate = await attempt();
    const timed = await timeLines(deps, candidate.scenes.map((scene) => scene.line));
    if (totalFrames(timed.timings) <= MAX_FRAMES) {
      return { ...candidate, ...timed };
    }
  }
  throw new Error('Could not fit the video into 30 seconds');
}
