import type { VideoManifest } from '@outside/shared';
import { AbsoluteFill, Audio, Sequence } from 'remotion';
import { resolveMedia } from './format';
import { SceneView } from './scenes/SceneView';

/** A type alias, not an interface: Remotion's Player needs props assignable to Record<string, unknown>. */
export type OutsideVideoProps = {
  manifest: VideoManifest;
  /** Origin of the server that holds the manifest's media, e.g. http://localhost:8787. */
  mediaBase: string;
};

const BACKDROP = '#0E1210';
const BODY_FONT = 'Inter, system-ui, sans-serif';

/** The whole video: one voice track, and each scene on screen for exactly as long as its line. */
export function OutsideVideo({ manifest, mediaBase }: OutsideVideoProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: BACKDROP, fontFamily: BODY_FONT, color: '#FFFFFF' }}>
      {manifest.audioUrl ? <Audio src={resolveMedia(mediaBase, manifest.audioUrl)} /> : null}
      {manifest.scenes.map((scene) => (
        <Sequence key={scene.startFrame} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <SceneView scene={scene} manifest={manifest} mediaBase={mediaBase} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
