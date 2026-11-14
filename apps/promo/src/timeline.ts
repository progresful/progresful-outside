/**
 * When everything in the film happens. The narration sets the pace: a scene lasts as long as what
 * is said in it, plus the room its pictures need. A line that has been voiced is timed by its
 * recording; one that has not is timed by its length, so the film can be cut before the last
 * recording exists and tightens by itself once it does.
 */

export type SceneId = 'listing' | 'badge' | 'video' | 'dates' | 'interests' | 'trust' | 'close';

/** One thing the narrator says. `durationSec` and `file` are there once the line has been voiced. */
export interface Line {
  id: string;
  scene: SceneId;
  text: string;
  durationSec?: number;
  file?: string;
}

/** A line placed in the film: `from` is the frame, counted from the start of the film, at which it begins. */
export interface Cue {
  id: string;
  text: string;
  from: number;
  durationInFrames: number;
  file?: string;
}

export interface ScenePlan {
  id: SceneId;
  from: number;
  durationInFrames: number;
  cues: Cue[];
}

export interface FilmPlan {
  scenes: ScenePlan[];
  durationInFrames: number;
}

export const SCENE_ORDER: readonly SceneId[] = ['listing', 'badge', 'video', 'dates', 'interests', 'trust', 'close'];

/** The product's own video is shown from its start to the end of its second scene, at 30 frames a second. */
export const VIDEO_CLIP_FRAMES = 267;
/** Time for the full view to open before the clip and to close after it. */
export const VIDEO_OPEN_FRAMES = 18;
export const VIDEO_CLOSE_FRAMES = 14;
export const VIDEO_SCENE_FRAMES = VIDEO_OPEN_FRAMES + VIDEO_CLIP_FRAMES + VIDEO_CLOSE_FRAMES;

/** The narrator's pace, measured on her first recorded line: 52 characters in 3.58 seconds. */
const CHARACTERS_PER_SECOND = 14.5;
const SHORTEST_LINE_SEC = 1;
/** The breath between two lines of one scene. */
const LINE_GAP_SEC = 0.4;

/** Quiet before a scene's first word and after its last, and the least a scene may last. */
const SHAPE: Readonly<Record<Exclude<SceneId, 'video'>, { leadInSec: number; tailSec: number; minSec: number }>> = {
  listing: { leadInSec: 0.9, tailSec: 0.5, minSec: 5 },
  // The tail holds the click that follows "it's ready".
  badge: { leadInSec: 0.5, tailSec: 1.7, minSec: 8 },
  dates: { leadInSec: 0.6, tailSec: 0.8, minSec: 6 },
  interests: { leadInSec: 0.5, tailSec: 0.8, minSec: 4.5 },
  trust: { leadInSec: 0.5, tailSec: 0.9, minSec: 7 },
  close: { leadInSec: 0.5, tailSec: 1.9, minSec: 4.5 },
};

/** How long an unvoiced line will take to say, going by its length. */
export function estimateSeconds(text: string): number {
  return Math.max(SHORTEST_LINE_SEC, text.length / CHARACTERS_PER_SECOND);
}

function sceneWithLines(id: Exclude<SceneId, 'video'>, from: number, lines: readonly Line[], fps: number): ScenePlan {
  const shape = SHAPE[id];
  const frames = (seconds: number): number => Math.round(seconds * fps);
  const placed = lines.reduce<{ cues: Cue[]; next: number }>(
    (soFar, line) => {
      const durationInFrames = frames(line.durationSec ?? estimateSeconds(line.text));
      const cue: Cue = { id: line.id, text: line.text, from: soFar.next, durationInFrames, ...(line.file ? { file: line.file } : {}) };
      return { cues: [...soFar.cues, cue], next: soFar.next + durationInFrames + frames(LINE_GAP_SEC) };
    },
    { cues: [], next: from + frames(shape.leadInSec) },
  );
  const lastWord = placed.cues.at(-1);
  const spoken = lastWord ? lastWord.from + lastWord.durationInFrames - from + Math.max(1, frames(shape.tailSec)) : 0;
  return { id, from, durationInFrames: Math.max(frames(shape.minSec), spoken), cues: placed.cues };
}

/** Lays the film out, scene after scene, from the narrator's lines. */
export function planFilm(lines: readonly Line[], fps: number): FilmPlan {
  const scenes = SCENE_ORDER.reduce<ScenePlan[]>((planned, id) => {
    const before = planned.at(-1);
    const from = before ? before.from + before.durationInFrames : 0;
    const scene: ScenePlan =
      id === 'video'
        ? { id, from, durationInFrames: VIDEO_SCENE_FRAMES, cues: [] }
        : sceneWithLines(id, from, lines.filter((line) => line.scene === id), fps);
    return [...planned, scene];
  }, []);
  const last = scenes.at(-1);
  return { scenes, durationInFrames: last ? last.from + last.durationInFrames : 0 };
}

/** The longest caption that still reads at a glance. */
const CAPTION_MAX_CHARS = 64;

/** Packs pieces into as few captions as will hold them, never splitting a piece. */
function pack(pieces: readonly string[], joinWith: string): string[] {
  return pieces.reduce<string[]>((captions, piece) => {
    const current = captions.at(-1);
    return current !== undefined && current.length + joinWith.length + piece.length <= CAPTION_MAX_CHARS
      ? [...captions.slice(0, -1), `${current}${joinWith}${piece}`]
      : [...captions, piece];
  }, []);
}

/** A sentence that is too long for one caption, broken at its commas, or between words if it has none. */
function breakSentence(sentence: string): string[] {
  if (sentence.length <= CAPTION_MAX_CHARS) {
    return [sentence];
  }
  const clauses = sentence.split(/(?<=,)\s+/);
  return pack(clauses, ' ').flatMap((part) => (part.length <= CAPTION_MAX_CHARS ? [part] : pack(part.split(/\s+/), ' ')));
}

/**
 * A line as the captions show it: whole when it is short, else in pieces broken where the voice
 * pauses (after a sentence, a colon, a comma), each short enough to read at a glance.
 */
export function captionChunks(text: string): string[] {
  const sentences = text.trim().split(/(?<=[.!?:])\s+/).filter((sentence) => sentence !== '');
  return pack(sentences.flatMap(breakSentence), ' ');
}

/**
 * The piece on screen when `progress` (0 to 1) of the line has been said. Each piece stays for a
 * share of the time that matches its length.
 */
export function chunkAt(chunks: readonly string[], progress: number): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (total === 0) {
    return '';
  }
  const reached = Math.min(Math.max(progress, 0), 1) * total;
  let passed = 0;
  for (const chunk of chunks) {
    passed += chunk.length;
    if (reached < passed) {
      return chunk;
    }
  }
  return chunks.at(-1) ?? '';
}
