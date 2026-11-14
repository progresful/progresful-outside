import type { EventFact, ExperienceFact, PlaceFact, VideoStatus, WeatherFact } from '@outside/shared';
import type { MediaStore } from '../media/mediaStore';
import type { EventsParams } from '../sources/events';
import type { ExperiencesParams } from '../sources/experiences';
import type { PlacesParams } from '../sources/places';
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
}

export interface PipelineDeps extends SourceDeps {
  sources: PipelineSources;
  complete: Complete;
  synthesize: (lines: readonly string[]) => Promise<Speech>;
  media: MediaStore;
  /** Today as YYYY-MM-DD. */
  today: () => string;
}
