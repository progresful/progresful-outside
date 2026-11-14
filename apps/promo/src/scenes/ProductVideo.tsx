import type { CSSProperties } from 'react';
import { OutsideVideo } from '@outside/video';
import { AbsoluteFill, Audio, Freeze, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { PRODUCT_VIDEO } from '../film';
import { COLOR } from '../theme';
import { VIDEO_CLIP_FRAMES, VIDEO_CLOSE_FRAMES, VIDEO_OPEN_FRAMES, VIDEO_SCENE_FRAMES } from '../timeline';
import { between } from '../ui/motion';

/** The product's video is made for a 1280 by 720 frame; the film shows it larger. */
const NATIVE = { width: 1280, height: 720 };
const SHOWN = { width: 1472, height: 828 };
const TOP = 86;
const LEFT = (1920 - SHOWN.width) / 2;

const controls: CSSProperties = {
  position: 'absolute',
  left: LEFT,
  top: TOP + SHOWN.height + 26,
  width: SHOWN.width,
  display: 'flex',
  alignItems: 'center',
  gap: 26,
  color: '#FFFFFF',
};

const closeButton: CSSProperties = {
  position: 'absolute',
  top: 34,
  right: 40,
  width: 60,
  height: 60,
  display: 'grid',
  placeItems: 'center',
  borderRadius: '50%',
  background: 'rgba(255, 255, 255, 0.12)',
  color: '#FFFFFF',
};

function Icon({ path, filled = false }: { path: string; filled?: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/**
 * The full view the badge opens: the extension's dark backdrop, and in it the video the server
 * built, playing from its start with its own narrator. This is the product speaking for itself.
 */
export function ProductVideo() {
  const frame = useCurrentFrame();
  const open = between(frame, 0, VIDEO_OPEN_FRAMES);
  const leave = between(frame, VIDEO_SCENE_FRAMES - VIDEO_CLOSE_FRAMES, VIDEO_SCENE_FRAMES);
  const played = Math.max(0, frame - VIDEO_OPEN_FRAMES) / PRODUCT_VIDEO.durationInFrames;
  // Its narrator has finished the second scene's line by the end of the clip; the sound goes before the next begins.
  const volume = (clipFrame: number): number => interpolate(clipFrame, [VIDEO_CLIP_FRAMES - 10, VIDEO_CLIP_FRAMES + 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: COLOR.night, opacity: open }} />
      <div style={{ opacity: open, transform: `scale(${0.94 + open * 0.06})`, transformOrigin: '50% 46%', position: 'absolute', inset: 0 }}>
        <div style={{ position: 'absolute', left: LEFT, top: TOP, width: SHOWN.width, height: SHOWN.height, overflow: 'hidden', borderRadius: 26, background: '#000' }}>
          <div style={{ position: 'absolute', width: NATIVE.width, height: NATIVE.height, transformOrigin: '0 0', transform: `scale(${SHOWN.width / NATIVE.width})` }}>
            {/* While the full view opens, the video waits on its first frame rather than on black. */}
            <Sequence durationInFrames={VIDEO_OPEN_FRAMES} layout="none">
              <Freeze frame={12}>
                <OutsideVideo manifest={PRODUCT_VIDEO} mediaBase="" />
              </Freeze>
            </Sequence>
            <Sequence from={VIDEO_OPEN_FRAMES} durationInFrames={VIDEO_CLIP_FRAMES + VIDEO_CLOSE_FRAMES} layout="none">
              <OutsideVideo manifest={PRODUCT_VIDEO} mediaBase="" />
              <Audio src={staticFile('demo/voice.mp3')} volume={volume} />
            </Sequence>
          </div>
        </div>

        <div style={controls}>
          <Icon path="M5.5 4h3v12h-3zM11.5 4h3v12h-3z" filled />
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255, 255, 255, 0.22)' }}>
            <div style={{ position: 'relative', width: `${played * 100}%`, height: 6, borderRadius: 3, background: '#FFFFFF' }}>
              <span style={{ position: 'absolute', right: -9, top: -6, width: 18, height: 18, borderRadius: '50%', background: '#FFFFFF' }} />
            </div>
          </div>
          <Icon path="M3 8v4h3l4 3.5v-11L6 8H3zM13 7.5a3.5 3.5 0 0 1 0 5M15 5a7 7 0 0 1 0 10" />
          <Icon path="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
        </div>
        <div style={closeButton}>
          <Icon path="M5 5l10 10M15 5L5 15" />
        </div>
      </div>
      {/* The full view closes into the white of the next scene. */}
      <AbsoluteFill style={{ background: COLOR.paper, opacity: leave }} />
    </AbsoluteFill>
  );
}
