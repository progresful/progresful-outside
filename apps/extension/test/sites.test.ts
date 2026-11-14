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
      photos: [1, 2, 3, 4, 5].map((n) => `https://a0.muscache.com/im/pictures/${n}.jpg`),
      checkIn: '2026-12-12',
      checkOut: '2026-12-16',
      guests: 2,
    });
  });

  it('falls back to the share title for the location', () => {
    const noAddress = page('<meta property="og:title" content="Rental unit in Sintra · ★4.8 · 2 bedrooms"><title>Villa - Airbnb</title>');
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
      photos: ['https://cf.bstatic.com/xdata/images/hotel/max1024x768/main.jpg', 'https://cf.bstatic.com/xdata/images/hotel/max1024x768/og.jpg'],
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
    const broken = page('<title>Flat - Airbnb</title><script type="application/ld+json">{not json</script><meta property="og:title" content="Home in Porto · ★5">');
    expect(adapterFor(airbnbUrl)!.adapter.extractListing(broken, airbnbUrl)).toMatchObject({ title: 'Flat', locationText: 'Porto' });
  });

  it('keeps only https photos', () => {
    const mixed = page(
      `<title>Flat - Airbnb</title><meta property="og:title" content="Home in Porto · ★5">
       <meta property="og:image" content="http://a0.muscache.com/insecure.jpg">
       <script type="application/ld+json">${JSON.stringify({ '@type': 'VacationRental', image: ['javascript:alert(1)', 'https://a0.muscache.com/ok.jpg'] })}</script>`,
    );
    expect(adapterFor(airbnbUrl)!.adapter.extractListing(mixed, airbnbUrl)?.photos).toEqual(['https://a0.muscache.com/ok.jpg']);
  });
});
