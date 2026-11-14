import type { ClimateFact, EventFact, ExperienceFact, PlaceFact, VideoStatus, WeatherFact } from '@outside/shared';
import type { ClimateParams } from '../sources/climate';
import type { MediaStore } from '../media/mediaStore';
import type { EventsParams } from '../sources/events';
import type { ExperiencesParams } from '../sources/experiences';
import type { FoundPhoto, PlacePhotoParams } from '../sources/placePhoto';
import type { PlacesParams } from '../sources/places';
import type { SeasonPhoto, SeasonPhotoParams } from '../sources/seasonPhoto';
import type { SourceDeps, SourceResult } from '../sources/types';
import type { WeatherParams } from '../sources/weather';
import type { Complete } from './script';
import type { Speech } from './voice';

export type { EventsParams } from '../sources/events';
export type { ExperiencesParams } from '../sources/experiences';

export interface StageUpdate {
  status: VideoStatus;
  stage: string;
  progress: number;
}

/** The live-web sources a video is gathered from. Injected so the runner can be tested without the network. */
export interface PipelineSources {
  places(deps: SourceDeps, p: PlacesParams): Promise<SourceResult<PlaceFact>>;
  experiences(deps: SourceDeps, p: ExperiencesParams): Promise<SourceResult<ExperienceFact>[]>;
  events(deps: SourceDeps, p: EventsParams): Promise<SourceResult<EventFact>>;
  weather(deps: SourceDeps, p: WeatherParams): Promise<SourceResult<WeatherFact>>;
  /** What the weather is usually like on the stay's dates. Asked first: it decides what else is searched for. */
  climate(deps: SourceDeps, p: ClimateParams): Promise<SourceResult<ClimateFact>>;
  seasonPhoto(deps: SourceDeps, p: SeasonPhotoParams): Promise<SourceResult<SeasonPhoto>>;
  /** A photo of one place as it looks in the season of the stay, found by image search. */
  placePhoto(deps: SourceDeps, p: PlacePhotoParams): Promise<SourceResult<FoundPhoto>>;
}

export interface PipelineDeps extends SourceDeps {
  sources: PipelineSources;
  complete: Complete;
  synthesize: (lines: readonly string[]) => Promise<Speech>;
  media: MediaStore;
  /** Today as YYYY-MM-DD. */
  today: () => string;
  /** Resolves a host name to its addresses, for checking where a found photo lives. DNS by default. */
  lookup?: (hostname: string) => Promise<string[]>;
}
