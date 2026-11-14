import { describe, expect, it } from 'vitest';
import { adapterFor } from '../src/sites';

/**
 * These pages are synthetic: they carry the standard metadata (JSON-LD, OpenGraph) the adapters
 * read. Real saved pages replace them once the listing-extraction spike has run.
 */
function page(head: string, body = ''): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, 'text/html');
}

const airbnbUrl = 'https://www.airbnb.com/rooms/12345?check_in=2026-12-12&check_out=2026-12-16&adults=2';
const airbnbDoc = page(
  `<title>Flat with a view - Apartments for Rent in Lisbon, Portugal - Airbnb</title>
   <meta property="og:title" content="Rental unit in Lisbon · ★4.92 · 1 bedroom · 1 bed · 1 bath">
   <meta property="og:url" content="https://www.airbnb.com/rooms/12345">
   <meta property="og:image" content="https://a0.muscache.com/im/pictures/og.jpg">
   <script type="application/ld+json">${JSON.stringify({
     '@context': 'https://schema.org',
     '@type': 'VacationRental',
     name: 'Flat with a view',
     latitude: 38.7139,
     longitude: -9.1334,
     address: { '@type': 'PostalAddress', addressLocality: 'Lisbon', addressRegion: 'Lisbon', addressCountry: 'Portugal' },
     image: [1, 2, 3, 4, 5, 6].map((n) => `https://a0.muscache.com/im/pictures/${n}.jpg`),
   })}</script>`,
  '<div data-section-id="HERO_DEFAULT"><img src="https://a0.muscache.com/im/pictures/1.jpg"></div>',
);

const bookingUrl = 'https://www.booking.com/hotel/pt/some-hotel.en-gb.html?checkin=2026-12-12&checkout=2026-12-16&group_adults=2';
const bookingDoc = page(
  `<title>Some Hotel, Lisbon – Updated 2026 Prices</title>
   <link rel="canonical" href="https://www.booking.com/hotel/pt/some-hotel.en-gb.html">
   <meta property="og:image" content="https://cf.bstatic.com/xdata/images/hotel/max1024x768/og.jpg">
   <script type="application/ld+json">${JSON.stringify({
     '@context': 'https://schema.org',
     '@type': 'Hotel',
     name: 'Some Hotel',
     address: { '@type': 'PostalAddress', addressLocality: 'Lisbon', addressCountry: 'Portugal', streetAddress: 'Rua X 1' },
     image: 'https://cf.bstatic.com/xdata/images/hotel/max1024x768/main.jpg',
   })}</script>`,
  '<a id="hotel_address" data-atlas-latlng="38.7071,-9.1355"></a><div id="photo_wrapper"></div>',
);

/** Metadata copied from a live Airbnb listing on 2026-11-14: no country in the address, eight photos. */
const liveAirbnbDoc = page(
  `<title>Alfama - Beco do Belo Studio - Apartments for Rent in Lisbon, Li, Portugal - Airbnb</title>
   <meta property="og:title" content="Rental unit in Lisbon · ★4.85 · 1 bedroom · 1 bed · 1 bath">
   <meta property="og:url" content="https://www.airbnb.com/rooms/12345">
   <link rel="canonical" href="">
   <meta property="og:image" content="https://a0.muscache.com/im/pictures/hosting/Hosting-X/original/25bd02a7.jpeg">
   <script type="application/ld+json">${JSON.stringify({
     '@context': 'https://schema.org',
     '@type': 'VacationRental',
     identifier: 'RGVtYW5k',
     name: 'Alfama - Beco do Belo Studio',
     image: ['25bd02a7', '3b8aefd4', '995699a0'].map((id) => `https://a0.muscache.com/im/pictures/hosting/Hosting-X/original/${id}.jpeg`),
     latitude: 38.7117,
     longitude: -9.12667,
     address: { addressLocality: 'Lisbon' },
     aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.85, ratingCount: '652' },
   })}</script>`,
  '<div data-section-id="HERO_DEFAULT"></div>',
);

/** Metadata copied from a live Booking.com hotel page on 2026-11-14: the "locality" is the street. */
const liveBookingDoc = page(
  `<title>Hotel Avenida Palace, Lisbon (updated prices 2027)</title>
   <meta property="og:image" content="https://q-xx.bstatic.com/xdata/images/hotel/1200x630/21303863.jpg?k=8b47&o=">
   <script type="application/ld+json">${JSON.stringify({
     '@context': 'http://schema.org',
     '@type': 'Hotel',
     name: 'Hotel Avenida Palace',
     url: 'https://www.booking.com/hotel/pt/some-hotel.en-gb.html',
     image: 'https://cf.bstatic.com/xdata/images/hotel/max500/21303863.jpg?k=8b47&o=&hp=1',
     address: {
       '@type': 'PostalAddress',
       addressRegion: '',
       addressLocality: 'Rua 1. De Dezembro, 123',
       streetAddress: 'Rua 1. De Dezembro, 123, Santa Maria Maior, 1200-359 Lisbon, Portugal',
       postalCode: '1200-359',
       addressCountry: 'Portugal',
     },
   })}</script>`,
  `<div id="photo_wrapper"></div>
   <div data-testid="GalleryUnifiedDesktop-wrapper">
     <img src="https://cf.bstatic.com/xdata/images/hotel/max1024x768/21303863.jpg?k=8b47&o=">
     <img src="https://cf.bstatic.com/xdata/images/hotel/max500/99887766.jpg?k=aa11&o=">
     <img src="https://cf.bstatic.com/static/img/icon.svg">
   </div>
   <a data-atlas-latlng="38.71491812653197,-9.141389429569244"></a>`,
);

/** jsdom lays nothing out, so an element only has a size when a test gives it one. */
function giveSize(element: Element | null, width: number, height: number): void {
  if (element) {
    element.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  }
}

describe('on live page shapes', () => {
  it('adds the country from the page title when the Airbnb address has only the city', () => {
    const listing = adapterFor(airbnbUrl)!.adapter.extractListing(liveAirbnbDoc, airbnbUrl);

    expect(listing).toMatchObject({ title: 'Alfama - Beco do Belo Studio', locationText: 'Lisbon, Portugal', lat: 38.7117, lng: -9.12667 });
  });

  it('asks Airbnb for photos at video size, not the multi-megabyte originals', () => {
    const listing = adapterFor(airbnbUrl)!.adapter.extractListing(liveAirbnbDoc, airbnbUrl);

    expect(listing?.photos).toEqual(
      ['25bd02a7', '3b8aefd4', '995699a0'].map((id) => `https://a0.muscache.com/im/pictures/hosting/Hosting-X/original/${id}.jpeg?im_w=1440`),
    );
  });

  it.each([
    ['Loft - Condominiums for Rent in Austin, Texas, United States - Airbnb', 'Austin, United States'],
    ['Maison - Houses for Rent in Saint-Malo, Bretagne, France - Airbnb', 'Saint-Malo, France'],
    ['Flat - Apartments for Rent in Lisbon - Airbnb', 'Lisbon'],
    ['Flat - Airbnb', 'Lisbon'],
  ])('reads the country from "%s"', (title, expected) => {
    const doc = page(
      `<title>${title}</title><meta property="og:url" content="https://www.airbnb.com/rooms/12345"><script type="application/ld+json">${JSON.stringify({ '@type': 'VacationRental', name: 'Flat', address: { addressLocality: expected.split(',')[0] } })}</script>`,
    );

    expect(adapterFor(airbnbUrl)!.adapter.extractListing(doc, airbnbUrl)?.locationText).toBe(expected);
  });

  it('reads the city of a Booking.com hotel from its title, not the street in its address', () => {
    const listing = adapterFor(bookingUrl)!.adapter.extractListing(liveBookingDoc, bookingUrl);

    expect(listing).toMatchObject({
      title: 'Hotel Avenida Palace',
      locationText: 'Lisbon, Portugal',
      lat: 38.71491812653197,
      lng: -9.141389429569244,
    });
  });

  it('falls back to the street address for the Booking.com city when the title has none', () => {
    const doc = page(liveBookingDoc.head.innerHTML.replace(/<title>[^<]*<\/title>/, '<title>Booking.com</title>'), liveBookingDoc.body.innerHTML);

    expect(adapterFor(bookingUrl)!.adapter.extractListing(doc, bookingUrl)?.locationText).toBe('Lisbon, Portugal');
  });

  it('collects Booking.com photos from the gallery too, all at video size', () => {
    const listing = adapterFor(bookingUrl)!.adapter.extractListing(liveBookingDoc, bookingUrl);

    expect(listing?.photos).toEqual([
      'https://cf.bstatic.com/xdata/images/hotel/max1280x900/21303863.jpg?k=8b47&o=&hp=1',
      'https://cf.bstatic.com/xdata/images/hotel/max1280x900/21303863.jpg?k=8b47&o=',
      'https://cf.bstatic.com/xdata/images/hotel/max1280x900/99887766.jpg?k=aa11&o=',
      'https://q-xx.bstatic.com/xdata/images/hotel/1200x630/21303863.jpg?k=8b47&o=',
    ]);
  });

  it('prefers the Booking.com gallery that is actually laid out over the empty legacy wrapper', () => {
    giveSize(liveBookingDoc.querySelector('[data-testid="GalleryUnifiedDesktop-wrapper"]'), 1100, 420);

    const found = adapterFor(bookingUrl)!.adapter.findGallery(liveBookingDoc);

    expect(found?.getAttribute('data-testid')).toBe('GalleryUnifiedDesktop-wrapper');
  });
});

describe('visitKey', () => {
  it('is the listing and its dates, whatever else the address carries', () => {
    const airbnb = adapterFor(airbnbUrl)!.adapter;
    const key = airbnb.visitKey(airbnbUrl);

    expect(key).toBe('12345|2026-12-12|2026-12-16');
    expect(airbnb.visitKey(`${airbnbUrl}&modal=PHOTO_TOUR_SCROLLABLE`)).toBe(key);
    expect(airbnb.visitKey('https://www.airbnb.com/rooms/12345')).toBe('12345||');
    expect(airbnb.visitKey('https://www.airbnb.com/s/Lisbon/homes')).toBeNull();
  });

  it('reads Booking.com dates and ignores the page language', () => {
    const booking = adapterFor(bookingUrl)!.adapter;

    expect(booking.visitKey(bookingUrl)).toBe('pt/some-hotel|2026-12-12|2026-12-16');
    expect(booking.visitKey('https://www.booking.com/hotel/pt/some-hotel.de.html?checkin=2026-12-12&checkout=2026-12-16&lang=de')).toBe(
      'pt/some-hotel|2026-12-12|2026-12-16',
    );
  });
});

describe('a document that is not the listing in the address bar', () => {
  // After an in-tab navigation the address changes before the page does.
  it('is refused when the Airbnb page still names the previous listing', () => {
    const next = 'https://www.airbnb.com/rooms/99999?check_in=2026-12-12&check_out=2026-12-16';

    expect(adapterFor(next)!.adapter.extractListing(airbnbDoc, next)).toBeNull();
    expect(adapterFor(next)!.adapter.extractListing(liveAirbnbDoc, next)).toBeNull();
  });

  it('is refused when the Booking.com page still names the previous hotel', () => {
    const next = 'https://www.booking.com/hotel/pt/another-hotel.en-gb.html';

    expect(adapterFor(next)!.adapter.extractListing(bookingDoc, next)).toBeNull();
    expect(adapterFor(next)!.adapter.extractListing(liveBookingDoc, next)).toBeNull();
  });

  it('is refused when the page does not say which listing it is', () => {
    const anonymous = page('<title>Flat - Airbnb</title><meta property="og:title" content="Home in Porto · ★5">');

    expect(adapterFor(airbnbUrl)!.adapter.extractListing(anonymous, airbnbUrl)).toBeNull();
  });

  it('is accepted whatever language version of the Booking.com page names the hotel', () => {
    const german = 'https://www.booking.com/hotel/pt/some-hotel.de.html';

    expect(adapterFor(german)!.adapter.extractListing(bookingDoc, german)?.listingId).toBe('pt/some-hotel');
  });
});

describe('adapterFor', () => {
  it.each([
    [airbnbUrl, 'airbnb', '12345'],
    ['https://www.airbnb.co.uk/rooms/987', 'airbnb', '987'],
    [bookingUrl, 'booking', 'pt/some-hotel'],
    ['https://www.booking.com/hotel/fi/hotel-kamp.html', 'booking', 'fi/hotel-kamp'],
  ])('matches %s', (url, site, id) => {
    const match = adapterFor(url);
    expect([match?.adapter.site, match?.listingId]).toEqual([site, id]);
  });

  it.each([
    'https://www.airbnb.com/s/Lisbon/homes',
    'https://www.airbnb.com/rooms',
    'https://www.airbnb.com/experiences/123',
    'https://www.booking.com/searchresults.html?ss=Lisbon',
    'https://www.booking.com/index.html',
    'https://example.com/rooms/1',
    'https://www.airbnb.com.evil.example/rooms/1',
    'not a url',
  ])('ignores %s', (url) => {
    expect(adapterFor(url)).toBeNull();
  });
});

describe('airbnb adapter', () => {
  const { adapter } = adapterFor(airbnbUrl)!;

  it('reads the listing from the page and the url', () => {
    expect(adapter.extractListing(airbnbDoc, airbnbUrl)).toEqual({
      site: 'airbnb',
      listingId: '12345',
      url: airbnbUrl,
      title: 'Flat with a view',
      locationText: 'Lisbon, Portugal',
      lat: 38.7139,
      lng: -9.1334,
      photos: [1, 2, 3, 4, 5].map((n) => `https://a0.muscache.com/im/pictures/${n}.jpg?im_w=1440`),
      checkIn: '2026-12-12',
      checkOut: '2026-12-16',
      guests: 2,
    });
  });

  it('falls back to the share title for the location', () => {
    const noAddress = page('<meta property="og:url" content="https://www.airbnb.com/rooms/12345"><meta property="og:title" content="Rental unit in Sintra · ★4.8 · 2 bedrooms"><title>Villa - Airbnb</title>');
    expect(adapter.extractListing(noAddress, airbnbUrl)).toMatchObject({ locationText: 'Sintra', title: 'Villa' });
  });

  it('leaves out dates that are not real dates', () => {
    const url = 'https://www.airbnb.com/rooms/12345?check_in=soon&check_out=2026-13-40';
    const result = adapter.extractListing(airbnbDoc, url);
    expect([result?.checkIn, result?.checkOut]).toEqual([undefined, undefined]);
  });

  it('finds the gallery', () => {
    expect(adapter.findGallery(airbnbDoc)?.getAttribute('data-section-id')).toBe('HERO_DEFAULT');
  });
});

describe('booking adapter', () => {
  const { adapter } = adapterFor(bookingUrl)!;

  it('reads the listing from the page and the url', () => {
    expect(adapter.extractListing(bookingDoc, bookingUrl)).toEqual({
      site: 'booking',
      listingId: 'pt/some-hotel',
      url: bookingUrl,
      title: 'Some Hotel',
      locationText: 'Lisbon, Portugal',
      lat: 38.7071,
      lng: -9.1355,
      photos: ['https://cf.bstatic.com/xdata/images/hotel/max1280x900/main.jpg', 'https://cf.bstatic.com/xdata/images/hotel/max1280x900/og.jpg'],
      checkIn: '2026-12-12',
      checkOut: '2026-12-16',
      guests: 2,
    });
  });

  it('finds the gallery', () => {
    expect(adapter.findGallery(bookingDoc)?.id).toBe('photo_wrapper');
  });
});

describe('every adapter', () => {
  it.each([airbnbUrl, bookingUrl])('returns null, not a throw, for an empty page (%s)', (url) => {
    const { adapter } = adapterFor(url)!;
    expect(adapter.extractListing(page(''), url)).toBeNull();
    expect(adapter.findGallery(page(''))).toBeNull();
  });

  it('survives broken JSON-LD', () => {
    const broken = page('<title>Flat - Airbnb</title><meta property="og:url" content="https://www.airbnb.com/rooms/12345"><script type="application/ld+json">{not json</script><meta property="og:title" content="Home in Porto · ★5">');
    expect(adapterFor(airbnbUrl)!.adapter.extractListing(broken, airbnbUrl)).toMatchObject({ title: 'Flat', locationText: 'Porto' });
  });

  it('keeps only https photos', () => {
    const mixed = page(
      `<title>Flat - Airbnb</title><meta property="og:title" content="Home in Porto · ★5">
       <meta property="og:url" content="https://www.airbnb.com/rooms/12345">
       <meta property="og:image" content="http://a0.muscache.com/insecure.jpg">
       <script type="application/ld+json">${JSON.stringify({ '@type': 'VacationRental', image: ['javascript:alert(1)', 'https://a0.muscache.com/ok.jpg'] })}</script>`,
    );
    expect(adapterFor(airbnbUrl)!.adapter.extractListing(mixed, airbnbUrl)?.photos).toEqual(['https://a0.muscache.com/ok.jpg?im_w=1440']);
  });
});
