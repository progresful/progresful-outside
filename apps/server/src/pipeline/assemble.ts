import {
  VideoManifestSchema,
  type Fact,
  type InterestId,
  type ListingContext,
  type Scene,
  type Source,
  type VideoManifest,
} from '@outside/shared';
import { formatPrice } from '../sources/price';
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

type SceneContent = Pick<Scene, 'title' | 'subtitle' | 'items' | 'imageUrl' | 'place'>;

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

/** The original URLs of every image a video for this selection can show, without duplicates. */
export function sceneImageUrls(listing: ListingContext, sel: Selection): string[] {
  const candidates = [listing.photos[0], ...sel.places.map((place) => place.imageUrl), firstExperienceImage(sel)];
  return [...new Set(candidates.filter((url): url is string => url !== undefined))];
}

function stayText(fact: Fact | undefined): string | undefined {
  if (fact?.kind === 'event') {
    return `${fact.title} · ${fact.dateText}`;
  }
  if (fact?.kind === 'weather') {
    return `${fact.tempMinC}–${fact.tempMaxC} °C, ${fact.precipitationChance}% chance of rain`;
  }
  return undefined;
}

function sceneContent(scene: StoryScene, input: AssembleInput, facts: ReadonlyMap<string, Fact>): SceneContent {
  const { sel, listing, images } = input;
  const mirrored = (url: string | undefined): string | undefined => (url ? images.get(url) : undefined);
  const listingPhoto = mirrored(listing.photos[0]);
  const sceneFacts = scene.factIds.flatMap((id) => facts.get(id) ?? []);
  const first = sceneFacts[0];

  switch (scene.type) {
    case 'hook':
      return {
        title: `Around ${sel.place.city}`,
        subtitle: sel.window.fromListing ? formatDateRange(sel.window.start, sel.window.end) : undefined,
        imageUrl: listingPhoto,
      };
    case 'activity': {
      if (first?.kind !== 'place') {
        return { title: sel.place.city, imageUrl: listingPhoto };
      }
      return {
        title: first.name,
        subtitle: `${first.rating.toFixed(1)} rating · ${travelLabel(first.distanceM)}`,
        imageUrl: mirrored(first.imageUrl) ?? listingPhoto,
        place: first.hours && first.timezone ? { hours: first.hours, timezone: first.timezone } : undefined,
      };
    }
    case 'experiences':
      return {
        title: 'Experiences nearby',
        items: sceneFacts.flatMap((fact) =>
          fact.kind === 'experience'
            ? [{ title: fact.title, detail: `from ${formatPrice(fact.amount, fact.currency)}` }]
            : [],
        ),
        imageUrl: mirrored(firstExperienceImage(sel)) ?? listingPhoto,
      };
    case 'stay':
      return {
        title: sel.window.fromListing ? 'During your stay' : 'In the next two weeks',
        subtitle: stayText(first),
        imageUrl: listingPhoto,
      };
    case 'outro':
      return {
        title: "What's outside",
        items: [...new Set(input.sources.map((source) => source.label))].map((label) => ({ title: label, detail: '' })),
        imageUrl: listingPhoto,
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
    return {
      type: scene.type,
      startFrame: timing.startFrame,
      durationInFrames: timing.durationInFrames,
      captions: timing.captions,
      factIds: scene.factIds,
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
