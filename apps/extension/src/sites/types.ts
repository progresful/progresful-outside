import type { ListingContext } from '@outside/shared';

/** Everything the extension knows about one listing site. Adapters never throw. */
export interface SiteAdapter {
  site: ListingContext['site'];
  /** The listing id when the URL is a full listing page, otherwise null. */
  matchListing(url: string): { listingId: string } | null;
  /**
   * What makes a visit: the listing and the stay dates in the address. Two addresses with the
   * same key are the same visit, however else they differ; null when the URL is not a listing.
   */
  visitKey(url: string): string | null;
  /** The listing as the page shows it, or null when the title or location cannot be read. */
  extractListing(doc: Document, url: string): ListingContext | null;
  /** The photo gallery the badge sits on, or null when it cannot be found. */
  findGallery(doc: Document): Element | null;
}
