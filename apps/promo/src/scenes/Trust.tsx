import type { CSSProperties } from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLOR, FONT } from '../theme';
import type { ScenePlan } from '../timeline';
import { Heading } from '../ui/Heading';
import { rise } from '../ui/motion';

const SOURCES = ['Google Maps', 'Viator', 'GetYourGuide', 'Songkick', 'Open-Meteo', 'Wikimedia Commons'] as const;
/** The facts of one scene of the video shown earlier, each as the server read it from its source. */
const FACTS = ['4.7 rating', '11,817 reviews', '≈ 45 min drive', 'from €340'] as const;

const source: CSSProperties = {
  padding: '14px 26px',
  borderRadius: 999,
  border: `2px solid ${COLOR.line}`,
  fontFamily: FONT.body,
  fontSize: 27,
  fontWeight: 500,
  color: COLOR.ink,
};

const factCard: CSSProperties = {
  marginTop: 46,
  padding: '40px 44px',
  borderRadius: 26,
  background: COLOR.night,
  color: '#FFFFFF',
  fontFamily: FONT.body,
};

function Tick({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = spring({ frame: frame - at, fps, config: { damping: 10, stiffness: 240 } });
  return (
    <svg width="34" height="34" viewBox="0 0 20 20" style={{ flex: 'none', transform: `scale(${frame >= at ? size : 0})` }}>
      <circle cx="10" cy="10" r="10" fill={COLOR.accent} />
      <path d="M5.6 10.4l2.9 2.9 5.9-6.3" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Where the facts come from, and that what the voice says is held against them. */
export function Trust({ scene }: { scene: ScenePlan }) {
  const frame = useCurrentFrame();
  const cue = scene.cues[0];
  const said = (share: number): number => (cue ? cue.from - scene.from + Math.round(cue.durationInFrames * share) : Math.round(scene.durationInFrames * share));
  // The facts are ticked off through the first sentence; the voice's own line is checked on the second.
  const firstTick = said(0.08);
  const perTick = Math.max(8, Math.round((said(0.52) - firstTick) / FACTS.length));
  const voiceChecked = said(0.82);

  return (
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <div style={{ position: 'absolute', left: 130, top: 300, width: 700 }}>
        <Heading eyebrow="Live web">
          Live,
          <br />
          and checked.
        </Heading>
      </div>

      <div style={{ position: 'absolute', left: 880, top: 196, width: 920 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {SOURCES.map((name, index) => (
            <span key={name} style={{ ...source, ...rise(frame, 10 + index * 4, 16, 16) }}>
              {name}
            </span>
          ))}
        </div>

        <div style={{ ...factCard, ...rise(frame, 30, 30, 22) }}>
          <span style={{ padding: '7px 18px', borderRadius: 999, background: COLOR.accent, fontSize: 21, fontWeight: 600, letterSpacing: '0.02em' }}>Ski &amp; snowboard</span>
          <div style={{ marginTop: 18, fontFamily: FONT.title, fontWeight: 700, fontSize: 60, letterSpacing: '-0.02em', lineHeight: 1.05 }}>Stubai Glacier</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 30px', marginTop: 32 }}>
            {FACTS.map((fact, index) => (
              <div key={fact} style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 31, fontWeight: 500 }}>
                <Tick at={firstTick + index * perTick} />
                {fact}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 34, paddingTop: 30, borderTop: '1px solid rgba(255, 255, 255, 0.18)', fontSize: 29, color: '#E3E7E4' }}>
            <Tick at={voiceChecked} />
            <span>
              The voice: “…about <b style={{ color: '#FFFFFF' }}>45 minutes</b> by car.”
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
