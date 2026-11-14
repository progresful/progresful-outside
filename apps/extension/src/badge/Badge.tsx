import type { CSSProperties, ReactNode } from 'react';
import { COLOR } from '../ui/tokens';
import type { BadgeState } from './badgeState';

export interface BadgeHandlers {
  onPlay(videoId: string): void;
  onRetry(): void;
}

interface BadgeProps extends BadgeHandlers {
  state: BadgeState;
}

const pill: CSSProperties = {
  height: 56,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 20px 0 8px',
  border: 0,
  borderRadius: 28,
  background: COLOR.paper,
  color: COLOR.ink,
  boxShadow: '0 6px 20px rgba(17, 22, 20, 0.22)',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const title: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 600, lineHeight: '18px' };
const subline: CSSProperties = { display: 'block', fontSize: 12, lineHeight: '16px', color: COLOR.muted };

function ProgressRing({ children }: { children?: ReactNode }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="20" cy="20" r="17" stroke={COLOR.track} strokeWidth="3" />
      <path className="spin" d="M20 3a17 17 0 0 1 17 17" stroke={COLOR.accent} strokeWidth="3" strokeLinecap="round" />
      {children}
    </svg>
  );
}

function PlayGlyph() {
  return (
    <>
      <circle cx="20" cy="20" r="12" fill={COLOR.accent} />
      <path d="M17 14.5v11l8.5-5.5-8.5-5.5z" fill={COLOR.paper} />
    </>
  );
}

function PlayDot() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="20" cy="20" r="20" fill={COLOR.accent} />
      <path d="M16 12.5v15l12-7.5-12-7.5z" fill={COLOR.paper} />
    </svg>
  );
}

/** The pill on the listing's gallery. Copy and layout follow the approved mocks exactly. */
export function Badge({ state, onPlay, onRetry }: BadgeProps) {
  switch (state.kind) {
    case 'hidden':
      return null;
    case 'generating':
      return (
        <div role="status" style={pill}>
          <ProgressRing />
          <span>
            <span style={title}>Building video</span>
            <span style={subline}>{state.stage}</span>
          </span>
        </div>
      );
    case 'ready':
      return (
        <button type="button" style={{ ...pill, cursor: 'pointer' }} onClick={() => onPlay(state.videoId)}>
          <PlayDot />
          <span style={{ fontSize: 15, fontWeight: 600 }}>What&apos;s outside</span>
        </button>
      );
    case 'refreshing':
      return (
        <button type="button" style={{ ...pill, cursor: 'pointer' }} onClick={() => onPlay(state.videoId)}>
          <ProgressRing>
            <PlayGlyph />
          </ProgressRing>
          <span>
            <span style={title}>What&apos;s outside</span>
            <span style={subline}>Updating</span>
          </span>
        </button>
      );
    case 'error':
      return (
        <div role="status" style={{ ...pill, gap: 4, padding: '0 6px 0 20px' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Couldn&apos;t build video</span>
          <button
            type="button"
            onClick={onRetry}
            style={{ height: 44, padding: '0 14px', border: 0, borderRadius: 22, background: 'none', color: COLOR.accent, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
  }
}
