import type { Scene, VideoManifest } from '@outside/shared';
import type { CSSProperties } from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { activeCaption } from '../captions';
import { resolveMedia } from '../format';
import { sceneText } from '../sceneText';

export const TITLE_FONT = "'Bricolage Grotesque', Inter, system-ui, sans-serif";
const EMPTY_SCENE_COLOR = '#39413C';
const MUTED_ON_PHOTO = '#E3E7E4';
const FADE_IN_FRAMES = 10;
const ZOOM_END = 1.06;

const scrim: CSSProperties = {
  background: 'linear-gradient(to top, rgba(14, 18, 16, 0.82) 0%, rgba(14, 18, 16, 0.35) 45%, rgba(14, 18, 16, 0) 70%)',
};

const textBlock: CSSProperties = {
  position: 'absolute',
  left: 56,
  right: 56,
  bottom: 112,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const captionBar: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 36,
  display: 'flex',
  justifyContent: 'center',
};

const captionText: CSSProperties = {
  maxWidth: 1000,
  padding: '8px 18px',
  borderRadius: 10,
  background: 'rgba(14, 18, 16, 0.6)',
  fontSize: 26,
  fontWeight: 500,
  textAlign: 'center',
};

interface SceneViewProps {
  scene: Scene;
  manifest: VideoManifest;
  mediaBase: string;
}

/** One scene: a slowly zooming photo, its facts bottom-left, the spoken words along the bottom. */
export function SceneView({ scene, manifest, mediaBase }: SceneViewProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = sceneText(scene, manifest, new Date());
  const caption = activeCaption(scene.captions, (scene.startFrame + frame) / fps);
  const zoom = interpolate(frame, [0, scene.durationInFrames], [1, ZOOM_END], { extrapolateRight: 'clamp' });
  const opacity = interpolate(frame, [0, FADE_IN_FRAMES], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: EMPTY_SCENE_COLOR, overflow: 'hidden' }}>
      {scene.imageUrl ? (
        <Img
          src={resolveMedia(mediaBase, scene.imageUrl)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }}
        />
      ) : null}
      <AbsoluteFill style={scrim} />
      <div style={{ ...textBlock, opacity }}>
        <div style={{ fontFamily: TITLE_FONT, fontWeight: 700, fontSize: 60, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          {text.title}
        </div>
        {text.subtitle ? <div style={{ fontSize: 26, color: MUTED_ON_PHOTO }}>{text.subtitle}</div> : null}
        {text.items.map((item) => (
          <div key={item.title} style={{ display: 'flex', gap: 14, fontSize: 26 }}>
            <span style={{ fontWeight: 600 }}>{item.title}</span>
            {item.detail ? <span style={{ color: MUTED_ON_PHOTO }}>{item.detail}</span> : null}
          </div>
        ))}
      </div>
      {caption ? (
        <div style={captionBar}>
          <span style={captionText}>{caption}</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
