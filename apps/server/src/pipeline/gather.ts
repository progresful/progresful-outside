import {
  interestById,
  type EventFact,
  type ExperienceFact,
  type InterestId,
  type PlaceFact,
  type Source,
  type WeatherFact,
} from '@outside/shared';
import { CreditsExhaustedError } from '../contextdev/client';
import type { TripWindow } from '../sources/tripWindow';
import { emptyResult } from '../sources/types';
import type { NormalizedPlace } from './normalize';
import type { PipelineDeps, StageUpdate } from './types';

/** How long the pipeline waits for any one source before carrying on without it. */
export const SOURCE_DEADLINE_MS = 12_000;

export interface Gathered {
  places: PlaceFact[];
  experiences: ExperienceFact[];
  events: EventFact[];
  weather: WeatherFact[];
  sources: Source[];
}

export interface GatherContext {
  place: NormalizedPlace;
  window: TripWindow;
  interests: readonly InterestId[];
  /** The currency the listing is shown in, when the page told us. */
  currency?: string;
}

/**
 * Runs one source with a deadline. A failure or a timeout is reported and replaced by `fallback`;
 * exhausted credits are the one failure that must stop the whole job.
 */
async function guarded<T>(deps: PipelineDeps, sourceId: string, fallback: T, call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${sourceId} did not answer within ${SOURCE_DEADLINE_MS} ms`)),
      SOURCE_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([call(), deadline]);
  } catch (error: unknown) {
    if (error instanceof CreditsExhaustedError) {
      throw error;
    }
    deps.onSourceError?.(sourceId, error);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

function findingStage(interest: InterestId, index: number, count: number): StageUpdate {
  return {
    status: 'gathering',
    stage: `Finding ${interestById(interest).stageNoun} spots`,
    progress: 0.2 + (0.3 * index) / count,
  };
}

/** Fetches places for every interest at once, announcing each interest as the one before it lands. */
async function gatherPlaces(deps: PipelineDeps, ctx: GatherContext, onStage: (update: StageUpdate) => void) {
  const { interests, place } = ctx;
  const waiting = new Set(interests);
  const announceNext = (): void => {
    const next = interests.find((interest) => waiting.has(interest));
    onStage(
      next
        ? findingStage(next, interests.indexOf(next), interests.length)
        : { status: 'gathering', stage: 'Checking live prices', progress: 0.6 },
    );
  };
  announceNext();
  return Promise.all(
    interests.map(async (interest) => {
      try {
        return await guarded(deps, `places:${interest}`, emptyResult<PlaceFact>(), () =>
          deps.sources.places(deps, { interest, locationText: place.locationText, origin: place }),
        );
      } finally {
        waiting.delete(interest);
        announceNext();
      }
    }),
  );
}

/** Everything the web says about the area right now. Sources run in parallel; a missing one is skipped. */
export async function gather(
  deps: PipelineDeps,
  ctx: GatherContext,
  onStage: (update: StageUpdate) => void,
): Promise<Gathered> {
  const { place, window } = ctx;
  const area = { city: place.city, country: place.country };
  const [places, experiences, events, weather] = await Promise.all([
    gatherPlaces(deps, ctx, onStage),
    guarded(deps, 'experiences', [], () =>
      deps.sources.experiences(deps, { ...area, ...(ctx.currency ? { currency: ctx.currency } : {}) }),
    ),
    guarded(deps, 'events', emptyResult<EventFact>(), () => deps.sources.events(deps, area)),
    guarded(deps, 'weather', emptyResult<WeatherFact>(), () =>
      deps.sources.weather(deps, { lat: place.lat, lng: place.lng, window, today: deps.today() }),
    ),
  ]);
  const used = [...places, ...experiences, events, weather];
  return {
    places: places.flatMap((result) => result.facts),
    experiences: experiences.flatMap((result) => result.facts),
    events: events.facts,
    weather: weather.facts,
    sources: used.flatMap((result) => (result.source && result.facts.length > 0 ? [result.source] : [])),
  };
}
