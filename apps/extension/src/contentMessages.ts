import type { PageController, PageSnapshot } from './badge/pageController';

/** Messages the popup sends to the listing tab's content script. */
export type ContentMessage = { type: 'badge:get' } | { type: 'player:open' } | { type: 'badge:retry' };

export const BADGE_GET: ContentMessage = { type: 'badge:get' };
export const PLAYER_OPEN: ContentMessage = { type: 'player:open' };
export const BADGE_RETRY: ContentMessage = { type: 'badge:retry' };

type Controller = Pick<PageController, 'snapshot' | 'playCurrent' | 'retry'>;

const DONE = { ok: true } as const;

/**
 * Answers a popup message, or returns undefined for anything that is not ours — the background
 * worker's messages pass through the same channel and must be left alone.
 */
export function handleContentMessage(controller: Controller, raw: unknown): PageSnapshot | { ok: true } | undefined {
  const type = raw !== null && typeof raw === 'object' ? (raw as { type?: unknown }).type : undefined;
  switch (type) {
    case BADGE_GET.type:
      return controller.snapshot();
    case PLAYER_OPEN.type:
      controller.playCurrent();
      return DONE;
    case BADGE_RETRY.type:
      controller.retry();
      return DONE;
    default:
      return undefined;
  }
}

/** A snapshot arrives over the message channel, so its shape is checked before use. */
export function isPageSnapshot(value: unknown): value is PageSnapshot {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { onListing?: unknown; badge?: { kind?: unknown } };
  return typeof candidate.onListing === 'boolean' && typeof candidate.badge?.kind === 'string';
}
