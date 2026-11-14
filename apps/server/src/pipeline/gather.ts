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
import { shortName } from '../sources/places';
import { fitsActivity, placeSearches, type PlaceSearch } from './activities';
import { placeQuery, seasonOf, seasonPhotoQuery, type Season } from './season';
import { MIN_PLACES, WIDE_RADIUS_M, selectPlaces } from './select';
import type { PipelineDeps, StageUpdate } from './types';

/** How long the pipeline waits for any one source before carrying on without it. */
export const SOURCE_DEADLINE_MS = 12_000;

export interface Gathered {
  places: PlaceFact[];
  experiences: ExperienceFact[];
  events: EventFact[];
  weather: WeatherFact[];
  climate: ClimateFact[];
  /** Photos of the place in season, best first; empty when none was found. */
  seasonPhotos: SeasonPhoto[];
  /** The season the places and offers were searched for. */
  season: Season;
  /** The place searches that were planned: activities first, then one per place-kind interest. */
  searches: PlaceSearch[];
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
export async function guarded<T>(
  deps: PipelineDeps,
  sourceId: string,
  fallback: T,
  call: () => Promise<T>,
  deadlineMs: number = SOURCE_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${sourceId} did not answer within ${deadlineMs} ms`)), deadlineMs);
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

function findingStage(search: PlaceSearch, index: number, count: number): StageUpdate {
  const what = search.activity ? search.activity.label.toLowerCase() : `${interestById(search.interest).stageNoun} spots`;
  return { status: 'gathering', stage: `Finding ${what}`, progress: 0.2 + (0.3 * index) / count };
}

function withinReach(facts: readonly PlaceFact[], radiusM: number): boolean {
  return facts.some((fact) => fact.distanceM <= radiusM);
}

/** A "summer toboggan run" is no use in January, nor a "winter hiking trail" in July. Winterthur is a town. */
const OTHER_HALF_OF_YEAR: Readonly<Partial<Record<Season['kind'], RegExp>>> = {
  snowy: /\b(?:summer|sommer)/i,
  cold: /\b(?:summer|sommer)/i,
  warm: /\bwinter(?!thur)/i,
  hot: /\bwinter(?!thur)/i,
};

function inSeason(result: SourceResult<PlaceFact>, season: Season): SourceResult<PlaceFact> {
  const wrong = OTHER_HALF_OF_YEAR[season.kind];
  return wrong ? { ...result, facts: result.facts.filter((fact) => !wrong.test(`${fact.name} ${fact.category ?? ''}`)) } : result;
}

function named(result: SourceResult<PlaceFact>): SourceResult<PlaceFact> {
  return { ...result, facts: result.facts.map((fact) => ({ ...fact, name: shortName(fact.name) })) };
}

/**
 * The places one planned search finds. An activity's are checked against the season and the
 * activity itself. A place-kind interest searched the seasonal way falls back to its usual search
 * when that finds nothing within reach of the listing.
 */
async function placesFor(deps: PipelineDeps, ctx: GatherContext, search: PlaceSearch, season: Season): Promise<SourceResult<PlaceFact>> {
  const { place } = ctx;
  const { interest, activity } = search;
  const run = (query: string): Promise<SourceResult<PlaceFact>> =>
    guarded(deps, `places:${interest}`, emptyResult<PlaceFact>(), () =>
      deps.sources.places(deps, {
        interest,
        query,
        locationText: place.locationText,
        origin: place,
        ...(activity ? { activity: { id: activity.id, label: activity.label, doing: activity.doing } } : {}),
      }),
    );
  const found = await run(search.query);
  if (activity) {
    // Judged by its full name, which may be all that says what the place is for; then shown by its short one.
    const fitting = inSeason(found, season);
    // The first answer is the first one left for this season: a summer slide listed first does not count.
    return named({ ...fitting, facts: fitting.facts.filter((fact, index) => fitsActivity(fact, activity, index === 0)) });
  }
  return named(search.fallback && !withinReach(found.facts, WIDE_RADIUS_M) ? await run(search.fallback) : found);
}

/** Runs the planned searches at once, announcing each as the one before it lands. */
async function runSearches(
  deps: PipelineDeps,
  ctx: GatherContext,
  season: Season,
  searches: readonly PlaceSearch[],
  onStage: (update: StageUpdate) => void,
) {
  const waiting = new Set(searches);
  const announceNext = (): void => {
    const next = searches.find((search) => waiting.has(search));
    onStage(next ? findingStage(next, searches.indexOf(next), searches.length) : { status: 'gathering', stage: 'Checking live prices', progress: 0.6 });
  };
  announceNext();
  return Promise.all(
    searches.map(async (search) => {
      try {
        return await placesFor(deps, ctx, search, season);
      } finally {
        waiting.delete(search);
        announceNext();
      }
    }),
  );
}

/**
 * Places for the video. If the planned searches (activities first) leave too few places within
 * reach to carry a video, each interest's own broad search is run as well.
 */
async function gatherPlaces(deps: PipelineDeps, ctx: GatherContext, season: Season, searches: readonly PlaceSearch[], onStage: (update: StageUpdate) => void) {
  const planned = await runSearches(deps, ctx, season, searches, onStage);
  // Judged the way the video will choose: a place nearby that is too thinly reviewed to show does not count.
  const showable = selectPlaces(planned.flatMap((result) => result.facts), ctx.interests, searches);
  if (showable.length >= MIN_PLACES) {
    return planned;
  }
  const asked = new Set(searches.map((search) => search.query));
  const broad = ctx.interests.flatMap((interest): PlaceSearch[] => {
    const { query, fallback } = placeQuery(interest, season);
    const [first, second] = [query, fallback].filter((candidate): candidate is string => candidate !== undefined && !asked.has(candidate));
    return first ? [{ interest, query: first, ...(second ? { fallback: second } : {}) }] : [];
  });
  return [...planned, ...(await Promise.all(broad.map((search) => placesFor(deps, ctx, search, season))))];
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
  const searches = placeSearches(ctx.interests, season);
  const [places, experiences, events, weather, seasonPhoto] = await Promise.all([
    gatherPlaces(deps, ctx, season, searches, onStage),
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
  return {
    places: places.flatMap((result) => result.facts),
    experiences: experiences.flatMap((result) => result.facts),
    events: events.facts,
    weather: weather.facts,
    climate: climate.facts,
    seasonPhotos: seasonPhoto.facts,
    season,
    searches,
    sources: used.flatMap((result) => (result.source && result.facts.length > 0 ? [result.source] : [])),
  };
}
