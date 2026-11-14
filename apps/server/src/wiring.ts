import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDeps } from './app';
import { createSqliteCacheStore } from './cache/cacheStore';
import { createDeduper } from './cache/dedupe';
import type { Config } from './config';
import { createContextDevClient } from './contextdev/client';
import { createBuildGate } from './jobs/buildGate';
import { createJobStore } from './jobs/jobStore';
import { createDiskMediaStore } from './media/mediaStore';
import { createOpenAiComplete } from './pipeline/openaiComplete';
import { runPipeline, type PipelineDeps, type PipelineSources } from './pipeline/run';
import { synthesize } from './pipeline/voice';
import { fetchClimate } from './sources/climate';
import { fetchEvents } from './sources/events';
import { fetchExperiences } from './sources/experiences';
import { fetchPlacePhoto } from './sources/placePhoto';
import { fetchPlaces } from './sources/places';
import { fetchSeasonPhoto } from './sources/seasonPhoto';
import { fetchWeather } from './sources/weather';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export interface Runtime {
  appDeps: AppDeps;
  /** Starts the periodic removal of expired cache rows and media files. */
  startSweeper(onError: (error: unknown) => void): void;
}

/** The live-web sources in use. */
function liveSources(): PipelineSources {
  return {
    places: fetchPlaces,
    experiences: fetchExperiences,
    events: fetchEvents,
    weather: fetchWeather,
    climate: fetchClimate,
    seasonPhoto: fetchSeasonPhoto,
    placePhoto: fetchPlacePhoto,
  };
}

/** Builds every real dependency from the configuration. `onSourceError` receives skipped-source failures. */
export function createRuntime(config: Config, onSourceError: (sourceId: string, error: unknown) => void): Runtime {
  mkdirSync(config.dataDir, { recursive: true });
  const mediaDir = join(config.dataDir, 'media');
  const cache = createSqliteCacheStore(join(config.dataDir, 'cache.sqlite'));
  const media = createDiskMediaStore(mediaDir);

  const pipelineDeps: PipelineDeps = {
    client: createContextDevClient({
      apiKey: config.contextDevApiKey,
      maxPerMinute: config.contextDevRequestsPerMinute,
      fixtures: { mode: config.fixtureMode, dir: join(config.dataDir, 'fixtures') },
    }),
    cache,
    dedupe: createDeduper(),
    now: () => Date.now(),
    fetch,
    onSourceError,
    sources: liveSources(),
    complete: createOpenAiComplete({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      ...(config.openaiReasoningEffort ? { reasoningEffort: config.openaiReasoningEffort } : {}),
    }),
    synthesize: (lines) =>
      synthesize(
        { fetch, apiKey: config.elevenLabsApiKey, voiceId: config.elevenLabsVoiceId, modelId: config.elevenLabsModelId },
        lines,
      ),
    media,
    today: () => new Date().toISOString().slice(0, 10),
  };

  return {
    appDeps: {
      logger: true,
      mediaDir,
      trustedProxies: config.trustedProxies,
      // The landing page is optional: a server run for development alone has no need of it.
      ...(existsSync(join(config.siteDir, 'index.html')) ? { siteDir: config.siteDir } : {}),
      videos: {
        cache,
        jobs: createJobStore(),
        run: (input, onStage) => runPipeline(pipelineDeps, input, onStage),
        now: () => Date.now(),
        gate: createBuildGate(config.buildLimits),
      },
    },
    startSweeper(onError: (error: unknown) => void): void {
      const sweep = (): void => {
        try {
          cache.sweep();
        } catch (error: unknown) {
          onError(error);
        }
        media.sweep().catch(onError);
      };
      setInterval(sweep, SWEEP_INTERVAL_MS).unref();
    },
  };
}
