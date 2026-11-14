import { Easing, interpolate } from 'remotion';
import { EASE } from '../theme';

const eased = Easing.bezier(...EASE);

/** A value that goes from `from` to `to` between two frames and holds either side of them. */
export function between(frame: number, start: number, end: number, from = 0, to = 1): number {
  return interpolate(frame, [start, Math.max(end, start + 1)], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: eased,
  });
}

/** The style of something rising into place from `distance` pixels below, starting at `start`. */
export function rise(frame: number, start: number, distance = 28, frames = 22): { opacity: number; transform: string } {
  const progress = between(frame, start, start + frames);
  return { opacity: progress, transform: `translateY(${(1 - progress) * distance}px)` };
}

/** How far through a stretch of frames `frame` is, from 0 to 1. */
export function progressThrough(frame: number, from: number, durationInFrames: number): number {
  return Math.min(Math.max((frame - from) / Math.max(durationInFrames, 1), 0), 1);
}
