import type { ListingContext } from '@outside/shared';
import {
  coordinates,
  finalize,
  firstMatch,
  intParam,
  isoDateParam,
  locationFromAddress,
  lodgingEntity,
  num,
  photos,
  text,
} from './extract';
import type { SiteAdapter } from './types';

const BOOKING_HOST = 'www.booking.com';
/** /hotel/<country>/<slug>[.<language>].html */
const LISTING_PATH = /^\/hotel\/([a-z]{2})\/([^/.]+)(?:\.[a-z-]+)?\.html$/;
const GALLERY_SELECTORS = ['#photo_wrapper', '[data-testid="GalleryUnifiedDesktop-wrapper"]', '.bh-photo-grid'];

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Booking.com carries the map position on an element as data-atlas-latlng="lat,lng". */
function coordinatesFromPage(doc: Document): { lat?: number; lng?: number } {
  const [lat, lng] = (doc.querySelector('[data-atlas-latlng]')?.getAttribute('data-atlas-latlng') ?? '').split(',');
  return { lat: num(lat), lng: num(lng) };
}

function titleFromDocument(doc: Document): string | undefined {
  return text(doc.title.split(/[,–|]/)[0]);
}

export const bookingAdapter: SiteAdapter = {
  site: 'booking',

  matchListing(url: string): { listingId: string } | null {
    const parsed = parse(url);
    if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== BOOKING_HOST) {
      return null;
    }
    const match = LISTING_PATH.exec(parsed.pathname);
    return match ? { listingId: `${match[1]}/${match[2]}` } : null;
  },

  extractListing(doc: Document, url: string): ListingContext | null {
    const match = bookingAdapter.matchListing(url);
    const parsed = parse(url);
    if (!match || !parsed) {
      return null;
    }
    const entity = lodgingEntity(doc);
    const fromEntity = coordinates(entity);
    const fromPage = coordinatesFromPage(doc);
    return finalize({
      site: 'booking',
      listingId: match.listingId,
      url,
      title: text(entity.name) ?? titleFromDocument(doc),
      locationText: locationFromAddress(entity.address),
      lat: fromEntity.lat ?? fromPage.lat,
      lng: fromEntity.lng ?? fromPage.lng,
      photos: photos(entity, doc),
      checkIn: isoDateParam(parsed.searchParams, 'checkin'),
      checkOut: isoDateParam(parsed.searchParams, 'checkout'),
      guests: intParam(parsed.searchParams, 'group_adults'),
    });
  },

  findGallery(doc: Document): Element | null {
    return firstMatch(doc, GALLERY_SELECTORS);
  },
};
