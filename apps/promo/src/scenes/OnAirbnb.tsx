import type { CSSProperties } from 'react';
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Badge } from '../../../extension/src/badge/Badge';
import type { BadgeState } from '../../../extension/src/badge/badgeState';
import { CAPTURE } from '../film';
import { COLOR, FONT } from '../theme';
import type { ScenePlan } from '../timeline';
import { Cursor } from '../ui/Cursor';
import { between } from '../ui/motion';

/** The browser window the listing is shown in, and the bar across its top. */
const WINDOW = { x: 100, y: 122, width: 1720, bar: 58 };
/** The screenshot shows the top of the page: everything above the host's name and photo. */
const PAGE_TOP_HEIGHT = 840;
const SCALE = WINDOW.width / CAPTURE.viewport.width;

/** Where the badge sits on the film's canvas: the place it was measured at on the real page. */
const BADGE = {
  x: WINDOW.x + CAPTURE.badge.x * SCALE,
  y: WINDOW.y + WINDOW.bar + CAPTURE.badge.y * SCALE,
  width: CAPTURE.badge.width * SCALE,
  height: CAPTURE.badge.height * SCALE,
};
const BADGE_CENTRE = { x: BADGE.x + BADGE.width / 2, y: BADGE.y + BADGE.height / 2 };

/**
 * What the badge says while a video is built, in order. These are the server's own words for
 * this listing and these interests; the film only shows them faster than the ten seconds they took.
 */
const STAGES = [
  'Reading the neighbourhood',
  'Finding ski & snowboard',
  'Finding sledding',
  'Checking live prices',
  'Writing the script',
  'Recording voiceover',
] as const;

const CLOSE_UP = 1.62;
const noop = (): void => undefined;

const windowFrame: CSSProperties = {
  position: 'absolute',
  left: WINDOW.x,
  top: WINDOW.y,
  width: WINDOW.width,
  height: WINDOW.bar + PAGE_TOP_HEIGHT * SCALE,
  overflow: 'hidden',
  borderRadius: 22,
  background: COLOR.paper,
  boxShadow: '0 60px 120px -50px rgba(17, 22, 20, 0.45), 0 0 0 1px rgba(17, 22, 20, 0.07)',
};

const addressBar: CSSProperties = {
  height: WINDOW.bar,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 22px',
  borderBottom: `1px solid ${COLOR.line}`,
  background: COLOR.paper,
};

const address: CSSProperties = {
  margin: '0 auto',
  width: 620,
  height: 36,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 18,
  background: COLOR.card,
  color: COLOR.muted,
  fontFamily: FONT.body,
  fontSize: 17,
};

interface OnAirbnbProps {
  listing: ScenePlan;
  badge: ScenePlan;
}

/** When, counted from the start of the listing scene, each thing in the two scenes happens. */
function moments(listing: ScenePlan, badge: ScenePlan) {
  const badgeStart = badge.from - listing.from;
  const readyLine = badge.cues.at(-1);
  // The badge turns ready on the word "ready", just before the line ends.
  const ready = readyLine ? readyLine.from + readyLine.durationInFrames - 10 - listing.from : badgeStart + Math.round(badge.durationInFrames * 0.7);
  const appears = badgeStart + 8;
  return { badgeStart, appears, ready, click: ready + 26, stageFrames: (ready - appears) / STAGES.length };
}

/**
 * The opening: a real Airbnb listing, the extension's badge at work on its photos, and the click
 * that plays the video. The page is a screenshot; the badge is the extension's own component,
 * drawn where it sat on that page.
 */
export function OnAirbnb({ listing, badge }: OnAirbnbProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = moments(listing, badge);

  // The camera drifts in while the listing is looked at, then goes close to the badge.
  const drift = between(frame, 0, at.badgeStart, 1, 1.035);
  const closeUp = between(frame, at.badgeStart + 4, at.badgeStart + 40);
  const zoom = drift + closeUp * (CLOSE_UP - 1.035);
  const shiftX = closeUp * 300;
  const shiftY = closeUp * -170;

  const stage = STAGES[Math.min(STAGES.length - 1, Math.max(0, Math.floor((frame - at.appears) / at.stageFrames)))] ?? STAGES[0];
  const state: BadgeState = frame >= at.ready ? { kind: 'ready', videoId: 'film' } : { kind: 'generating', stage };
  const arrive = spring({ frame: frame - at.appears, fps, config: { damping: 14, stiffness: 160 } });
  const pop = frame >= at.ready ? 1 + 0.09 * Math.sin(Math.min((frame - at.ready) / 9, 1) * Math.PI) : 1;

  const reach = between(frame, at.ready - 26, at.ready + 20);
  const cursor = { x: 1330 + (BADGE_CENTRE.x + 34 - 1330) * reach, y: 905 + (BADGE_CENTRE.y + 8 - 905) * reach };
  const click = (frame - at.click) / 14;

  return (
    <AbsoluteFill style={{ background: COLOR.card }}>
      {/* The ring on the building badge turns by the frame, as the page's own animation would by the clock. */}
      <style>{`.spin { transform-origin: 20px 20px; transform: rotate(${(frame * 12) % 360}deg); }`}</style>
      <AbsoluteFill style={{ transformOrigin: `${BADGE_CENTRE.x}px ${BADGE_CENTRE.y}px`, transform: `translate(${shiftX}px, ${shiftY}px) scale(${zoom})` }}>
        <div style={windowFrame}>
          <div style={addressBar}>
            {[0, 1, 2].map((dot) => (
              <span key={dot} style={{ width: 13, height: 13, borderRadius: '50%', background: COLOR.line }} />
            ))}
            <span style={address}>airbnb.com/rooms/39199892</span>
            <span style={{ width: 59 }} />
          </div>
          <Img src={staticFile('capture/listing-top.jpg')} style={{ display: 'block', width: WINDOW.width }} />
        </div>

        {frame >= at.appears ? (
          <div
            style={{
              position: 'absolute',
              left: BADGE.x,
              top: BADGE.y,
              transformOrigin: 'left center',
              transform: `scale(${SCALE * arrive * pop})`,
              opacity: Math.min(arrive * 1.4, 1),
              fontFamily: FONT.body,
              fontSize: 14,
              lineHeight: 1.2,
            }}
          >
            <Badge state={state} onPlay={noop} onRetry={noop} />
          </div>
        ) : null}

        {frame >= at.badgeStart ? <Cursor x={cursor.x} y={cursor.y} click={click} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
