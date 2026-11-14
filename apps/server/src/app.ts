import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { RATE_LIMITED_ERROR } from '@outside/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { fail } from './envelope';
import { healthRoutes } from './routes/health';
import { mediaRoutes } from './routes/media';
import { videoRoutes, type VideoRouteDeps } from './routes/videos';

export interface AppDeps {
  logger?: boolean;
  rateLimitMax?: number;
  /** Enables the video routes. */
  videos?: VideoRouteDeps;
  /** Enables `/media/:file`, served from this folder. */
  mediaDir?: string;
}

const BODY_LIMIT_BYTES = 64 * 1024;
/**
 * Per client per minute. One tab polls every 1.5 s while its video builds and a play fetches a
 * handful of media files, so the allowance has to cover several listings at once.
 */
const DEFAULT_RATE_LIMIT_MAX = 600;
const EXTENSION_ORIGIN = /^chrome-extension:\/\//;

const PUBLIC_ERRORS: Readonly<Record<number, string>> = {
  400: 'Invalid request',
  413: 'Request too large',
  429: RATE_LIMITED_ERROR,
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: BODY_LIMIT_BYTES });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send(fail('Not found')));

  // Details stay in the server log; clients only ever see a generic message.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    const message = PUBLIC_ERRORS[status];
    if (message === undefined) {
      request.log.error({ err: error }, 'request failed');
      return reply.code(500).send(fail('Internal error'));
    }
    return reply.code(status).send(fail(message));
  });

  app.register(cors, { origin: [EXTENSION_ORIGIN] });
  app.register(rateLimit, { max: deps.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX, timeWindow: '1 minute' });
  app.register(healthRoutes);
  if (deps.videos) {
    app.register(videoRoutes(deps.videos));
  }
  if (deps.mediaDir) {
    app.register(mediaRoutes(deps.mediaDir));
  }

  return app;
}
