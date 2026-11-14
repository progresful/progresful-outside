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
  text,
  uniquePhotos,
  type Entity,
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

/** "… - Apartments for Rent in Lisbon, Li, Portugal - Airbnb" → "Portugal". Undefined when the title names no country. */
function countryFromTitle(doc: Document): string | undefined {
  const withoutBrand = doc.title.replace(/\s+-\s+Airbnb\s*$/, '');
  const start = withoutBrand.lastIndexOf(' in ');
  if (start < 0) {
    return undefined;
  }
  const parts = withoutBrand
    .slice(start + ' in '.length)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length >= 2 ? parts[parts.length - 1] : undefined;
}

/** The listing's JSON-LD address often has the city alone; the page title supplies the country. */
function locationOf(entity: Entity, doc: Document): string | undefined {
  const fromAddress = locationFromAddress(entity.address);
  const country = countryFromTitle(doc);
  if (!fromAddress) {
    return locationFromShareTitle(doc);
  }
  return fromAddress.includes(',') || !country || country === fromAddress ? fromAddress : `${fromAddress}, ${country}`;
}

const PHOTO_WIDTH = 1440;

/** Airbnb serves multi-megabyte originals unless a width is asked for. */
function sized(url: string): string {
  return /^https:\/\/[a-z0-9]+\.muscache\.com\//.test(url) && !url.includes('?') ? `${url}?im_w=${PHOTO_WIDTH}` : url;
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
      locationText: locationOf(entity, doc),
      ...coordinates(entity),
      photos: uniquePhotos([...entityPhotos(entity), metaContent(doc, 'og:image') ?? ''].map(sized)),
      checkIn: isoDateParam(parsed.searchParams, 'check_in'),
      checkOut: isoDateParam(parsed.searchParams, 'check_out'),
      guests: intParam(parsed.searchParams, 'adults'),
    });
  },

  findGallery(doc: Document): Element | null {
    return firstMatch(doc, GALLERY_SELECTORS);
  },
};
