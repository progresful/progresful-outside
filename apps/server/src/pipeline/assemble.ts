import {
  VideoManifestSchema,
  type ExperienceFact,
  type Fact,
  type InterestId,
  type ListingContext,
  type PlaceFact,
  type Scene,
  type Source,
  type VideoManifest,
} from '@outside/shared';
import { venueName } from '../sources/events';
import { formatPrice } from '../sources/price';
import { precipitationWord } from '../sources/weather';
import { speaksOfAny } from './activitySigns';
import { factMap, planScenes, type Selection, type StoryScene } from './script';
import { travelLabel } from './select';
import { totalFrames, type SceneTiming } from './timing';

export interface AssembleInput {
  id: string;
  listing: ListingContext;
  interests: InterestId[];
  sel: Selection;
  scenes: StoryScene[];
  timings: SceneTiming[];
  audioUrl: string | null;
  /** Original image URL → media path, for every image that was mirrored successfully. */
  images: ReadonlyMap<string, string>;
  sources: Source[];
}

type SceneContent = Pick<Scene, 'kicker' | 'title' | 'subtitle' | 'note' | 'items' | 'imageUrl' | 'place'>;

/** A description is shown on two lines at most; an offer's title on one. */
const NOTE_MAX_CHARS = 120;
const OFFER_TITLE_MAX_CHARS = 60;

/**
 * The text itself when it fits, else as many whole words as do, ending in an ellipsis. A text
 * with no gap between words in its second half is cut by length instead.
 */
function shorten(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  const cut = clean.slice(0, maxChars);
  const lastGap = cut.search(/\s\S*$/u);
  const kept = lastGap >= maxChars / 2 ? cut.slice(0, lastGap) : cut.slice(0, maxChars - 1);
  return `${kept.replace(/[^\p{L}\p{N})]+$/u, '')}…`;
}

/**
 * Marketplaces put the town in front: "Innsbruck: Tandem Paragliding Flight". The scene already
 * says where, so the town goes; a front part that names an activity ("Rafting: …") stays.
 */
function offerTitle(title: string): string {
  const front = /^([^:]{2,40}):\s+(?=\S.{11,})/u.exec(title);
  const withoutPlace = front && !speaksOfAny(front[1] ?? '') ? title.slice(front[0].length) : title;
  return shorten(withoutPlace, OFFER_TITLE_MAX_CHARS);
}

const REVIEW_COUNT = new Intl.NumberFormat('en-US');

/** Kinds that say what sort of business a listing is, not what the visitor finds there. */
const BUSINESS_KIND = /\b(?:store|shop|company|office|association|organi[sz]ation|club|bus stop)\b/i;

/**
 * "4.5 rating · ≈ 13 min walk" for a sight. Somewhere to go and do something also says what kind
 * of place it is and how many people rated it: "Ski resort · 4.7 rating · 11,817 reviews · ≈ 50 min drive".
 */
function placeSubtitle(place: PlaceFact): string {
  const rating = `${place.rating.toFixed(1)} rating`;
  const kind = place.category && !BUSINESS_KIND.test(place.category) ? place.category : undefined;
  const parts = place.activity
    ? [kind, rating, `${REVIEW_COUNT.format(place.reviewCount)} reviews`, travelLabel(place.distanceM)]
    : [rating, travelLabel(place.distanceM)];
  return parts.filter((part) => part !== undefined && part !== '').join(' · ');
}

/** What an activity scene shows: the place, what it is like, and the offer to book for it. */
function activityContent(place: PlaceFact, offer: ExperienceFact | undefined, imageUrl: string | undefined): SceneContent {
  const note = place.activity ? shorten(place.description ?? '', NOTE_MAX_CHARS) : '';
  return {
    ...(place.activity ? { kicker: place.activity.label } : {}),
    title: place.name,
    subtitle: placeSubtitle(place),
    ...(note ? { note } : {}),
    ...(offer ? { items: [{ title: offerTitle(offer.title), detail: `from ${formatPrice(offer.amount, offer.currency)}` }] } : {}),
    imageUrl,
    place: place.hours && place.timezone ? { hours: place.hours, timezone: place.timezone } : undefined,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayAndMonth(iso: string): { day: number; month: string } {
  return { day: Number(iso.slice(8, 10)), month: MONTHS[Number(iso.slice(5, 7)) - 1] ?? '' };
}

/** "12–16 Dec", or "28 Nov – 3 Dec" across months. */
export function formatDateRange(start: string, end: string): string {
  const from = dayAndMonth(start);
  const to = dayAndMonth(end);
  if (start === end) {
    return `${from.day} ${from.month}`;
  }
  return from.month === to.month
    ? `${from.day}–${to.day} ${to.month}`
    : `${from.day} ${from.month} – ${to.day} ${to.month}`;
}

function firstExperienceImage(sel: Selection): string | undefined {
  const planned = planScenes(sel).find((scene) => scene.type === 'experiences')?.factIds ?? [];
  const byId = new Map(sel.experiences.map((experience) => [experience.id, experience]));
  return planned.map((id) => byId.get(id)?.imageUrl).find((url) => url !== undefined);
}

/** The opening shows the first photo of the place in season; the experiences scene may borrow the second. */
const SEASON_PHOTOS_SHOWN = 2;

/** The hook, the stay and the outro each show a listing photo: a different one where the listing has several. */
const LISTING_PHOTOS_SHOWN = 3;

/** The original URLs of every image a video for this selection can show, without duplicates. */
export function sceneImageUrls(listing: ListingContext, sel: Selection): string[] {
  const candidates = [
    ...sel.seasonPhotos.slice(0, SEASON_PHOTOS_SHOWN).map((photo) => photo.imageUrl),
    ...listing.photos.slice(0, LISTING_PHOTOS_SHOWN),
    ...sel.places.map((place) => place.imageUrl),
    firstExperienceImage(sel),
  ];
  return [...new Set(candidates.filter((url): url is string => url !== undefined))];
}

/** "8–17", or "−19 to −1" below zero, where a dash between the numbers would read as a second minus. */
function temperatureRange(min: number, max: number): string {
  const shown = (celsius: number): string => (celsius < 0 ? `−${Math.abs(celsius)}` : String(celsius));
  return min < 0 || max < 0 ? `${shown(min)} to ${shown(max)}` : `${min}–${max}`;
}

/** "12–16 Dec · usually −6 to 3 °C, snowy"; the month stands in for dates the listing did not give. */
function hookSubtitle(sel: Selection, fact: Fact | undefined): string | undefined {
  const dates = sel.window.fromListing ? formatDateRange(sel.window.start, sel.window.end) : undefined;
  if (fact?.kind !== 'climate') {
    return dates;
  }
  return `${dates ?? fact.month} · usually ${temperatureRange(fact.tempMinC, fact.tempMaxC)} °C, ${fact.conditions}`;
}

function stayText(fact: Fact | undefined): string | undefined {
  if (fact?.kind === 'event') {
    return [fact.title, venueName(fact.venue), fact.dateText].filter((part) => part !== undefined).join(' · ');
  }
  if (fact?.kind === 'weather') {
    return `${temperatureRange(fact.tempMinC, fact.tempMaxC)} °C, ${fact.precipitationChance}% chance of ${precipitationWord(fact)}`;
  }
  return undefined;
}

function sceneContent(scene: StoryScene, input: AssembleInput, facts: ReadonlyMap<string, Fact>): SceneContent {
  const { sel, listing, images } = input;
  const mirrored = (url: string | undefined): string | undefined => (url ? images.get(url) : undefined);
  const listingPhoto = mirrored(listing.photos[0]);
  const seasonPhoto = mirrored(sel.seasonPhotos[0]?.imageUrl);
  // When the opening shows the place in season, the listing's own photos each move one scene on.
  const laterPhotos = seasonPhoto ? listing.photos : listing.photos.slice(1);
  const stayPhoto = mirrored(laterPhotos[0]) ?? listingPhoto;
  const outroPhoto = mirrored(laterPhotos[1]) ?? stayPhoto;
  const sceneFacts = scene.factIds.flatMap((id) => facts.get(id) ?? []);
  const first = sceneFacts[0];

  switch (scene.type) {
    case 'hook':
      return {
        title: `Around ${sel.place.city}`,
        subtitle: hookSubtitle(sel, first),
        imageUrl: seasonPhoto ?? listingPhoto,
      };
    case 'activity': {
      if (first?.kind !== 'place') {
        return { title: sel.place.city, imageUrl: listingPhoto };
      }
      return activityContent(first, sel.activityOffers?.get(first.id), mirrored(first.imageUrl) ?? listingPhoto);
    }
    case 'experiences':
      return {
        title: 'Experiences nearby',
        items: sceneFacts.flatMap((fact) =>
          fact.kind === 'experience'
            ? [{ title: fact.title, detail: `from ${formatPrice(fact.amount, fact.currency)}` }]
            : [],
        ),
        // An offer's own photo first; else the place in season, rather than the listing's bedroom.
        imageUrl: mirrored(firstExperienceImage(sel)) ?? mirrored(sel.seasonPhotos[1]?.imageUrl) ?? listingPhoto,
      };
    case 'stay':
      return {
        title: sel.window.fromListing ? 'During your stay' : 'In the next two weeks',
        subtitle: stayText(first),
        imageUrl: stayPhoto,
      };
    case 'outro':
      return {
        title: "What's outside",
        items: [...new Set(input.sources.map((source) => source.label))].map((label) => ({ title: label, detail: '' })),
        imageUrl: outroPhoto,
      };
  }
}

function distinctSources(sources: readonly Source[]): Source[] {
  return [...new Map(sources.map((source) => [source.id, source] as const)).values()];
}

/**
 * Puts the finished pieces together. All on-screen text comes from fact records here; the model's
 * lines only ever reach the captions.
 */
export function assembleManifest(input: AssembleInput): VideoManifest {
  if (input.scenes.length !== input.timings.length) {
    throw new Error(`Scenes and timings differ: ${input.scenes.length} scenes, ${input.timings.length} timings`);
  }
  const sources = distinctSources(input.sources);
  const oldest = sources.map((source) => source.fetchedAt).sort()[0];
  if (oldest === undefined) {
    throw new Error('A manifest needs at least one source');
  }
  const facts = factMap(input.sel);
  const scenes = input.scenes.map((scene, index): Scene => {
    const timing = input.timings[index] as SceneTiming;
    // The offer shown beside an activity is one of the scene's facts, though the voice never reads it.
    const offers = scene.type === 'activity' ? scene.factIds.flatMap((id) => input.sel.activityOffers?.get(id) ?? []) : [];
    return {
      type: scene.type,
      startFrame: timing.startFrame,
      durationInFrames: timing.durationInFrames,
      captions: timing.captions,
      factIds: [...scene.factIds, ...offers.map((offer) => offer.id)],
      ...sceneContent(scene, input, facts),
    };
  });
  return VideoManifestSchema.parse({
    id: input.id,
    version: 1,
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: totalFrames(input.timings),
    audioUrl: input.audioUrl,
    scenes,
    sources,
    oldestFetchedAt: oldest,
    listing: { title: input.listing.title, locationText: input.listing.locationText },
    interests: input.interests,
  });
}
