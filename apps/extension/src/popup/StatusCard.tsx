import type { CSSProperties } from 'react';
import { PlayIcon } from '../ui/icons';
import { COLOR, CONTROL_HEIGHT, FONT, RADIUS } from '../ui/tokens';
import type { CardModel } from './cardModel';

interface StatusCardProps {
  model: CardModel;
  onAction(action: 'play' | 'retry'): void;
}

const card: CSSProperties = {
  margin: '0 16px',
  minHeight: 88,
  padding: '14px 16px',
  borderRadius: RADIUS.card,
  background: COLOR.card,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const actionButton: CSSProperties = {
  height: CONTROL_HEIGHT,
  flex: 'none',
  padding: '0 18px',
  borderRadius: RADIUS.control,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
};

/** The one status card: a title, a subline, and at most one action. */
export function StatusCard({ model, onAction }: StatusCardProps) {
  const titleStyle: CSSProperties = model.welcome
    ? { fontFamily: FONT.title, fontWeight: 700, fontSize: 17, lineHeight: '22px', letterSpacing: '-0.01em' }
    : { fontSize: 15, fontWeight: 600, lineHeight: '20px' };

  return (
    <section style={card}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={titleStyle}>{model.title}</span>
        <span style={{ fontSize: 13, lineHeight: '18px', color: COLOR.muted }}>{model.subtitle}</span>
        {model.progress ? (
          <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: COLOR.track, overflow: 'hidden' }}>
            <div className="outside-progress" style={{ width: '40%', height: 6, borderRadius: 3, background: COLOR.accent }} />
          </div>
        ) : null}
      </div>
      {model.action === 'play' ? (
        <button type="button" onClick={() => onAction('play')} style={{ ...actionButton, border: 0, background: COLOR.accent, color: COLOR.paper }}>
          <PlayIcon size={14} />
          Play
        </button>
      ) : null}
      {model.action === 'retry' ? (
        <button
          type="button"
          onClick={() => onAction('retry')}
          style={{ ...actionButton, border: `1px solid ${COLOR.line}`, background: COLOR.paper, color: COLOR.ink }}
        >
          Retry
        </button>
      ) : null}
    </section>
  );
}
