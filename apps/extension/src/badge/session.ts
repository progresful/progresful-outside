import { RATE_LIMITED_ERROR, type ApiResult, type CreateVideoResponse, type ListingContext, type VideoStatusResponse } from '@outside/shared';
import { UNREACHABLE, isEnvelope } from '../apiClient';
import type { Message } from '../messages';
import type { Settings } from '../storage';
import { FIRST_STAGE, isBuilding, nextBadgeState, type BadgeEvent, type BadgeState } from './badgeState';

export const POLL_MS = 1500;

export interface SessionDeps {
  /** Sends a message to the background worker and resolves with its reply. */
  send: (message: Message) => Promise<unknown>;
  render: (state: BadgeState) => void;
  getSettings: () => Promise<Settings>;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface ListingSession {
  /** Starts building the video for a listing, replacing whatever was running. */
  start(listing: ListingContext): void;
  /** Rebuilds for the current listing, e.g. after the interests changed. */
  restart(): void;
  /** Stops polling. Replies that arrive afterwards are ignored. */
  stop(): void;
}

/** The server asked us to slow down. Nothing is wrong: wait a beat and ask again. */
function isBusy(res: ApiResult<unknown>): boolean {
  return !res.success && res.error === RATE_LIMITED_ERROR;
}

function toResult<T>(raw: unknown): ApiResult<T> {
  return isEnvelope(raw) ? (raw as ApiResult<T>) : UNREACHABLE;
}

/**
 * One listing page's conversation with the server: create the video, poll until it is ready,
 * and keep the badge in step. Every run carries a token; bumping it orphans the run's replies
 * and timers, so a listing the user has left can never touch the badge again.
 */
export function createListingSession(deps: SessionDeps): ListingSession {
  let token = 0;
  let timer: unknown;
  let current: ListingContext | null = null;
  let state: BadgeState = { kind: 'hidden' };

  const dispatch = (event: BadgeEvent): void => {
    state = nextBadgeState(state, event);
    deps.render(state);
  };

  const cancel = (): void => {
    token += 1;
    if (timer !== undefined) {
      deps.clearTimeout(timer);
      timer = undefined;
    }
  };

  const ask = async <T>(message: Message): Promise<ApiResult<T>> => {
    try {
      return toResult<T>(await deps.send(message));
    } catch {
      // The worker being asleep or gone is the same to the user as the server being down.
      return UNREACHABLE;
    }
  };

  const poll = (videoId: string, run: number): void => {
    timer = deps.setTimeout(() => {
      timer = undefined;
      void ask<VideoStatusResponse>({ type: 'video:status', videoId }).then((res) => {
        if (run !== token) {
          return;
        }
        if (isBusy(res)) {
          poll(videoId, run);
          return;
        }
        dispatch({ type: 'status', videoId, res });
        if (res.success && isBuilding(res.data.status)) {
          poll(videoId, run);
        }
      });
    }, POLL_MS);
  };

  const begin = async (listing: ListingContext, run: number): Promise<void> => {
    const settings = await deps.getSettings();
    const res = await ask<CreateVideoResponse>({ type: 'video:create', listing, interests: settings.interests });
    if (run !== token) {
      return;
    }
    if (isBusy(res)) {
      timer = deps.setTimeout(() => {
        timer = undefined;
        begin(listing, run).catch(() => {
          if (run === token) {
            dispatch({ type: 'unreachable' });
          }
        });
      }, POLL_MS);
      return;
    }
    if (!res.success) {
      dispatch({ type: 'status', videoId: '', res });
      return;
    }
    const { videoId, status } = res.data;
    dispatch({ type: 'status', videoId, res: { success: true, data: { status, stage: FIRST_STAGE, progress: 0 }, error: null } });
    if (isBuilding(status)) {
      poll(videoId, run);
    }
  };

  const run = (): void => {
    if (!current) {
      return;
    }
    cancel();
    const mine = token;
    dispatch({ type: 'restart' });
    begin(current, mine).catch(() => {
      if (mine === token) {
        dispatch({ type: 'unreachable' });
      }
    });
  };

  return {
    start(listing: ListingContext): void {
      current = listing;
      state = { kind: 'hidden' }; // a new listing never inherits the previous listing's video
      run();
    },
    restart: run,
    stop(): void {
      cancel();
      current = null;
    },
  };
}
