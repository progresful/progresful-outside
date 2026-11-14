import type { ApiResult, VideoStatus, VideoStatusResponse } from '@outside/shared';

export type BadgeState =
  | { kind: 'hidden' }
  | { kind: 'generating'; stage: string }
  | { kind: 'ready'; videoId: string }
  | { kind: 'refreshing'; videoId: string }
  | { kind: 'error' }
  /** The local server did not answer. Shown, not hidden: a badge that vanishes looks like a broken extension. */
  | { kind: 'offline' };

export type BadgeEvent =
  | { type: 'status'; videoId: string; res: ApiResult<VideoStatusResponse> }
  | { type: 'unreachable' }
  | { type: 'restart' };

/** What the badge says before the server has reported a stage. */
export const FIRST_STAGE = 'Reading the neighbourhood';

const UNREACHABLE = 'unreachable';
const BUILDING: readonly VideoStatus[] = ['queued', 'gathering', 'writing', 'voicing'];

export function isBuilding(status: VideoStatus): boolean {
  return BUILDING.includes(status);
}

function afterStatus(prev: BadgeState, videoId: string, res: ApiResult<VideoStatusResponse>): BadgeState {
  if (!res.success) {
    return res.error === UNREACHABLE ? { kind: 'offline' } : { kind: 'error' };
  }
  if (res.data.status === 'ready') {
    return { kind: 'ready', videoId };
  }
  if (prev.kind === 'refreshing') {
    // The previous video stays playable while the new one builds, and if the new one fails.
    return res.data.status === 'failed' ? { kind: 'ready', videoId: prev.videoId } : prev;
  }
  return res.data.status === 'failed' ? { kind: 'error' } : { kind: 'generating', stage: res.data.stage };
}

/** The badge is a pure function of what it showed before and what just happened. */
export function nextBadgeState(prev: BadgeState, event: BadgeEvent): BadgeState {
  switch (event.type) {
    case 'unreachable':
      return { kind: 'offline' };
    case 'restart':
      return prev.kind === 'ready' || prev.kind === 'refreshing'
        ? { kind: 'refreshing', videoId: prev.videoId }
        : { kind: 'generating', stage: FIRST_STAGE };
    case 'status':
      return afterStatus(prev, event.videoId, event.res);
  }
}
