/** The approved look: light, minimal, one accent. Shared by the badge, the popup and the player. */
export const COLOR = {
  paper: '#FFFFFF',
  ink: '#111614',
  muted: '#5B6660',
  card: '#F3F5F3',
  line: '#D5DBD6',
  track: '#DDE2DE',
  accent: '#0E6B4A',
  /** The backdrop behind the full-view video. */
  night: '#0E1210',
} as const;

export const FONT = {
  body: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  title: "'Bricolage Grotesque', Inter, system-ui, sans-serif",
} as const;

export const RADIUS = { card: 14, control: 10 } as const;
export const CONTROL_HEIGHT = 44;
