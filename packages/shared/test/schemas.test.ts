import { describe, expect, it } from 'vitest';
import {
  CreateVideoRequestSchema,
  DEFAULT_INTERESTS,
  INTERESTS,
  ListingContextSchema,
  MAX_INTERESTS,
  VideoManifestSchema,
  effectiveInterests,
} from '../src/index';

const listing = {
  site: 'airbnb',
  listingId: '1',
  url: 'https://www.airbnb.com/rooms/1',
  title: 't',
  locationText: 'Lisbon, Portugal',
  photos: [],
};

describe('interests', () => {
  it('has 12 presets and caps picks at 5', () => {
    expect(INTERESTS).toHaveLength(12);
    expect(MAX_INTERESTS).toBe(5);
    expect(DEFAULT_INTERESTS).toEqual(['food', 'culture', 'nature']);
    expect(effectiveInterests([])).toEqual(['food', 'culture', 'nature']);
    expect(
      effectiveInterests(['food', 'food', 'water', 'gems', 'events', 'family', 'nature']),
    ).toEqual(['food', 'water', 'gems', 'events', 'family']);
  });

  it('uses the short labels from the approved popup, in order', () => {
    expect(INTERESTS.map((i) => i.shortLabel)).toEqual([
      'Food', 'Nightlife', 'Museums', 'History', 'Nature', 'Beaches',
      'Adventure', 'Family', 'Wellness', 'Shopping', 'Live music', 'Hidden gems',
    ]);
  });

  it('has a noun per preset for the "Finding … spots" progress line', () => {
    expect(INTERESTS.map((i) => i.stageNoun)).toEqual([
      'food', 'nightlife', 'museum', 'historic', 'nature', 'beach',
      'adventure', 'family', 'wellness', 'shopping', 'live music', 'hidden',
    ]);
  });

  it('gives every preset at least one maps query and one experience keyword', () => {
    for (const interest of INTERESTS) {
      expect(interest.mapsQueries.length).toBeGreaterThan(0);
      expect(interest.experienceKeywords.length).toBeGreaterThan(0);
    }
  });
});

describe('ListingContextSchema', () => {
  it('accepts a minimal listing', () => {
    expect(ListingContextSchema.safeParse(listing).success).toBe(true);
  });

  it('rejects more than 5 photos', () => {
    const photos = Array(6).fill('https://a0.muscache.com/x.jpg');
    expect(ListingContextSchema.safeParse({ ...listing, photos }).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(ListingContextSchema.safeParse({ ...listing, checkIn: '12/16/2026' }).success).toBe(false);
    expect(ListingContextSchema.safeParse({ ...listing, checkIn: '2026-12-16' }).success).toBe(true);
  });

  it('rejects an unknown site', () => {
    expect(ListingContextSchema.safeParse({ ...listing, site: 'vrbo' }).success).toBe(false);
  });
});

describe('CreateVideoRequestSchema', () => {
  it('accepts up to 5 interests', () => {
    const interests = ['food', 'water', 'gems', 'events', 'family'];
    expect(CreateVideoRequestSchema.safeParse({ listing, interests }).success).toBe(true);
  });

  it('rejects 6 interests', () => {
    const interests = ['food', 'water', 'gems', 'events', 'family', 'nature'];
    expect(CreateVideoRequestSchema.safeParse({ listing, interests }).success).toBe(false);
  });

  it('rejects an unknown interest', () => {
    expect(CreateVideoRequestSchema.safeParse({ listing, interests: ['golf'] }).success).toBe(false);
  });
});

describe('VideoManifestSchema', () => {
  const manifest = {
    id: 'abc',
    version: 1,
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 300,
    audioUrl: null,
    scenes: [
      { type: 'hook', startFrame: 0, durationInFrames: 300, title: 'Around Lisbon', captions: [], factIds: [] },
    ],
    sources: [{ id: 's1', label: 'Google Maps', url: 'https://maps.google.com', fetchedAt: '2026-11-14T02:14:00.000Z' }],
    oldestFetchedAt: '2026-11-14T02:14:00.000Z',
    listing: { title: 't', locationText: 'Lisbon, Portugal' },
    interests: ['food'],
  };

  it('accepts a minimal manifest', () => {
    expect(VideoManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('rejects a frame size other than 1280x720 at 30 fps', () => {
    expect(VideoManifestSchema.safeParse({ ...manifest, width: 1920 }).success).toBe(false);
    expect(VideoManifestSchema.safeParse({ ...manifest, fps: 60 }).success).toBe(false);
  });
});
