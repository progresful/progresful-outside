import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

function Stroke({ size = 20, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Stroke>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 4l-6 6 6 6" />
    </Stroke>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3 6h8M15 6h2M3 14h2M9 14h8" />
      <circle cx="13" cy="6" r="2" />
      <circle cx="7" cy="14" r="2" />
    </Stroke>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
    </Stroke>
  );
}

export function PlayIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3v14l12-7L5 3z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4" y="3" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="12" y="3" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

export function VolumeIcon({ size = 20, muted = false }: IconProps & { muted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 8v4h3l4 3.5v-11L6 8H3z" fill="currentColor" />
      {muted ? (
        <path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** The mark: a ring with something just outside it. */
export function OutsideMark({ accent, ink }: { accent: string; ink: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="13.5" r="7" stroke={ink} strokeWidth="2" />
      <circle cx="19.5" cy="4.5" r="2.5" fill={accent} />
    </svg>
  );
}
