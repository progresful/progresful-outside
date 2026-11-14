import { describe, expect, it } from 'vitest';
import { FPS, MAX_FRAMES, MIN_FRAMES, sceneTimings, silentTimings, totalFrames } from '../src/pipeline/timing';
import type { Alignment } from '../src/pipeline/voice';

/** Every character, newlines included, takes `per` seconds. */
function align(text: string, per = 0.05): Alignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * per),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * per),
  };
}

/** Twenty-five words, so that at 0.05 s per character the clip runs past the 300-frame floor. */
const longLine = Array(25).fill('wonderful').join(' ');

describe('sceneTimings', () => {
  it('uses the video constants', () => {
    expect([FPS, MIN_FRAMES, MAX_FRAMES]).toEqual([30, 300, 900]);
  });

  it('gives contiguous scenes starting at frame 0', () => {
    const lines = ['Step outside in Lisbon.', 'Food first.'];
    const timings = sceneTimings(lines, align(lines.join('\n')));

    expect(timings[0]?.startFrame).toBe(0);
    expect(timings[1]?.startFrame).toBe((timings[0]?.startFrame ?? 0) + (timings[0]?.durationInFrames ?? 0));
  });

  it('cuts to the next scene when its line starts, never later', () => {
    const lines = ['Step outside in Lisbon.', 'Food first.'];
    const timings = sceneTimings(lines, align(lines.join('\n')));

    // Line 2 starts at character 24 → 1.2 s → frame 36.
    expect(timings[1]?.startFrame).toBe(36);
  });

  it('holds a scene 0.25 s after its line when the next line starts later', () => {
    const lines = ['One.', 'Two.'];
    const alignment: Alignment = {
      characters: [...'One.\nTwo.'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 2.0, 2.1, 2.2, 2.3],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 2.0, 2.1, 2.2, 2.3, 2.4],
    };

    // Line 1 ends at 0.4 s; +0.25 s → 0.65 s → frame 20 (rounded from 19.5).
    expect(sceneTimings(lines, alignment)[1]?.startFrame).toBe(20);
  });

  it('times each caption word from its own characters', () => {
    const lines = ['Step outside in Lisbon.', 'Food first.'];
    const [first, second] = sceneTimings(lines, align(lines.join('\n')));

    expect(first?.captions.map((word) => word.text)).toEqual(['Step', 'outside', 'in', 'Lisbon.']);
    expect(first?.captions[0]).toEqual({ text: 'Step', startSec: 0, endSec: 0.2 });
    expect(second?.captions[0]?.text).toBe('Food');
    expect(second?.captions[0]?.startSec).toBeCloseTo(1.2);
  });

  it('keeps a 0.75 s tail on the last scene', () => {
    const lines = [longLine, longLine];
    const text = lines.join('\n');
    const timings = sceneTimings(lines, align(text));

    expect(totalFrames(timings)).toBe(Math.round((text.length * 0.05 + 0.75) * 30));
  });

  it('extends a short video to 300 frames', () => {
    const timings = sceneTimings(['Hi.'], align('Hi.'));

    expect(totalFrames(timings)).toBe(300);
    expect(timings).toHaveLength(1);
  });

  it('copes with an alignment whose length differs from the text', () => {
    const lines = ['Step outside.', 'Food first.'];
    const timings = sceneTimings(lines, align(`${lines.join('\n')} extra`));

    expect(timings).toHaveLength(2);
    expect(timings[1]?.startFrame).toBeGreaterThan(0);
  });

  it('returns nothing for no lines', () => {
    expect(sceneTimings([], align(''))).toEqual([]);
  });
});

describe('silentTimings', () => {
  it('paces speech at 2.5 words per second', () => {
    const [scene] = silentTimings(['one two three four five']);

    expect(scene?.captions).toHaveLength(5);
    expect(scene?.captions[0]).toEqual({ text: 'one', startSec: 0, endSec: 0.4 });
    expect(scene?.captions[4]?.endSec).toBeCloseTo(2);
  });

  it('pads 0.25 s between scenes', () => {
    const timings = silentTimings(['one two three four five', 'six seven eight nine ten']);

    // 2 s of speech + 0.25 s → 2.25 s → frame 68 (rounded from 67.5).
    expect(timings[1]?.startFrame).toBe(68);
    expect(timings[1]?.captions[0]?.startSec).toBeCloseTo(2.25);
  });

  it('respects the 300-frame floor', () => {
    expect(totalFrames(silentTimings(['one two three four five']))).toBe(300);
  });
});
