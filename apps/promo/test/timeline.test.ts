import { describe, expect, it } from 'vitest';
import { SCENE_ORDER, VIDEO_SCENE_FRAMES, captionChunks, chunkAt, estimateSeconds, narrated, planFilm, type Line } from '../src/timeline';

const FPS = 30;
const voiced = (id: string, scene: Line['scene'], text: string, durationSec: number): Line => ({ id, scene, text, durationSec, file: `vo/${id}.mp3` });
const unvoiced = (id: string, scene: Line['scene'], text: string): Line => ({ id, scene, text });

describe('estimateSeconds', () => {
  it("reckons a line by its length, at the narrator's measured pace", () => {
    // Her first line, 52 characters, took 3.58 s.
    expect(estimateSeconds("You've found a place to stay. The photos look great.")).toBeCloseTo(3.58, 1);
    expect(estimateSeconds('a'.repeat(145))).toBeCloseTo(10, 1);
  });

  it('never calls a line shorter than a second', () => {
    expect(estimateSeconds('Hi.')).toBe(1);
  });
});

describe('planFilm', () => {
  const lines: Line[] = [
    voiced('open-1', 'listing', "You've found a place to stay. The photos look great.", 3.5),
    unvoiced('open-2', 'listing', 'But a listing only shows you the room.'),
    unvoiced('badge-1', 'badge', 'Outside shows you the rest.'),
    voiced('close', 'close', 'Outside.', 1.2),
  ];
  const plan = planFilm(lines, FPS);
  const scene = (id: Line['scene']) => plan.scenes.find((entry) => entry.id === id)!;

  it("puts the scenes one after another in the film's order, with no gap", () => {
    expect(plan.scenes.map((entry) => entry.id)).toEqual(['listing', 'badge', 'video', 'dates', 'interests', 'trust', 'close']);
    expect(SCENE_ORDER).toEqual(plan.scenes.map((entry) => entry.id));
    expect(plan.scenes[0]?.from).toBe(0);
    plan.scenes.slice(1).forEach((entry, index) => {
      const before = plan.scenes[index]!;
      expect(entry.from).toBe(before.from + before.durationInFrames);
    });
    const last = plan.scenes.at(-1)!;
    expect(plan.durationInFrames).toBe(last.from + last.durationInFrames);
  });

  it('times a voiced line by its recording and an unvoiced one by its length', () => {
    const [first, second] = scene('listing').cues;

    expect(first?.durationInFrames).toBe(Math.round(3.5 * FPS));
    expect(second?.durationInFrames).toBe(Math.round(estimateSeconds('But a listing only shows you the room.') * FPS));
  });

  it('carries the recording of a voiced line, and none for a line that has no voice yet', () => {
    const [first, second] = scene('listing').cues;

    expect(first?.file).toBe('vo/open-1.mp3');
    expect(second).not.toHaveProperty('file');
  });

  it('plays the lines of a scene in order, with a breath before the first and between them', () => {
    const [first, second] = scene('listing').cues;

    expect(first!.from).toBeGreaterThan(scene('listing').from);
    expect(second!.from).toBeGreaterThan(first!.from + first!.durationInFrames);
  });

  it('keeps every line inside its own scene, with a moment left after the last word', () => {
    for (const entry of plan.scenes) {
      for (const cue of entry.cues) {
        expect(cue.from).toBeGreaterThanOrEqual(entry.from);
        expect(cue.from + cue.durationInFrames).toBeLessThan(entry.from + entry.durationInFrames);
      }
    }
  });

  it('gives a scene with few or no words the time its pictures still need', () => {
    expect(scene('dates').cues).toEqual([]);
    expect(scene('dates').durationInFrames).toBeGreaterThanOrEqual(4 * FPS);
    expect(scene('close').durationInFrames).toBeGreaterThanOrEqual(4 * FPS);
  });

  it('plays the product video for exactly its clip, whatever is said elsewhere', () => {
    expect(scene('video').durationInFrames).toBe(VIDEO_SCENE_FRAMES);
    expect(scene('video').cues).toEqual([]);
  });

  it('grows a scene with what is said in it', () => {
    const longer = planFilm([...lines, unvoiced('dates', 'dates', 'x'.repeat(290))], FPS);

    expect(longer.scenes.find((entry) => entry.id === 'dates')!.durationInFrames).toBeGreaterThan(20 * FPS);
    expect(longer.durationInFrames).toBeGreaterThan(plan.durationInFrames);
  });
});

describe('captionChunks', () => {
  it('leaves a short line whole', () => {
    expect(captionChunks('But a listing only shows you the room.')).toEqual(['But a listing only shows you the room.']);
  });

  it('breaks a long line where the voice pauses, into pieces that fit on one caption', () => {
    const chunks = captionChunks("Outside shows you the rest. It reads the live web around the address: things to do, today's prices, the weather for your dates.");

    expect(chunks).toEqual(['Outside shows you the rest.', 'It reads the live web around the address:', "things to do, today's prices, the weather for your dates."]);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(64);
    }
  });

  it('breaks a sentence with no pause in it between words rather than leave it too long', () => {
    const chunks = captionChunks('Every rating every price every minute of the drive comes from a live source and nowhere else at all');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toBe('Every rating every price every minute of the drive comes from a live source and nowhere else at all');
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('chunkAt', () => {
  const chunks = ['Outside shows you the rest.', 'It reads the live web around the address:', "things to do, today's prices, the weather for your dates."];

  it('shows each piece for a share of the time that matches its length', () => {
    expect(chunkAt(chunks, 0)).toBe(chunks[0]);
    expect(chunkAt(chunks, 0.2)).toBe(chunks[0]);
    expect(chunkAt(chunks, 0.4)).toBe(chunks[1]);
    expect(chunkAt(chunks, 0.9)).toBe(chunks[2]);
  });

  it('stays on the last piece at the very end, and on the first before the start', () => {
    expect(chunkAt(chunks, 1)).toBe(chunks[2]);
    expect(chunkAt(chunks, 1.4)).toBe(chunks[2]);
    expect(chunkAt(chunks, -0.2)).toBe(chunks[0]);
    expect(chunkAt([], 0.5)).toBe('');
  });
});

describe('narrated', () => {
  const first = voiced('open-1', 'listing', 'You have found a place to stay.', 3.5);
  const second = voiced('open-2', 'listing', 'But a listing only shows you the room.', 2.6);
  const silent = unvoiced('close', 'close', 'Outside.');

  it('lets the narrator speak when every line has been recorded', () => {
    expect(narrated([first, second])).toEqual([first, second]);
  });

  it('keeps her silent throughout while any line is still missing: one spoken line and then none sounds broken', () => {
    const lines = narrated([first, silent, second]);

    expect(lines.map((line) => line.file)).toEqual([undefined, undefined, undefined]);
    expect(lines.every((line) => !('file' in line))).toBe(true);
  });

  it('still times a recorded line by its recording, so the cut does not change when the voice comes in', () => {
    expect(narrated([first, silent]).map((line) => line.durationSec)).toEqual([3.5, undefined]);
  });
});

