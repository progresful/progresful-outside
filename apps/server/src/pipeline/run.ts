import type { InterestId, ListingContext, Source, VideoManifest } from '@outside/shared';
import { mirrorFoundImage, mirrorImage, type MirrorDeps } from '../media/mirror';
import type { FoundPhoto } from '../sources/placePhoto';
import { emptyResult } from '../sources/types';
import { resolveTripWindow } from '../sources/tripWindow';
import { assembleManifest, sceneImageUrls } from './assemble';
import { gather, guarded } from './gather';
import { normalizePlace } from './normalize';
import { planScenes, scriptWithGuard, type Selection } from './script';
import { placePhotoQuery, seasonalWords, wantsSeasonalPhoto, type Season } from './season';
import { MIN_PLACES, selectEvents, selectExperiences, selectPlaces } from './select';
import type { PipelineDeps, StageUpdate } from './types';
import { voiceToFit } from './voiceFit';

export type { PipelineDeps, PipelineSources, StageUpdate } from './types';

/** Part of the video cache key: bump it when the video's look or structure changes. */
export const TEMPLATE_VERSION = 3;

/** How long the video waits for a seasonal photo of a place before keeping the stock one. */
export const PHOTO_DEADLINE_MS = 9_000;

export class NotEnoughDataError extends Error {
  constructor() {
    super('Not enough live data for this area');
    this.name = 'NotEnoughDataError';
  }
}

export interface PipelineInput {
  videoId: string;
  listing: ListingContext;
  interests: InterestId[];
}

function mirrorDeps(deps: PipelineDeps): MirrorDeps {
  return {
    fetch: deps.fetch,
    media: deps.media,
    onError: (url, error) => deps.onSourceError?.(`image:${url}`, error),
    ...(deps.lookup ? { lookup: deps.lookup } : {}),
  };
}

async function mirrorImages(deps: PipelineDeps, urls: readonly string[]): Promise<Map<string, string>> {
  const paths = await Promise.all(urls.map((url) => mirrorImage(mirrorDeps(deps), url)));
  return new Map(urls.flatMap((url, index) => (paths[index] ? [[url, paths[index]] as const] : [])));
}

/** A photo found for each place, keyed by the place's own (stock) photo address. */
type SeasonalPhotos = ReadonlyMap<string, FoundPhoto>;

/**
 * Looks for a photo of each outdoor place as it is in the season of the stay. Runs while the
 * script is written and voiced; a search that fails or takes too long leaves the stock photo.
 */
async function findSeasonalPhotos(deps: PipelineDeps, sel: Selection, season: Season): Promise<{ photos: SeasonalPhotos; sources: Source[] }> {
  const wanted = sel.places.filter((place) => wantsSeasonalPhoto(place.interest, season));
  const results = await Promise.all(
    wanted.map((place) =>
      guarded(
        deps,
        'place-photo',
        emptyResult<FoundPhoto>(),
        () =>
          deps.sources.placePhoto(deps, {
            placeId: place.id,
            placeName: place.name,
            city: sel.place.city,
            query: placePhotoQuery(place.name, sel.place.city, season),
          }),
        PHOTO_DEADLINE_MS,
      ),
    ),
  );
  const photos = new Map(wanted.flatMap((place, index) => (results[index]?.facts[0] ? [[place.imageUrl, results[index].facts[0]] as const] : [])));
  return { photos, sources: results.flatMap((result) => (result.source ? [result.source] : [])) };
}

/**
 * Downloads the seasonal photos and puts each in the place of its stock photo. The original is
 * tried first, then the search engine's copy; if neither downloads, the stock photo stays.
 * Returns the stock addresses that were replaced.
 */
async function swapInSeasonalPhotos(deps: PipelineDeps, images: Map<string, string>, photos: SeasonalPhotos): Promise<Set<string>> {
  const swapped = new Set<string>();
  await Promise.all(
    [...photos].map(async ([stockUrl, photo]) => {
      const path = (await mirrorFoundImage(mirrorDeps(deps), photo.imageUrl)) ?? (await mirrorFoundImage(mirrorDeps(deps), photo.fallbackUrl));
      if (path) {
        images.set(stockUrl, path);
        swapped.add(stockUrl);
      }
    }),
  );
  return swapped;
}

/** Only the sources whose facts or photos made it into the video are cited. */
function citedSources(sources: readonly Source[], sel: Selection, images: ReadonlyMap<string, string>, extraSourceIds: readonly string[]): Source[] {
  const planned = new Set(planScenes(sel).flatMap((scene) => scene.factIds));
  const used = new Set(
    [...sel.places, ...sel.experiences, ...sel.events, ...sel.weather, ...sel.climate]
      .filter((fact) => planned.has(fact.id))
      .map((fact) => fact.sourceId),
  );
  for (const photo of sel.seasonPhotos) {
    if (images.has(photo.imageUrl)) {
      used.add(photo.sourceId);
    }
  }
  for (const sourceId of extraSourceIds) {
    used.add(sourceId);
  }
  const cited = sources.filter((source) => used.has(source.id));
  return [...new Map(cited.map((source) => [source.id, source] as const)).values()];
}

/**
 * Listing in, playable manifest out: locate → gather → select → script → voice → assemble.
 * Throws NotEnoughDataError when the area cannot carry a video.
 */
export async function runPipeline(
  deps: PipelineDeps,
  input: PipelineInput,
  onStage: (update: StageUpdate) => void,
): Promise<VideoManifest> {
  const { listing, interests, videoId } = input;
  onStage({ status: 'gathering', stage: 'Reading the neighbourhood', progress: 0.1 });
  const place = await normalizePlace(deps, listing);
  if (!place) {
    throw new NotEnoughDataError();
  }
  const window = resolveTripWindow(listing, deps.today());
  const gathered = await gather(
    deps,
    { place, window, interests, ...(listing.currency ? { currency: listing.currency } : {}) },
    onStage,
  );

  const places = selectPlaces(gathered.places, interests);
  if (places.length < MIN_PLACES) {
    throw new NotEnoughDataError();
  }
  const selection: Selection = {
    place,
    window,
    places,
    experiences: selectExperiences(gathered.experiences, interests, seasonalWords(gathered.season)),
    events: selectEvents(gathered.events, window),
    weather: gathered.weather,
    climate: gathered.climate,
    seasonPhotos: gathered.seasonPhotos,
  };
  // Started now, so the image search costs the viewer no extra wait beyond the script and voice.
  const seasonalPhotos = findSeasonalPhotos(deps, selection, gathered.season);
  seasonalPhotos.catch(() => undefined); // awaited below; this only keeps an early failure from going unhandled

  onStage({ status: 'writing', stage: 'Writing the script', progress: 0.7 });
  const firstScript = await scriptWithGuard(deps.complete, selection, undefined, (reasons) =>
    deps.onSourceError?.('script', new Error(reasons.join('; '))),
  );

  onStage({ status: 'voicing', stage: 'Recording voiceover', progress: 0.85 });
  const voiced = await voiceToFit(deps, selection, firstScript);
  const [audioUrl, images, found] = await Promise.all([
    voiced.audio ? deps.media.put(`${videoId}.mp3`, voiced.audio) : Promise.resolve(null),
    mirrorImages(deps, sceneImageUrls(listing, voiced.sel)),
    seasonalPhotos,
  ]);
  const shown = new Set(voiced.sel.places.map((place) => place.imageUrl));
  const swapped = await swapInSeasonalPhotos(deps, images, new Map([...found.photos].filter(([stockUrl]) => shown.has(stockUrl))));
  const photoSourceIds = [...swapped].flatMap((stockUrl) => found.photos.get(stockUrl)?.sourceId ?? []);

  return assembleManifest({
    id: videoId,
    listing,
    interests,
    sel: voiced.sel,
    scenes: voiced.scenes,
    timings: voiced.timings,
    audioUrl,
    images,
    sources: citedSources([...gathered.sources, ...found.sources], voiced.sel, images, photoSourceIds),
  });
}
