import { VideoManifestSchema, type VideoManifest } from '@outside/shared';
import { staticFile } from 'remotion';
import capture from './content/capture.json';
import productVideo from './content/product-video.json';
import script from './content/script.json';
import voiceover from './content/vo.json';
import { planFilm, type FilmPlan, type Line, type SceneId } from './timeline';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** The narrator's lines, each with its recording where one exists. A line without one is shown as a caption only. */
export const LINES: Line[] = script.lines.map((line): Line => {
  const voiced = voiceover.lines.find((entry) => entry.id === line.id);
  return {
    id: line.id,
    scene: line.scene as SceneId,
    text: line.text,
    ...(voiced ? { durationSec: voiced.durationSec, file: voiced.file } : {}),
  };
});

export const PLAN: FilmPlan = planFilm(LINES, FPS);

/**
 * A real video the server built, for a stay in Innsbruck on 10–13 January. Its photos are the
 * freely licensed ones the landing page uses, in place of those the server found live.
 */
export const PRODUCT_VIDEO: VideoManifest = VideoManifestSchema.parse({
  ...productVideo,
  scenes: productVideo.scenes.map((scene) => ({ ...scene, imageUrl: staticFile(scene.imageUrl) })),
});

/** Where the badge sat on the real listing page, and the size of the page it was measured on. */
export const CAPTURE = capture;
