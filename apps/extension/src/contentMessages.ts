import type { PageController, PageSnapshot } from './badge/pageController';

/** Messages the popup sends to the listing tab's content script. */
export type ContentMessage = { type: 'badge:get' } | { type: 'player:open' };

export const BADGE_GET: ContentMessage = { type: 'badge:get' };
export const PLAYER_OPEN: ContentMessage = { type: 'player:open' };

type Controller = Pick<PageController, 'snapshot' | 'playCurrent'>;

/**
 * Answers a popup message, or returns undefined for anything that is not ours — the background
 * worker's messages pass through the same channel and must be left alone.
 */
export function handleContentMessage(controller: Controller, raw: unknown): PageSnapshot | { ok: true } | undefined {
  const type = raw !== null && typeof raw === 'object' ? (raw as { type?: unknown }).type : undefined;
  if (type === BADGE_GET.type) {
    return controller.snapshot();
  }
  if (type === PLAYER_OPEN.type) {
    controller.playCurrent();
    return { ok: true };
  }
  return undefined;
}
