import { VideoManifestSchema } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import sample from '../src/fixtures/sample-manifest.json';

describe('sample manifest', () => {
  const manifest = VideoManifestSchema.parse(sample);

  it('has a scene of every type', () => {
    expect(new Set(manifest.scenes.map((scene) => scene.type))).toEqual(
      new Set(['hook', 'activity', 'experiences', 'stay', 'outro']),
    );
  });

  it('has contiguous scenes that add up to the video length', () => {
    manifest.scenes.slice(1).forEach((scene, index) => {
      const previous = manifest.scenes[index];
      expect(scene.startFrame).toBe((previous?.startFrame ?? 0) + (previous?.durationInFrames ?? 0));
    });
    const last = manifest.scenes[manifest.scenes.length - 1];
    expect((last?.startFrame ?? 0) + (last?.durationInFrames ?? 0)).toBe(manifest.durationInFrames);
  });
});
