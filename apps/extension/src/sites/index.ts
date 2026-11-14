import { airbnbAdapter } from './airbnb';
import { bookingAdapter } from './booking';
import type { SiteAdapter } from './types';

export type { SiteAdapter } from './types';

const ADAPTERS: readonly SiteAdapter[] = [airbnbAdapter, bookingAdapter];

/** The adapter and listing id for a full listing page, or null for any other URL. */
export function adapterFor(url: string): { adapter: SiteAdapter; listingId: string } | null {
  for (const adapter of ADAPTERS) {
    const match = adapter.matchListing(url);
    if (match) {
      return { adapter, listingId: match.listingId };
    }
  }
  return null;
}
