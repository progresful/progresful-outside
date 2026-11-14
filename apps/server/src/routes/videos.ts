import {
  CreateVideoRequestSchema,
  effectiveInterests,
  type CreateVideoResponse,
  type ListingContext,
  type VideoManifest,
  type VideoStatusResponse,
} from '@outside/shared';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { CacheStore } from '../cache/cacheStore';
import { videoKey } from '../cache/keys';
import { CreditsExhaustedError } from '../contextdev/client';
import { fail, ok } from '../envelope';
import type { Job, JobStore } from '../jobs/jobStore';
import { NotEnoughDataError, TEMPLATE_VERSION, type PipelineInput, type StageUpdate } from '../pipeline/run';

export type RunVideo = (input: PipelineInput, onStage: (update: StageUpdate) => void) => Promise<VideoManifest>;

export interface VideoRouteDeps {
  cache: CacheStore;
  jobs: JobStore;
  run: RunVideo;
  now: () => number;
}

const VIDEO_ID = /^[0-9a-f]{16}$/;
const VIDEO_ID_LENGTH = 16;
const GENERIC_FAILURE = 'Could not build the video';

/**
 * Where a finished video is kept. The template version is part of it: when the video's look or
 * make-up changes, videos made before are simply no longer there, so a tab that still offers one
 * is told it is gone and builds the current one.
 */
function manifestKey(videoId: string): string {
  return `video:t${TEMPLATE_VERSION}:${videoId}`;
}

function statusOf(job: Job): VideoStatusResponse {
  return {
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    ...(job.manifest ? { manifest: job.manifest } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

/** Only the "too little data" message is meant for users; everything else stays in the log. */
function publicError(error: unknown): string {
  return error instanceof NotEnoughDataError ? error.message : GENERIC_FAILURE;
}

const COORDINATE_DECIMALS = 2;

/** The listing's stated place, coarse enough to be the same on every visit to the same listing. */
function placeFingerprint(listing: ListingContext): string {
  const coordinate = (value: number | undefined): string => (value === undefined ? '' : value.toFixed(COORDINATE_DECIMALS));
  return [listing.locationText.trim().toLowerCase(), coordinate(listing.lat), coordinate(listing.lng)].join('|');
}

function startJob(deps: VideoRouteDeps, log: FastifyBaseLogger, job: Job, input: PipelineInput): void {
  deps.jobs.put(job);
  // Sources still finishing after the job has ended keep reporting; a settled job stays as it is.
  let settled = false;
  const report = (update: StageUpdate): void => {
    if (!settled) {
      deps.jobs.put({ ...job, ...update });
    }
  };
  deps
    .run(input, report)
    .then((manifest) => {
      settled = true;
      deps.cache.set(manifestKey(job.id), manifest, { fetchedAt: deps.now() });
      deps.jobs.delete(job.id);
    })
    .catch((error: unknown) => {
      settled = true;
      const message = error instanceof CreditsExhaustedError ? 'Context.dev credits are exhausted' : 'video job failed';
      log.error({ err: error, videoId: job.id }, message);
      deps.jobs.put({ ...job, status: 'failed', stage: 'Failed', progress: 0, error: publicError(error) });
    });
}

export function videoRoutes(deps: VideoRouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/videos', async (request, reply) => {
      const parsed = CreateVideoRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(fail('Invalid request'));
      }
      const { listing } = parsed.data;
      const interests = effectiveInterests(parsed.data.interests);
      const key = videoKey({
        site: listing.site,
        listingId: listing.listingId,
        interests,
        checkIn: listing.checkIn,
        checkOut: listing.checkOut,
        place: placeFingerprint(listing),
        templateVersion: TEMPLATE_VERSION,
      });
      const videoId = key.slice(0, VIDEO_ID_LENGTH);
      if (deps.cache.get<VideoManifest>(manifestKey(videoId), deps.now())) {
        return ok<CreateVideoResponse>({ videoId, status: 'ready', cached: true });
      }
      const running = deps.jobs.getByKey(key);
      if (running && running.status !== 'failed') {
        return ok<CreateVideoResponse>({ videoId, status: running.status, cached: false });
      }
      const job: Job = { id: videoId, key, status: 'queued', stage: 'Reading the neighbourhood', progress: 0 };
      startJob(deps, request.log, job, { videoId, listing, interests });
      return ok<CreateVideoResponse>({ videoId, status: 'queued', cached: false });
    });

    app.get<{ Params: { id: string } }>('/api/videos/:id', async (request, reply) => {
      const { id } = request.params;
      if (!VIDEO_ID.test(id)) {
        return reply.code(404).send(fail('Not found'));
      }
      const job = deps.jobs.get(id);
      if (job) {
        return ok(statusOf(job));
      }
      const cached = deps.cache.get<VideoManifest>(manifestKey(id), deps.now());
      if (!cached) {
        return reply.code(404).send(fail('Not found'));
      }
      return ok<VideoStatusResponse>({ status: 'ready', stage: 'Ready', progress: 1, manifest: cached.value });
    });
  };
}
