import type { CSSProperties } from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Badge } from '../../../extension/src/badge/Badge';
import { COLOR, FONT } from '../theme';
import { Heading } from '../ui/Heading';
import { rise } from '../ui/motion';

/** The popup's twelve interests, by the names it shows. */
const INTERESTS = ['Food', 'Nightlife', 'Museums', 'History', 'Nature', 'Beaches', 'Adventure', 'Family', 'Wellness', 'Shopping', 'Live music', 'Hidden gems'] as const;
/** The ones picked in the film, and the frame at which each is pressed. */
const PICKS: ReadonlyArray<{ name: (typeof INTERESTS)[number]; at: number }> = [
  { name: 'Food', at: 24 },
  { name: 'Adventure', at: 40 },
  { name: 'Nature', at: 56 },
  { name: 'Live music', at: 72 },
];
const REBUILD_AT = 86;
const REBUILT_AT = 122;
const noop = (): void => undefined;

const chip: CSSProperties = {
  height: 76,
  padding: '0 34px',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 38,
  border: `2px solid ${COLOR.line}`,
  fontFamily: FONT.body,
  fontSize: 30,
  fontWeight: 500,
};

/** The interests being picked, and the badge building the video again for them. */
export function Interests() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const picked = PICKS.filter((pick) => frame >= pick.at);
  const badgeIn = spring({ frame: frame - REBUILD_AT, fps, config: { damping: 15, stiffness: 150 } });

  return (
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <style>{`.spin { transform-origin: 20px 20px; transform: rotate(${(frame * 12) % 360}deg); }`}</style>
      <div style={{ position: 'absolute', left: 130, top: 300, width: 700 }}>
        <Heading eyebrow="Your interests">
          Tell it what
          <br />
          you like.
        </Heading>
      </div>

      <div style={{ position: 'absolute', left: 880, top: 250, width: 920 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          {INTERESTS.map((name, index) => {
            const pick = PICKS.find((entry) => entry.name === name);
            const on = pick !== undefined && frame >= pick.at;
            const press = pick ? spring({ frame: frame - pick.at, fps, config: { damping: 11, stiffness: 220 } }) : 0;
            return (
              <span
                key={name}
                style={{
                  ...chip,
                  ...rise(frame, 8 + index * 2, 18, 16),
                  background: on ? COLOR.accent : COLOR.paper,
                  borderColor: on ? COLOR.accent : COLOR.line,
                  color: on ? '#FFFFFF' : COLOR.ink,
                  transform: `scale(${on ? 0.94 + press * 0.06 : 1})`,
                }}
              >
                {name}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 30, fontFamily: FONT.body, fontSize: 24, color: COLOR.muted, ...rise(frame, 30, 10) }}>
          {picked.length} of 5 picked
        </div>

        {frame >= REBUILD_AT ? (
          <div style={{ marginTop: 44, transformOrigin: 'left center', transform: `scale(${1.5 * badgeIn})`, opacity: Math.min(badgeIn * 1.4, 1), fontFamily: FONT.body, fontSize: 14, lineHeight: 1.2 }}>
            <Badge state={frame >= REBUILT_AT ? { kind: 'ready', videoId: 'film' } : { kind: 'generating', stage: frame < REBUILD_AT + 18 ? 'Finding food spots' : 'Finding live music spots' }} onPlay={noop} onRetry={noop} />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
