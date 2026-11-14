import type { ListingContext } from '@outside/shared';
import {
  coordinates,
  entityPhotos,
  finalize,
  firstMatch,
  intParam,
  isoDateParam,
  locationFromAddress,
  lodgingEntity,
  metaContent,
  num,
  text,
  uniquePhotos,
  type Entity,
} from './extract';
import type { SiteAdapter } from './types';

const BOOKING_HOST = 'www.booking.com';
/** /hotel/<country>/<slug>[.<language>].html */
const LISTING_PATH = /^\/hotel\/([a-z]{2})\/([^/.]+)(?:\.[a-z-]+)?\.html$/;
const GALLERY_SELECTORS = ['[data-testid="GalleryUnifiedDesktop-wrapper"]', '#photo_wrapper', '.bh-photo-grid'];
const GALLERY_PHOTOS = '[data-testid="GalleryUnifiedDesktop-wrapper"] img';
const HOTEL_PHOTO = /^https:\/\/[a-z0-9-]+\.bstatic\.com\/xdata\/images\/hotel\//;
const PHOTO_SIZE = 'max1280x900';

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

/** "Hotel Avenida Palace, Lisbon (updated prices 2027)" → "Lisbon". */
function cityFromTitle(doc: Document, name: string | undefined): string | undefined {
  const rest = name && doc.title.startsWith(name) ? doc.title.slice(name.length) : '';
  return text(/^\s*,\s*(.+?)\s*(?:\(|\s[–|-]\s|$)/.exec(rest)?.[1]);
}

/** "Rua X 1, Santa Maria Maior, 1200-359 Lisbon, Portugal" → "Lisbon": the part before the country, without the postcode. */
function cityFromStreetAddress(address: Entity, country: string | undefined): string | undefined {
  const parts = (text(address.streetAddress) ?? '').split(',').map((part) => part.trim());
  const beforeCountry = country && parts[parts.length - 1] === country ? parts[parts.length - 2] : undefined;
  const words = (beforeCountry ?? '').split(/\s+/).filter((word) => !/\d/.test(word));
  return text(words.join(' '));
}

/**
 * Booking.com puts the street in `addressLocality`, so the city comes from the page title, or
 * failing that from the full street address.
 */
function locationOf(entity: Entity, doc: Document): string | undefined {
  const address = entity.address;
  if (address === null || typeof address !== 'object' || Array.isArray(address)) {
    return locationFromAddress(address);
  }
  const fields = address as Entity;
  const country = text(fields.addressCountry);
  const city = cityFromTitle(doc, text(entity.name)) ?? cityFromStreetAddress(fields, country);
  return city ? [city, country].filter((part) => part !== undefined).join(', ') : locationFromAddress(address);
}

/** Booking.com sizes a hotel photo by a path segment; the page's own choices are often thumbnails. */
function sized(url: string): string {
  return HOTEL_PHOTO.test(url) ? url.replace(/\/max\d+(?:x\d+)?\//, `/${PHOTO_SIZE}/`) : url;
}

function photosOf(entity: Entity, doc: Document): string[] {
  const gallery = [...doc.querySelectorAll(GALLERY_PHOTOS)]
    .map((image) => image.getAttribute('src') ?? '')
    .filter((src) => HOTEL_PHOTO.test(src));
  return uniquePhotos([...entityPhotos(entity), ...gallery, metaContent(doc, 'og:image') ?? ''].map(sized));
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
      locationText: locationOf(entity, doc),
      lat: fromEntity.lat ?? fromPage.lat,
      lng: fromEntity.lng ?? fromPage.lng,
      photos: photosOf(entity, doc),
      checkIn: isoDateParam(parsed.searchParams, 'checkin'),
      checkOut: isoDateParam(parsed.searchParams, 'checkout'),
      guests: intParam(parsed.searchParams, 'group_adults'),
    });
  },

  findGallery(doc: Document): Element | null {
    return firstMatch(doc, GALLERY_SELECTORS);
  },
};
