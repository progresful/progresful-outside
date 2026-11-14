import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { RATE_LIMITED_ERROR } from '@outside/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { fail } from './envelope';
import { healthRoutes } from './routes/health';
import { mediaRoutes } from './routes/media';
import { siteRoutes } from './routes/site';
import { videoRoutes, type VideoRouteDeps } from './routes/videos';

export interface AppDeps {
  logger?: boolean;
  rateLimitMax?: number;
  /** Enables the video routes. */
  videos?: VideoRouteDeps;
  /** Enables `/media/:file`, served from this folder. */
  mediaDir?: string;
  /** Serves the landing page and the extension download from this folder. */
  siteDir?: string;
  /**
   * How many reverse proxies stand in front. With one, the visitor's address is the one that
   * proxy saw (the last entry of its forwarding header), so each visitor is limited on their
   * own and cannot pick a new allowance by writing an address in front of it. Zero, the default,
   * ignores the header: reached directly, a visitor could claim any address.
   */
  trustedProxies?: number;
}

const BODY_LIMIT_BYTES = 64 * 1024;
/**
 * Per client per minute. One tab polls every 1.5 s while its video builds and a play fetches a
 * handful of media files, so the allowance has to cover several listings at once.
 */
const DEFAULT_RATE_LIMIT_MAX = 600;
const EXTENSION_ORIGIN = /^chrome-extension:\/\//;

const NOT_FOUND = 'Not found';
/** What a visitor is told for each kind of refusal. A path that may not be served is simply not there. */
const PUBLIC_ERRORS: Readonly<Record<number, string>> = {
  400: 'Invalid request',
  403: NOT_FOUND,
  404: NOT_FOUND,
  413: 'Request too large',
  429: RATE_LIMITED_ERROR,
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const proxies = deps.trustedProxies ?? 0;
  // Only the nearest `proxies` hops are believed: the connection itself, then one forwarded entry per further proxy.
  const trustProxy = proxies > 0 ? (_address: string, hop: number): boolean => hop < proxies : false;
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: BODY_LIMIT_BYTES, trustProxy });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send(fail(NOT_FOUND)));

  // Nothing this server sends should be read as anything but the type it names.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  // Details stay in the server log; clients only ever see a generic message.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    const message = PUBLIC_ERRORS[status];
    if (message === undefined) {
      request.log.error({ err: error }, 'request failed');
      return reply.code(500).send(fail('Internal error'));
    }
    return reply.code(message === NOT_FOUND ? 404 : status).send(fail(message));
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
  if (deps.siteDir) {
    app.register(siteRoutes(deps.siteDir));
  }

  return app;
}
