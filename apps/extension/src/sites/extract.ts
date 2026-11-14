import { ListingContextSchema, MAX_LISTING_PHOTOS, type ListingContext } from '@outside/shared';

export type Entity = Record<string, unknown>;

const LODGING_TYPES = [
  'VacationRental', 'Hotel', 'LodgingBusiness', 'Apartment', 'House', 'Accommodation',
  'Resort', 'Hostel', 'BedAndBreakfast', 'Product',
];
const MAX_TITLE = 300;
const MAX_LOCATION = 200;

function isEntity(value: unknown): value is Entity {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flatten(value: unknown): Entity[] {
  if (Array.isArray(value)) {
    return value.flatMap(flatten);
  }
  if (!isEntity(value)) {
    return [];
  }
  return [value, ...flatten(value['@graph'])];
}

/** Every JSON-LD object on the page. A block that is not valid JSON is skipped. */
export function readJsonLd(doc: Document): Entity[] {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((script) => {
    try {
      return flatten(JSON.parse(script.textContent ?? ''));
    } catch {
      // Sites occasionally ship malformed JSON-LD; the other sources still apply.
      return [];
    }
  });
}

function typesOf(entity: Entity): string[] {
  const type = entity['@type'];
  return (Array.isArray(type) ? type : [type]).filter((entry): entry is string => typeof entry === 'string');
}

/** The JSON-LD object that describes the place to stay, if the page has one. */
export function lodgingEntity(doc: Document): Entity {
  const entities = readJsonLd(doc);
  return (
    entities.find((entity) => typesOf(entity).some((type) => LODGING_TYPES.includes(type))) ??
    entities.find((entity) => 'address' in entity) ??
    {}
  );
}

export function text(value: unknown): string | undefined {
  if (isEntity(value)) {
    return text(value.name);
  }
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

export function num(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function metaContent(doc: Document, property: string): string | undefined {
  const tag = doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return text(tag?.getAttribute('content'));
}

/**
 * The addresses a listing page gives for itself: its canonical link, its share address and its
 * JSON-LD url. Right after an in-tab navigation these still name the previous listing, which is
 * how an adapter tells that the document has not caught up with the address bar.
 */
export function selfUrls(doc: Document, entity: Entity): string[] {
  const candidates = [
    doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    metaContent(doc, 'og:url'),
    text(entity.url),
  ];
  return candidates.flatMap((url) => text(url) ?? []);
}

/** "Locality, Country" from a schema.org address, or the address itself when it is plain text. */
export function locationFromAddress(address: unknown): string | undefined {
  if (!isEntity(address)) {
    return text(address);
  }
  const parts = [text(address.addressLocality), text(address.addressCountry)].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export function coordinates(entity: Entity): { lat?: number; lng?: number } {
  const geo = isEntity(entity.geo) ? entity.geo : {};
  return { lat: num(entity.latitude) ?? num(geo.latitude), lng: num(entity.longitude) ?? num(geo.longitude) };
}

function imageUrls(image: unknown): string[] {
  if (Array.isArray(image)) {
    return image.flatMap(imageUrls);
  }
  const url = isEntity(image) ? text(image.url) : text(image);
  return url ? [url] : [];
}

/** The listing's own images as its JSON-LD gives them. */
export function entityPhotos(entity: Entity): string[] {
  return imageUrls(entity.image);
}

/** Up to five distinct https photos, in the order given. */
export function uniquePhotos(candidates: readonly string[]): string[] {
  return [...new Set(candidates.filter((url) => url.startsWith('https://')))].slice(0, MAX_LISTING_PHOTOS);
}

export function isoDateParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name) ?? '';
  const time = Date.parse(`${value}T00:00:00Z`);
  const real = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
  return real ? value : undefined;
}

export function intParam(params: URLSearchParams, name: string): number | undefined {
  const value = num(params.get(name));
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function hasSize(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * The first selector's element that is actually laid out; failing that, the first that exists.
 * Sites keep empty legacy wrappers around, and a badge placed on one of those ends up off screen.
 */
export function firstMatch(doc: Document, selectors: readonly string[]): Element | null {
  const found = selectors.flatMap((selector) => doc.querySelector(selector) ?? []);
  return found.find(hasSize) ?? found[0] ?? null;
}

/** Validates against the shared schema, so the server never receives a listing it would reject. */
export function finalize(candidate: Partial<ListingContext> & { title?: string; locationText?: string }): ListingContext | null {
  const parsed = ListingContextSchema.safeParse({
    ...candidate,
    title: candidate.title?.slice(0, MAX_TITLE),
    locationText: candidate.locationText?.slice(0, MAX_LOCATION),
  });
  return parsed.success ? parsed.data : null;
}
