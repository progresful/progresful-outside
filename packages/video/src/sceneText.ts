import type { Scene, VideoManifest } from '@outside/shared';
import { asOfLabel } from './format';
import { isOpenNow } from './openNow';

export interface SceneText {
  /** A short label above the title: what there is to do at the place. */
  kicker?: string;
  title: string;
  subtitle?: string;
  /** What the place is like, in its source's words. */
  note?: string;
  items: Array<{ title: string; detail: string }>;
}

const OPEN_NOW = 'Open now';

/**
 * The words a scene shows, with the two things only known at play time filled in: whether an
 * activity's place is open right now, and the outro's "as of" line.
 */
export function sceneText(scene: Scene, manifest: VideoManifest, now: Date, timeZone?: string): SceneText {
  const base: SceneText = {
    ...(scene.kicker ? { kicker: scene.kicker } : {}),
    title: scene.title,
    subtitle: scene.subtitle,
    ...(scene.note ? { note: scene.note } : {}),
    items: scene.items ?? [],
  };
  if (scene.type === 'outro') {
    return { ...base, subtitle: asOfLabel(manifest.oldestFetchedAt, timeZone) || undefined };
  }
  if (scene.type === 'activity' && scene.place && isOpenNow(scene.place.hours, scene.place.timezone, now)) {
    return { ...base, subtitle: scene.subtitle ? `${scene.subtitle} · ${OPEN_NOW}` : OPEN_NOW };
  }
  return base;
}
