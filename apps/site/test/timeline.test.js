import { describe, expect, it } from 'vitest';
import { VOICE_STALL_SEC, advance, captionAt, sceneIndexAt } from '../public/js/timeline.js';

const scenes = [
  { start: 0, end: 4, cues: [{ t: 0, text: 'Innsbruck in January brings minus 8' }, { t: 2.1, text: 'to 4 degrees and some rain.' }] },
  { start: 4, end: 9, cues: [{ t: 4.2, text: 'Try skiing and snowboarding at Stubai' }] },
  { start: 9, end: 12, cues: [] },
];

describe('sceneIndexAt', () => {
  it('is the scene that has started most recently', () => {
    expect(sceneIndexAt(scenes, 0)).toBe(0);
    expect(sceneIndexAt(scenes, 3.99)).toBe(0);
    expect(sceneIndexAt(scenes, 4)).toBe(1);
    expect(sceneIndexAt(scenes, 11.5)).toBe(2);
  });

  it('stays on the first scene before the start and on the last one after the end', () => {
    expect(sceneIndexAt(scenes, -1)).toBe(0);
    expect(sceneIndexAt(scenes, 99)).toBe(2);
  });
});

describe('captionAt', () => {
  it('is the group of words whose first word was spoken last', () => {
    expect(captionAt(scenes[0], 0)).toBe('Innsbruck in January brings minus 8');
    expect(captionAt(scenes[0], 2.09)).toBe('Innsbruck in January brings minus 8');
    expect(captionAt(scenes[0], 2.1)).toBe('to 4 degrees and some rain.');
  });

  it('is empty until the first word of the scene is spoken, and for a scene without words', () => {
    expect(captionAt(scenes[1], 4.1)).toBe('');
    expect(captionAt(scenes[2], 10)).toBe('');
  });
});

describe('advance', () => {
  const LENGTH = 24;
  const silent = { time: 5, playing: true, sound: false };
  const voiced = { time: 5, playing: true, sound: true };
  const voice = (over = {}) => ({ leading: true, time: 5.5, ended: false, stuckFor: 0, ...over });
  const quiet = voice({ leading: false, time: 0 });

  it('moves a silent video on by the time that has passed', () => {
    expect(advance(silent, 0.5, quiet, LENGTH)).toEqual({ time: 5.5, playing: true, sound: false });
  });

  it('starts a silent video over when it reaches the end', () => {
    expect(advance({ ...silent, time: 23.9 }, 0.2, quiet, LENGTH)).toEqual({ time: 0, playing: true, sound: false });
  });

  it('goes where the voice is while the voice is playing', () => {
    expect(advance(voiced, 0.5, voice({ time: 7.25 }), LENGTH)).toEqual({ time: 7.25, playing: true, sound: true });
  });

  it('waits for a voice that was asked for and has not started', () => {
    expect(advance(voiced, 0.5, voice({ leading: false, time: 0, stuckFor: 1 }), LENGTH).time).toBe(5);
  });

  it('goes on by itself after the voice has finished, then stops at the end rather than start over', () => {
    const finished = voice({ leading: false, ended: true });

    expect(advance({ ...voiced, time: 23.5 }, 0.2, finished, LENGTH)).toEqual({ time: 23.7, playing: true, sound: true });
    expect(advance({ ...voiced, time: 23.9 }, 0.2, finished, LENGTH)).toEqual({ time: LENGTH, playing: false, sound: true });
  });

  it('carries on without the voice when the voice has made no progress for a while', () => {
    expect(advance(voiced, 0.5, voice({ leading: true, time: 5, stuckFor: VOICE_STALL_SEC }), LENGTH)).toEqual({ time: 5.5, playing: true, sound: false });
    expect(advance(voiced, 0.5, voice({ leading: false, time: 0, stuckFor: VOICE_STALL_SEC + 1 }), LENGTH).sound).toBe(false);
  });

  it('leaves the state it was given untouched', () => {
    const before = { ...voiced };

    advance(voiced, 0.5, voice({ stuckFor: VOICE_STALL_SEC }), LENGTH);

    expect(voiced).toEqual(before);
  });
});

