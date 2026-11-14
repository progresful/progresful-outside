import {
  interestById,
  type ClimateFact,
  type EventFact,
  type ExperienceFact,
  type InterestId,
  type PlaceFact,
  type Source,
  type WeatherFact,
} from '@outside/shared';
import type { SeasonPhoto } from '../sources/seasonPhoto';
import { CreditsExhaustedError } from '../contextdev/client';
import type { TripWindow } from '../sources/tripWindow';
import { emptyResult, type SourceResult } from '../sources/types';
import type { NormalizedPlace } from './normalize';
import { placeQuery, seasonOf, seasonPhotoQuery, type Season } from './season';
import { WIDE_RADIUS_M } from './select';
import type { PipelineDeps, StageUpdate } from './types';

/** How long the pipeline waits for any one source before carrying on without it. */
export const SOURCE_DEADLINE_MS = 12_000;

export interface Gathered {
  places: PlaceFact[];
  experiences: ExperienceFact[];
  events: EventFact[];
  weather: WeatherFact[];
  climate: ClimateFact[];
  seasonPhoto?: SeasonPhoto;
  /** The season the places and offers were searched for. */
  season: Season;
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

/**
 * Places for one interest: searched the way the season calls for, and the usual way when that
 * finds nothing within reach of the listing.
 */
async function placesFor(deps: PipelineDeps, ctx: GatherContext, season: Season, interest: InterestId): Promise<SourceResult<PlaceFact>> {
  const { place } = ctx;
  const search = (query: string): Promise<SourceResult<PlaceFact>> =>
    guarded(deps, `places:${interest}`, emptyResult<PlaceFact>(), () =>
      deps.sources.places(deps, { interest, query, locationText: place.locationText, origin: place }),
    );
  const { query, fallback } = placeQuery(interest, season);
  const found = await search(query);
  const withinReach = found.facts.some((fact) => fact.distanceM <= WIDE_RADIUS_M);
  return fallback && !withinReach ? search(fallback) : found;
}

/** Fetches places for every interest at once, announcing each interest as the one before it lands. */
async function gatherPlaces(deps: PipelineDeps, ctx: GatherContext, season: Season, onStage: (update: StageUpdate) => void) {
  const { interests } = ctx;
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
        return await placesFor(deps, ctx, season, interest);
      } finally {
        waiting.delete(interest);
        announceNext();
      }
    }),
  );
}

/**
 * Everything the web says about the area right now. The usual weather for the dates is asked
 * first, because it decides what places are searched for; the rest runs in parallel, and a
 * missing source is skipped.
 */
export async function gather(
  deps: PipelineDeps,
  ctx: GatherContext,
  onStage: (update: StageUpdate) => void,
): Promise<Gathered> {
  const { place, window } = ctx;
  const area = { city: place.city, country: place.country };
  const climate = await guarded(deps, 'climate', emptyResult<ClimateFact>(), () =>
    deps.sources.climate(deps, { lat: place.lat, lng: place.lng, window, today: deps.today() }),
  );
  const season = seasonOf(climate.facts[0], window, place.lat);
  const [places, experiences, events, weather, seasonPhoto] = await Promise.all([
    gatherPlaces(deps, ctx, season, onStage),
    guarded(deps, 'experiences', [], () =>
      deps.sources.experiences(deps, {
        ...area,
        ...(ctx.currency ? { currency: ctx.currency } : {}),
        window: { start: window.start, end: window.end },
      }),
    ),
    guarded(deps, 'events', emptyResult<EventFact>(), () => deps.sources.events(deps, area)),
    guarded(deps, 'weather', emptyResult<WeatherFact>(), () =>
      deps.sources.weather(deps, { lat: place.lat, lng: place.lng, window, today: deps.today() }),
    ),
    guarded(deps, 'season-photo', emptyResult<SeasonPhoto>(), () =>
      deps.sources.seasonPhoto(deps, { city: place.city, query: seasonPhotoQuery(place.city, season) }),
    ),
  ]);
  const used = [...places, ...experiences, events, weather, climate, seasonPhoto];
  const photo = seasonPhoto.facts[0];
  return {
    places: places.flatMap((result) => result.facts),
    experiences: experiences.flatMap((result) => result.facts),
    events: events.facts,
    weather: weather.facts,
    climate: climate.facts,
    ...(photo ? { seasonPhoto: photo } : {}),
    season,
    sources: used.flatMap((result) => (result.source && result.facts.length > 0 ? [result.source] : [])),
  };
}
