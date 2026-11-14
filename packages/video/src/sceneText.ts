import type { Scene, VideoManifest } from '@outside/shared';
import { asOfLabel } from './format';
import { isOpenNow } from './openNow';

export interface SceneText {
  title: string;
  subtitle?: string;
  items: Array<{ title: string; detail: string }>;
}

const OPEN_NOW = 'Open now';

/**
 * The words a scene shows, with the two things only known at play time filled in: whether an
 * activity's place is open right now, and the outro's "as of" line.
 */
export function sceneText(scene: Scene, manifest: VideoManifest, now: Date, timeZone?: string): SceneText {
  const base: SceneText = { title: scene.title, subtitle: scene.subtitle, items: scene.items ?? [] };
  if (scene.type === 'outro') {
    return { ...base, subtitle: asOfLabel(manifest.oldestFetchedAt, timeZone) || undefined };
  }
  if (scene.type === 'activity' && scene.place && isOpenNow(scene.place.hours, scene.place.timezone, now)) {
    return { ...base, subtitle: scene.subtitle ? `${scene.subtitle} · ${OPEN_NOW}` : OPEN_NOW };
  }
  return base;
}
