import type { ListingContext } from '@outside/shared';
import {
  coordinates,
  finalize,
  firstMatch,
  intParam,
  isoDateParam,
  locationFromAddress,
  lodgingEntity,
  metaContent,
  photos,
  text,
} from './extract';
import { AIRBNB_HOSTS } from './hosts';
import type { SiteAdapter } from './types';

const LISTING_PATH = /^\/rooms\/(\d+)\/?$/;
const GALLERY_SELECTORS = ['[data-section-id="HERO_DEFAULT"]', '[data-plugin-in-point-id="HERO_DEFAULT"]'];

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** "Rental unit in Sintra · ★4.8 · 2 bedrooms" → "Sintra". */
function locationFromShareTitle(doc: Document): string | undefined {
  return text(/ in ([^·]+)/.exec(metaContent(doc, 'og:title') ?? '')?.[1]);
}

function titleFromDocument(doc: Document): string | undefined {
  return text(doc.title.split(' - ')[0]);
}

export const airbnbAdapter: SiteAdapter = {
  site: 'airbnb',

  matchListing(url: string): { listingId: string } | null {
    const parsed = parse(url);
    if (!parsed || parsed.protocol !== 'https:' || !AIRBNB_HOSTS.includes(parsed.hostname)) {
      return null;
    }
    const listingId = LISTING_PATH.exec(parsed.pathname)?.[1];
    return listingId ? { listingId } : null;
  },

  extractListing(doc: Document, url: string): ListingContext | null {
    const match = airbnbAdapter.matchListing(url);
    const parsed = parse(url);
    if (!match || !parsed) {
      return null;
    }
    const entity = lodgingEntity(doc);
    return finalize({
      site: 'airbnb',
      listingId: match.listingId,
      url,
      title: text(entity.name) ?? titleFromDocument(doc),
      locationText: locationFromAddress(entity.address) ?? locationFromShareTitle(doc),
      ...coordinates(entity),
      photos: photos(entity, doc),
      checkIn: isoDateParam(parsed.searchParams, 'check_in'),
      checkOut: isoDateParam(parsed.searchParams, 'check_out'),
      guests: intParam(parsed.searchParams, 'adults'),
    });
  },

  findGallery(doc: Document): Element | null {
    return firstMatch(doc, GALLERY_SELECTORS);
  },
};
