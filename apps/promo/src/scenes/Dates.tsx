import type { CSSProperties } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { COLOR, FONT } from '../theme';
import type { ScenePlan } from '../timeline';
import { Heading } from '../ui/Heading';
import { rise } from '../ui/motion';

interface Stay {
  when: string;
  usually: string;
  toDo: ReadonlyArray<{ activity: string; place: string; drive: string }>;
}

/** Two videos the server built for the same city on 14 November 2026. */
const JANUARY: Stay = {
  when: '10 to 13 January',
  usually: 'Innsbruck, usually −8 to 4 °C',
  toDo: [
    { activity: 'Ski & snowboard', place: 'Stubai Glacier', drive: '≈ 45 min drive' },
    { activity: 'Snowshoe & winter walks', place: 'Zirbenweg', drive: '≈ 20 min drive' },
    { activity: 'Sledding', place: 'Rumer Alm', drive: '≈ 12 min drive' },
  ],
};
const JULY: Stay = {
  when: '10 to 14 July',
  usually: 'Innsbruck, usually 15 to 26 °C',
  toDo: [
    { activity: 'Swimming', place: 'Baggersee Roßau', drive: '≈ 10 min drive' },
    { activity: 'Kayak & SUP', place: 'Source to Sea', drive: '≈ 14 min drive' },
    { activity: 'Rafting & canyoning', place: 'Wiggi Rafting', drive: '≈ 50 min drive' },
  ],
};

const card: CSSProperties = {
  width: 470,
  padding: 40,
  borderRadius: 26,
  background: COLOR.card,
  fontFamily: FONT.body,
  color: COLOR.ink,
};

const pill: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '7px 18px',
  borderRadius: 999,
  background: COLOR.accent,
  color: '#FFFFFF',
  fontSize: 21,
  fontWeight: 600,
  letterSpacing: '0.02em',
};

function StayCard({ stay, start }: { stay: Stay; start: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ ...card, ...rise(frame, start, 44, 24) }}>
      <div style={{ fontFamily: FONT.title, fontWeight: 700, fontSize: 44, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{stay.when}</div>
      <div style={{ marginTop: 10, fontSize: 23, color: COLOR.muted }}>{stay.usually}</div>
      <div style={{ display: 'grid', gap: 30, marginTop: 42 }}>
        {stay.toDo.map((entry, index) => (
          <div key={entry.activity} style={{ display: 'flex', flexDirection: 'column', gap: 8, ...rise(frame, start + 10 + index * 7, 20, 18) }}>
            <span style={pill}>{entry.activity}</span>
            <span style={{ marginTop: 6, fontSize: 30, fontWeight: 600 }}>{entry.place}</span>
            <span style={{ fontSize: 23, color: COLOR.muted }}>{entry.drive}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The same city in winter and in summer: what the dates change. */
export function Dates({ scene }: { scene: ScenePlan }) {
  const cue = scene.cues[0];
  // Each card arrives as the narrator names its month: about a third and two thirds of the way through her line.
  const said = (share: number): number => (cue ? cue.from - scene.from + Math.round(cue.durationInFrames * share) : Math.round(scene.durationInFrames * share));
  return (
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <div style={{ position: 'absolute', left: 130, top: 250, width: 720 }}>
        <Heading eyebrow="Your dates">
          It knows when
          <br />
          you're going.
        </Heading>
      </div>
      <div style={{ position: 'absolute', left: 880, top: 150, display: 'flex', gap: 30 }}>
        <StayCard stay={JANUARY} start={said(0.26)} />
        <StayCard stay={JULY} start={said(0.7)} />
      </div>
    </AbsoluteFill>
  );
}
