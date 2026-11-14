import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { PLAN } from './film';
import { Close } from './scenes/Close';
import { Dates } from './scenes/Dates';
import { Interests } from './scenes/Interests';
import { OnAirbnb } from './scenes/OnAirbnb';
import { ProductVideo } from './scenes/ProductVideo';
import { Trust } from './scenes/Trust';
import { COLOR, FONT } from './theme';
import { VIDEO_OPEN_FRAMES, type SceneId, type ScenePlan } from './timeline';
import { Captions } from './ui/Captions';

function scene(id: SceneId): ScenePlan {
  const found = PLAN.scenes.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`The film has no scene called ${id}`);
  }
  return found;
}

/** The whole film: its scenes in order, the narrator where she has been recorded, and her words as captions throughout. */
export function Promo() {
  const listing = scene('listing');
  const badge = scene('badge');
  const video = scene('video');
  const cues = PLAN.scenes.flatMap((entry) => entry.cues);

  return (
    <AbsoluteFill style={{ background: COLOR.paper, fontFamily: FONT.body }}>
      {/* The listing stays on screen while the full view opens over it. */}
      <Sequence from={listing.from} durationInFrames={listing.durationInFrames + badge.durationInFrames + VIDEO_OPEN_FRAMES}>
        <OnAirbnb listing={listing} badge={badge} />
      </Sequence>
      <Sequence from={video.from} durationInFrames={video.durationInFrames}>
        <ProductVideo />
      </Sequence>
      <Sequence from={scene('dates').from} durationInFrames={scene('dates').durationInFrames}>
        <Dates scene={scene('dates')} />
      </Sequence>
      <Sequence from={scene('interests').from} durationInFrames={scene('interests').durationInFrames}>
        <Interests />
      </Sequence>
      <Sequence from={scene('trust').from} durationInFrames={scene('trust').durationInFrames}>
        <Trust scene={scene('trust')} />
      </Sequence>
      <Sequence from={scene('close').from} durationInFrames={scene('close').durationInFrames}>
        <Close />
      </Sequence>

      {cues.map((cue) =>
        cue.file ? (
          <Sequence key={cue.id} from={cue.from} durationInFrames={cue.durationInFrames + 15} layout="none">
            <Audio src={staticFile(cue.file)} />
          </Sequence>
        ) : null,
      )}
      <Captions cues={cues} />
    </AbsoluteFill>
  );
}
