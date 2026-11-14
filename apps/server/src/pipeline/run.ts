import type { InterestId, ListingContext, Source, VideoManifest } from '@outside/shared';
import { mirrorImage } from '../media/mirror';
import { resolveTripWindow } from '../sources/tripWindow';
import { assembleManifest, sceneImageUrls } from './assemble';
import { gather } from './gather';
import { normalizePlace } from './normalize';
import { planScenes, scriptWithGuard, type Selection } from './script';
import { MIN_PLACES, selectEvents, selectExperiences, selectPlaces } from './select';
import type { PipelineDeps, StageUpdate } from './types';
import { voiceToFit } from './voiceFit';

export type { PipelineDeps, PipelineSources, StageUpdate } from './types';

/** Part of the video cache key: bump it when the video's look or structure changes. */
export const TEMPLATE_VERSION = 1;

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

async function mirrorImages(deps: PipelineDeps, urls: readonly string[]): Promise<Map<string, string>> {
  const onError = (url: string, error: unknown): void => deps.onSourceError?.(`image:${url}`, error);
  const paths = await Promise.all(urls.map((url) => mirrorImage({ fetch: deps.fetch, media: deps.media, onError }, url)));
  return new Map(urls.flatMap((url, index) => (paths[index] ? [[url, paths[index]] as const] : [])));
}

/** Only the sources whose facts made it into the video are cited. */
function citedSources(sources: readonly Source[], sel: Selection): Source[] {
  const planned = new Set(planScenes(sel).flatMap((scene) => scene.factIds));
  const used = new Set(
    [...sel.places, ...sel.experiences, ...sel.events, ...sel.weather]
      .filter((fact) => planned.has(fact.id))
      .map((fact) => fact.sourceId),
  );
  return sources.filter((source) => used.has(source.id));
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
    experiences: selectExperiences(gathered.experiences, interests),
    events: selectEvents(gathered.events, window),
    weather: gathered.weather,
  };

  onStage({ status: 'writing', stage: 'Writing the script', progress: 0.7 });
  const firstScript = await scriptWithGuard(deps.complete, selection, undefined, (reasons) =>
    deps.onSourceError?.('script', new Error(reasons.join('; '))),
  );

  onStage({ status: 'voicing', stage: 'Recording voiceover', progress: 0.85 });
  const voiced = await voiceToFit(deps, selection, firstScript);
  const [audioUrl, images] = await Promise.all([
    voiced.audio ? deps.media.put(`${videoId}.mp3`, voiced.audio) : Promise.resolve(null),
    mirrorImages(deps, sceneImageUrls(listing, voiced.sel)),
  ]);

  return assembleManifest({
    id: videoId,
    listing,
    interests,
    sel: voiced.sel,
    scenes: voiced.scenes,
    timings: voiced.timings,
    audioUrl,
    images,
    sources: citedSources(gathered.sources, voiced.sel),
  });
}
