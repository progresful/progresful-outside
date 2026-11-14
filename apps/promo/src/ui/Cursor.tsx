import { COLOR } from '../theme';

interface CursorProps {
  x: number;
  y: number;
  /** 0 to 1 while a click is happening: the pointer dips and a ring spreads from its tip. */
  click: number;
}

/** A pointer, drawn rather than captured, so it can move exactly where the story needs it. */
export function Cursor({ x, y, click }: CursorProps) {
  const pressed = click > 0 && click < 1;
  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      {pressed ? (
        <div
          style={{
            position: 'absolute',
            left: -40,
            top: -40,
            width: 80,
            height: 80,
            borderRadius: '50%',
            border: `4px solid ${COLOR.accent}`,
            opacity: 1 - click,
            transform: `scale(${0.3 + click * 1.1})`,
          }}
        />
      ) : null}
      <svg width="44" height="44" viewBox="0 0 24 24" style={{ position: 'absolute', left: -4, top: -3, transform: `scale(${pressed ? 0.88 : 1})`, transformOrigin: '4px 3px', filter: 'drop-shadow(0 3px 5px rgba(17, 22, 20, 0.35))' }}>
        <path d="M4 3l15 8.2-6.6 1.7-2.9 6.4L4 3z" fill={COLOR.ink} stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
