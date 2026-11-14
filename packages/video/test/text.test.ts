import type { CaptionWord, OpeningHours, Scene, VideoManifest } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { activeCaption } from '../src/captions';
import { asOfLabel, resolveMedia } from '../src/format';
import { sceneText } from '../src/sceneText';

function words(texts: string[], startAt = 0, each = 0.4): CaptionWord[] {
  return texts.map((text, i) => ({ text, startSec: startAt + i * each, endSec: startAt + (i + 1) * each }));
}

describe('activeCaption', () => {
  const line = words(['Step', 'outside', 'in', 'Lisbon', 'and', 'look', 'around', 'the', 'old', 'town']);

  it('shows the group of words being spoken', () => {
    expect(activeCaption(line, 0.5)).toBe('Step outside in Lisbon and look');
    expect(activeCaption(line, 2.5)).toBe('around the old town');
  });

  it('shows nothing before the line starts', () => {
    expect(activeCaption(words(['Hello', 'there'], 3), 1)).toBe('');
  });

  it('keeps the last group up after the line ends', () => {
    expect(activeCaption(line, 99)).toBe('around the old town');
  });

  it('respects a custom group size', () => {
    expect(activeCaption(line, 0.5, 3)).toBe('Step outside in');
    expect(activeCaption(line, 1.3, 3)).toBe('Lisbon and look');
  });

  it('is empty for a scene with no words', () => {
    expect(activeCaption([], 1)).toBe('');
  });
});

describe('asOfLabel', () => {
  it('states when the data was fetched', () => {
    expect(asOfLabel('2026-11-14T02:14:00Z', 'UTC')).toBe('Live data as of 14 Nov, 02:14');
  });

  it('uses the given timezone', () => {
    expect(asOfLabel('2026-11-14T02:14:00Z', 'Asia/Tokyo')).toBe('Live data as of 14 Nov, 11:14');
  });

  it('is empty for an unreadable date', () => {
    expect(asOfLabel('not a date', 'UTC')).toBe('');
  });
});

describe('resolveMedia', () => {
  it('prefixes server-relative paths with the media base', () => {
    expect(resolveMedia('http://localhost:8787', '/media/abc.mp3')).toBe('http://localhost:8787/media/abc.mp3');
    expect(resolveMedia('http://localhost:8787/', '/media/abc.mp3')).toBe('http://localhost:8787/media/abc.mp3');
  });

  it('leaves absolute urls alone', () => {
    expect(resolveMedia('http://localhost:8787', 'https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
  });
});

describe('sceneText', () => {
  const always: OpeningHours = {
    0: [{ open: '00:00', close: '24:00' }],
    1: [{ open: '00:00', close: '24:00' }],
    2: [{ open: '00:00', close: '24:00' }],
    3: [{ open: '00:00', close: '24:00' }],
    4: [{ open: '00:00', close: '24:00' }],
    5: [{ open: '00:00', close: '24:00' }],
    6: [{ open: '00:00', close: '24:00' }],
  };
  const never: OpeningHours = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const manifest = { oldestFetchedAt: '2026-11-14T02:14:00Z' } as VideoManifest;
  const now = new Date('2026-11-14T12:00:00Z');
  const activity: Scene = {
    type: 'activity',
    startFrame: 0,
    durationInFrames: 90,
    title: 'Mercado da Ribeira',
    subtitle: '4.5 rating · ≈ 13 min walk',
    captions: [],
    factIds: ['place:market'],
  };

  it('adds "Open now" when the place is open at play time', () => {
    const scene = { ...activity, place: { hours: always, timezone: 'Europe/Lisbon' } };
    expect(sceneText(scene, manifest, now, 'UTC').subtitle).toBe('4.5 rating · ≈ 13 min walk · Open now');
  });

  it('says nothing about opening when the place is closed or its hours are unknown', () => {
    const closed = { ...activity, place: { hours: never, timezone: 'Europe/Lisbon' } };
    expect(sceneText(closed, manifest, now, 'UTC').subtitle).toBe('4.5 rating · ≈ 13 min walk');
    expect(sceneText(activity, manifest, now, 'UTC').subtitle).toBe('4.5 rating · ≈ 13 min walk');
  });

  it("carries the place's description and the offer beside it", () => {
    const detailed: Scene = {
      ...activity,
      note: 'Popular ski mountain with a terrain park.',
      items: [{ title: 'A guided Ski-Day', detail: 'from €340' }],
    };

    expect(sceneText(detailed, manifest, now)).toMatchObject({
      note: 'Popular ski mountain with a terrain park.',
      items: [{ title: 'A guided Ski-Day', detail: 'from €340' }],
    });
    expect(sceneText(activity, manifest, now)).not.toHaveProperty('note');
  });

  it('puts the as-of line on the outro', () => {
    const outro: Scene = { ...activity, type: 'outro', title: "What's outside", subtitle: undefined, items: [{ title: 'Google Maps', detail: '' }] };
    expect(sceneText(outro, manifest, now, 'UTC')).toEqual({
      title: "What's outside",
      subtitle: 'Live data as of 14 Nov, 02:14',
      items: [{ title: 'Google Maps', detail: '' }],
    });
  });

  it('passes other scenes through unchanged', () => {
    const hook: Scene = { ...activity, type: 'hook', title: 'Around Lisbon', subtitle: '12–16 Dec' };
    expect(sceneText(hook, manifest, now, 'UTC')).toEqual({ title: 'Around Lisbon', subtitle: '12–16 Dec', items: [] });
  });

  it('carries the activity label of a scene, and none where there is none', () => {
    const labelled: Scene = { ...activity, kicker: 'Ski & snowboard' };

    expect(sceneText(labelled, manifest, now).kicker).toBe('Ski & snowboard');
    expect(sceneText(activity, manifest, now)).not.toHaveProperty('kicker');
    expect(sceneText({ ...labelled, place: { hours: always, timezone: 'Europe/Vienna' } }, manifest, now)).toMatchObject({
      kicker: 'Ski & snowboard',
      subtitle: expect.stringContaining('Open now'),
    });
  });
});
