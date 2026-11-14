import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { COLOR, FONT } from '../theme';
import { between, rise } from '../ui/motion';

function Line({ start, children }: { start: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const lift = between(frame, start, start + 30);
  return (
    <span style={{ display: 'block', overflow: 'hidden', paddingBottom: '0.14em', marginBottom: '-0.14em' }}>
      <span style={{ display: 'inline-block', transform: `translateY(${(1 - lift) * 105}%)` }}>{children}</span>
    </span>
  );
}

/** The last card: what it is called, what it does, where to get it. */
export function Close() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: COLOR.paper, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, ...rise(frame, 2, 16) }}>
        <svg width="54" height="54" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="20" fill={COLOR.accent} />
          <path d="M16 12.5v15l12-7.5-12-7.5z" fill="#FFFFFF" />
        </svg>
        <span style={{ fontFamily: FONT.title, fontWeight: 700, fontSize: 44, letterSpacing: '-0.02em', color: COLOR.ink }}>Outside</span>
      </div>

      <div style={{ marginTop: 44, fontFamily: FONT.title, fontWeight: 700, fontSize: 168, lineHeight: 0.94, letterSpacing: '-0.045em', color: COLOR.ink }}>
        <Line start={8}>
          See what's <span style={{ color: COLOR.accent }}>outside</span>
        </Line>
        <Line start={13}>before you book.</Line>
      </div>

      <div style={{ marginTop: 64, display: 'flex', alignItems: 'center', gap: 28, ...rise(frame, 34, 20) }}>
        <span style={{ height: 76, padding: '0 40px', display: 'grid', placeItems: 'center', borderRadius: 38, background: COLOR.ink, color: '#FFFFFF', fontFamily: FONT.body, fontSize: 34, fontWeight: 600 }}>
          outside.pgf.lv
        </span>
        <span style={{ fontFamily: FONT.body, fontSize: 30, color: COLOR.muted }}>Free Chrome extension for Airbnb and Booking.com</span>
      </div>
    </AbsoluteFill>
  );
}
