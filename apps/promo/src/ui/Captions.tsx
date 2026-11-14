import type { CSSProperties } from 'react';
import { useCurrentFrame } from 'remotion';
import { FONT } from '../theme';
import { captionChunks, chunkAt, type Cue } from '../timeline';
import { between, progressThrough } from './motion';

const bar: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 56,
  display: 'flex',
  justifyContent: 'center',
};

const pill: CSSProperties = {
  maxWidth: 1400,
  padding: '14px 28px',
  borderRadius: 16,
  background: 'rgba(14, 18, 16, 0.86)',
  color: '#FFFFFF',
  fontFamily: FONT.body,
  fontSize: 34,
  fontWeight: 500,
  lineHeight: 1.25,
  textAlign: 'center',
};

interface CaptionsProps {
  cues: readonly Cue[];
}

/** The narrator's words along the bottom, a short piece at a time, in step with her. */
export function Captions({ cues }: CaptionsProps) {
  const frame = useCurrentFrame();
  const cue = cues.find((entry) => frame >= entry.from && frame < entry.from + entry.durationInFrames + 6);
  if (!cue) {
    return null;
  }
  const text = chunkAt(captionChunks(cue.text), progressThrough(frame, cue.from, cue.durationInFrames));
  const opacity = Math.min(between(frame, cue.from, cue.from + 5), between(frame, cue.from + cue.durationInFrames, cue.from + cue.durationInFrames + 6, 1, 0));
  return (
    <div style={{ ...bar, opacity }}>
      <span style={pill}>{text}</span>
    </div>
  );
}
