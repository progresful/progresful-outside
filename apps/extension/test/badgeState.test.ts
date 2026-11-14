import type { ApiResult, VideoStatus, VideoStatusResponse } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { FIRST_STAGE, nextBadgeState, type BadgeEvent, type BadgeState } from '../src/badge/badgeState';

function status(videoId: string, value: VideoStatus, stage = 'Checking live prices'): BadgeEvent {
  const res: ApiResult<VideoStatusResponse> = { success: true, data: { status: value, stage, progress: 0.5 }, error: null };
  return { type: 'status', videoId, res };
}

function failure(videoId: string, error: string): BadgeEvent {
  return { type: 'status', videoId, res: { success: false, data: null, error } };
}

const generating: BadgeState = { kind: 'generating', stage: 'Reading the neighbourhood' };
const ready: BadgeState = { kind: 'ready', videoId: 'old' };

describe('nextBadgeState', () => {
  it.each(['queued', 'gathering', 'writing', 'voicing'] as const)('shows the live stage while %s', (value) => {
    expect(nextBadgeState(generating, status('new', value, 'Writing the script'))).toEqual({
      kind: 'generating',
      stage: 'Writing the script',
    });
  });

  it('becomes ready with the video id', () => {
    expect(nextBadgeState(generating, status('new', 'ready'))).toEqual({ kind: 'ready', videoId: 'new' });
  });

  it('shows the error state when the video failed', () => {
    expect(nextBadgeState(generating, status('new', 'failed'))).toEqual({ kind: 'error' });
  });

  it('shows the error state when the server no longer knows the video', () => {
    expect(nextBadgeState(generating, failure('new', 'Not found'))).toEqual({ kind: 'error' });
  });

  it('says so when the server is unreachable, rather than vanishing', () => {
    expect(nextBadgeState(generating, { type: 'unreachable' })).toEqual({ kind: 'offline' });
    expect(nextBadgeState(ready, failure('old', 'unreachable'))).toEqual({ kind: 'offline' });
  });

  it('starts building again when retried from offline', () => {
    expect(nextBadgeState({ kind: 'offline' }, { type: 'restart' })).toEqual({ kind: 'generating', stage: FIRST_STAGE });
  });

  it('keeps the old video playable while refreshing', () => {
    const refreshing = nextBadgeState(ready, { type: 'restart' });

    expect(refreshing).toEqual({ kind: 'refreshing', videoId: 'old' });
    expect(nextBadgeState(refreshing, status('new', 'gathering'))).toEqual({ kind: 'refreshing', videoId: 'old' });
  });

  it('switches to the new video once it is ready', () => {
    expect(nextBadgeState({ kind: 'refreshing', videoId: 'old' }, status('new', 'ready'))).toEqual({
      kind: 'ready',
      videoId: 'new',
    });
  });

  it('falls back to the old video when the refresh fails', () => {
    expect(nextBadgeState({ kind: 'refreshing', videoId: 'old' }, status('new', 'failed'))).toEqual(ready);
  });

  it.each([generating, { kind: 'error' }, { kind: 'hidden' }] as BadgeState[])(
    'restarts from %j as generating',
    (previous) => {
      expect(nextBadgeState(previous, { type: 'restart' })).toEqual({
        kind: 'generating',
        stage: 'Reading the neighbourhood',
      });
    },
  );
});
