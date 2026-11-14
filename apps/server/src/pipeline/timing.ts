import { MAX_FRAMES, MIN_FRAMES, VIDEO_FPS, type CaptionWord } from '@outside/shared';
import type { Alignment } from './voice';

export const FPS = VIDEO_FPS;
export { MAX_FRAMES, MIN_FRAMES };

export interface SceneTiming {
  startFrame: number;
  durationInFrames: number;
  captions: CaptionWord[];
}

/** A scene stays up this long after its line ends, unless the next line starts sooner. */
const PAD_SEC = 0.25;
/** Extra hold on the last scene so the video does not end on the final syllable. */
const TAIL_SEC = 0.5;
const SILENT_WORDS_PER_SEC = 2.5;

interface TimedLine {
  captions: CaptionWord[];
  speechStart: number;
  speechEnd: number;
}

/** Turns per-line speech times into contiguous frame ranges, with the 300-frame floor on the total. */
function toTimings(lines: readonly TimedLine[]): SceneTiming[] {
  const lastIndex = lines.length - 1;
  const endFrames = lines.reduce<number[]>((frames, line, index) => {
    const next = lines[index + 1];
    const held = line.speechEnd + PAD_SEC;
    const endSec = next ? Math.min(held, Math.max(next.speechStart, line.speechEnd)) : held + TAIL_SEC;
    const previous = frames[index - 1] ?? 0;
    const frame = Math.max(Math.round(endSec * FPS), previous + 1);
    return [...frames, index === lastIndex ? Math.max(frame, MIN_FRAMES) : frame];
  }, []);
  return lines.map((line, index) => {
    const startFrame = endFrames[index - 1] ?? 0;
    return { startFrame, durationInFrames: (endFrames[index] ?? startFrame + 1) - startFrame, captions: line.captions };
  });
}

/** Maps a character offset in our text to the alignment, tolerating a length mismatch. */
function clock(alignment: Alignment, textLength: number): { startOf(i: number): number; endOf(i: number): number } {
  const last = alignment.characters.length - 1;
  if (last < 0) {
    throw new Error('The alignment is empty');
  }
  const scale = textLength > 1 ? last / (textLength - 1) : 0;
  const at = (i: number): number => Math.min(last, Math.max(0, Math.round(i * scale)));
  return {
    startOf: (i) => alignment.character_start_times_seconds[at(i)] ?? 0,
    endOf: (i) => alignment.character_end_times_seconds[at(i)] ?? 0,
  };
}

/**
 * Scene lengths that follow the voice. `lines` must be the exact lines that were voiced, joined
 * with newlines. Totals above MAX_FRAMES are left for the caller to shorten.
 */
export function sceneTimings(lines: readonly string[], alignment: Alignment): SceneTiming[] {
  if (lines.length === 0) {
    return [];
  }
  const time = clock(alignment, lines.join('\n').length);
  const timed = lines.reduce<{ offset: number; out: TimedLine[] }>(
    (acc, line) => {
      const captions = [...line.matchAll(/\S+/g)].map((match) => {
        const first = acc.offset + match.index;
        return { text: match[0], startSec: time.startOf(first), endSec: time.endOf(first + match[0].length - 1) };
      });
      const lastChar = acc.offset + Math.max(line.length - 1, 0);
      const timedLine = { captions, speechStart: time.startOf(acc.offset), speechEnd: time.endOf(lastChar) };
      return { offset: acc.offset + line.length + 1, out: [...acc.out, timedLine] };
    },
    { offset: 0, out: [] },
  );
  return toTimings(timed.out);
}

/** Scene lengths for a video with no voice: captions paced at 2.5 words per second. */
export function silentTimings(lines: readonly string[]): SceneTiming[] {
  const timed = lines.reduce<{ cursor: number; out: TimedLine[] }>(
    (acc, line) => {
      const words = line.match(/\S+/g) ?? [];
      const captions = words.map((text, index) => ({
        text,
        startSec: acc.cursor + index / SILENT_WORDS_PER_SEC,
        endSec: acc.cursor + (index + 1) / SILENT_WORDS_PER_SEC,
      }));
      const speechEnd = acc.cursor + words.length / SILENT_WORDS_PER_SEC;
      // The next line starts once this scene's pad is over, so the pad is always kept.
      return { cursor: speechEnd + PAD_SEC, out: [...acc.out, { captions, speechStart: acc.cursor, speechEnd }] };
    },
    { cursor: 0, out: [] },
  );
  return toTimings(timed.out);
}

export function totalFrames(timings: readonly SceneTiming[]): number {
  return timings.reduce((sum, timing) => sum + timing.durationInFrames, 0);
}
