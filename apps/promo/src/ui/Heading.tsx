import type { ReactNode } from 'react';
import { useCurrentFrame } from 'remotion';
import { COLOR, FONT } from '../theme';
import { rise } from './motion';

interface HeadingProps {
  eyebrow: string;
  children: ReactNode;
  size?: number;
}

/** A section's small green label and its large headline, arriving one after the other. */
export function Heading({ eyebrow, children, size = 104 }: HeadingProps) {
  const frame = useCurrentFrame();
  return (
    <div>
      <div style={{ ...rise(frame, 2, 18), fontFamily: FONT.body, fontSize: 24, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: COLOR.accent }}>
        {eyebrow}
      </div>
      <div style={{ ...rise(frame, 6, 34, 26), marginTop: 22, fontFamily: FONT.title, fontWeight: 700, fontSize: size, lineHeight: 0.98, letterSpacing: '-0.035em', color: COLOR.ink }}>
        {children}
      </div>
    </div>
  );
}
