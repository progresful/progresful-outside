import { createHash } from 'node:crypto';
import type { InterestId } from '@outside/shared';

export interface VideoKeyInput {
  site: string;
  listingId: string;
  interests: readonly InterestId[];
  checkIn?: string;
  checkOut?: string;
  templateVersion: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** One video per listing, interest set, trip dates and template version. Interest order does not matter. */
export function videoKey(input: VideoKeyInput): string {
  return sha256(
    JSON.stringify([
      'video',
      input.site,
      input.listingId,
      [...input.interests].sort(),
      input.checkIn ?? null,
      input.checkOut ?? null,
      input.templateVersion,
    ]),
  );
}

/** One scrape result per source adapter and normalised params. Param order does not matter. */
export function scrapeKey(adapterId: string, params: Readonly<Record<string, string | number>>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((name) => [name, params[name]]);
  return sha256(JSON.stringify(['scrape', adapterId, sorted]));
}
