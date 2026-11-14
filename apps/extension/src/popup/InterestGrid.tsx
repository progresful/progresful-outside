import { INTERESTS, MAX_INTERESTS, type InterestId } from '@outside/shared';
import type { CSSProperties } from 'react';
import { COLOR, CONTROL_HEIGHT, RADIUS } from '../ui/tokens';

interface InterestGridProps {
  picked: readonly InterestId[];
  onChange(picked: InterestId[]): void;
}

const chip: CSSProperties = {
  height: CONTROL_HEIGHT,
  padding: '0 4px',
  borderRadius: RADIUS.control,
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
};

function chipStyle(selected: boolean, disabled: boolean): CSSProperties {
  return {
    ...chip,
    border: `1px solid ${selected ? COLOR.accent : COLOR.line}`,
    background: selected ? COLOR.accent : COLOR.paper,
    color: selected ? COLOR.paper : COLOR.ink,
    fontWeight: selected ? 600 : 500,
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'default' : 'pointer',
  };
}

/** Twelve preset interests, at most five picked. The counter is the only hint the limit needs. */
export function InterestGrid({ picked, onChange }: InterestGridProps) {
  const full = picked.length >= MAX_INTERESTS;
  const toggle = (id: InterestId): void =>
    onChange(picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]);

  return (
    <section style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: '20px' }}>Your interests</h2>
        <span style={{ fontSize: 13, color: COLOR.muted }}>{`${picked.length} of ${MAX_INTERESTS}`}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {INTERESTS.map((interest) => {
          const selected = picked.includes(interest.id);
          const disabled = full && !selected;
          return (
            <button
              key={interest.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => toggle(interest.id)}
              style={chipStyle(selected, disabled)}
            >
              {interest.shortLabel}
            </button>
          );
        })}
      </div>
    </section>
  );
}
